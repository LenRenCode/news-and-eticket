import { PoolClient } from "pg";
import { v4 as uuidv4 } from "uuid";
import { withTransaction, pool } from "../db";
import { MidtransPaymentService } from "../payments/midtrans.service";
import { EmailService } from "../tickets/email.service";

export interface GuestCheckoutInput {
  nama: string;
  email: string;
  noWhatsapp: string;
  jumlahTiket: number;
  kuotaId?: number;
}

export class TransactionService {
  /**
   * Mengambil informasi kuota tiket saat ini untuk tampilan frontend
   */
  static async getQuotaInfo(kuotaId: number = 1) {
    // Bersihkan dulu reservasi kedaluwarsa sebelum membaca kuota
    try {
      await TransactionService.releaseExpiredReservations();
    } catch {
      // Abaikan jika database belum siap
    }

    const query = `
      SELECT 
        id, 
        nama_event AS "namaEvent", 
        kategori, 
        harga::numeric AS "harga", 
        total_kuota AS "totalKuota", 
        kuota_terjual AS "kuotaTerjual", 
        kuota_terpesan AS "kuotaTerpesan",
        (total_kuota - kuota_terjual - kuota_terpesan) AS "sisaKuota"
      FROM kuota_tiket
      WHERE id = $1 AND is_active = TRUE
    `;
    const res = await pool.query(query, [kuotaId]);
    if (res.rows.length === 0) {
      throw new Error("Kategori tiket tidak ditemukan");
    }
    return res.rows[0];
  }

  /**
   * Pelepasan reservasi kuota kedaluwarsa secara mandiri dan transaksional.
   * Mengembalikan jumlah transaksi yang dibatalkan karena kedaluwarsa.
   */
  static async releaseExpiredReservations(): Promise<number> {
    return await withTransaction(async (client: PoolClient) => {
      const quotaQuery = `
        SELECT DISTINCT kuota_id
        FROM transaksi
        WHERE status_pembayaran = 'PENDING' AND expired_at <= NOW()
        ORDER BY kuota_id;
      `;
      const quotas = await client.query(quotaQuery);
      let releasedCount = 0;

      for (const row of quotas.rows) {
        const qId = Number(row.kuota_id);
        await client.query("SELECT id FROM kuota_tiket WHERE id = $1 FOR UPDATE", [qId]);
        const changed = await client.query(
          `
          UPDATE transaksi
          SET status_pembayaran = 'EXPIRED',
              updated_at = NOW()
          WHERE kuota_id = $1
            AND status_pembayaran = 'PENDING'
            AND expired_at <= NOW()
          RETURNING jumlah_tiket
          `,
          [qId]
        );
        const releasedQty = changed.rows.reduce(
          (total, transaction) => total + Number(transaction.jumlah_tiket),
          0
        );
        if (releasedQty > 0) {
          await client.query(
            `
            UPDATE kuota_tiket
            SET kuota_terpesan = GREATEST(0, kuota_terpesan - $1),
                updated_at = NOW()
            WHERE id = $2
            `,
            [releasedQty, qId]
          );
          releasedCount += changed.rows.length;
        }
      }

      return releasedCount;
    });
  }

  /**
   * Guest Checkout dengan PESSIMISTIC LOCKING (Row Locking / FOR UPDATE)
   * Menjamin tidak ada overselling / race condition saat ribuan checkout bersamaan.
   */
  static async checkoutGuest(input: GuestCheckoutInput) {
    const kuotaId = input.kuotaId || 1;
    const requestedQty = Number(input.jumlahTiket);

    if (!input.nama || !input.email || !input.noWhatsapp) {
      throw new Error("Nama, Email, dan No. WhatsApp wajib diisi lengkap");
    }
    if (requestedQty <= 0 || requestedQty > 10) {
      throw new Error("Jumlah tiket harus antara 1 sampai 10 per transaksi");
    }

    return await withTransaction(async (client: PoolClient) => {
      // 1. [CRITICAL PESSIMISTIC LOCK] Kunci baris kuota tiket secara eksklusif
      const lockQuery = `
        SELECT 
          id, 
          nama_event, 
          kategori, 
          harga, 
          total_kuota, 
          kuota_terjual, 
          kuota_terpesan,
          (total_kuota - kuota_terjual - kuota_terpesan) AS sisa_kuota
        FROM kuota_tiket
        WHERE id = $1 AND is_active = TRUE
        FOR UPDATE;
      `;
      const lockResult = await client.query(lockQuery, [kuotaId]);

      if (lockResult.rows.length === 0) {
        throw new Error("Kategori tiket tidak aktif atau tidak ditemukan");
      }

      // 1b. [PELEPASAN RESERVASI KUOTA KEDALUWARSA DALAM TRANSAKSI]
      // Setelah FOR UPDATE pada kuota_tiket, lepas semua transaksi PENDING yang lewat expired_at
      const expiredResult = await client.query(
        `
        UPDATE transaksi
        SET status_pembayaran = 'EXPIRED',
            updated_at = NOW()
        WHERE kuota_id = $1
          AND status_pembayaran = 'PENDING'
          AND expired_at <= NOW()
        RETURNING jumlah_tiket
        `,
        [kuotaId]
      );
      const releasedQty = expiredResult.rows.reduce(
        (total, transaction) => total + Number(transaction.jumlah_tiket),
        0
      );
      if (releasedQty > 0) {
        await client.query(
          `
          UPDATE kuota_tiket
          SET kuota_terpesan = GREATEST(0, kuota_terpesan - $1),
              updated_at = NOW()
          WHERE id = $2
          `,
          [releasedQty, kuotaId]
        );
      }

      const kuota = lockResult.rows[0];
      const kuotaTerpesanAktif = Math.max(0, parseInt(kuota.kuota_terpesan, 10) - releasedQty);
      const sisaKuota = parseInt(kuota.total_kuota, 10) - parseInt(kuota.kuota_terjual, 10) - kuotaTerpesanAktif;
      const hargaSatuan = parseFloat(kuota.harga);

      // 2. Validasi stok ketersediaan
      if (sisaKuota < requestedQty) {
        throw new Error(
          `Mohon maaf, sisa kuota tiket tidak mencukupi. Kuota tersisa: ${sisaKuota} tiket.`
        );
      }

      // 3. Tahan kuota (Hold quota sementara selama transaksi berjalan)
      await client.query(
        `
        UPDATE kuota_tiket
        SET kuota_terpesan = kuota_terpesan + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [requestedQty, kuotaId]
      );

      // 4. Simpan Data Pembeli (Guest)
      const buyerInsert = await client.query(
        `
        INSERT INTO pembeli (nama, email, no_whatsapp)
        VALUES ($1, $2, $3)
        RETURNING id
        `,
        [input.nama.trim(), input.email.trim().toLowerCase(), input.noWhatsapp.trim()]
      );
      const pembeliId = buyerInsert.rows[0].id;

      // 5. Buat Kode Transaksi unik & waktu expired 15 menit
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const randomSuffix = Math.floor(10000 + Math.random() * 90000);
      const kodeTransaksi = `TRX-${dateStr}-${randomSuffix}`;
      const totalBayar = hargaSatuan * requestedQty;
      const expiredAt = new Date(Date.now() + 15 * 60 * 1000); // 15 menit

      // 6. Request tagihan QRIS ke Midtrans
      const qrisResult = await MidtransPaymentService.createQrisCharge(
        kodeTransaksi,
        totalBayar,
        {
          nama: input.nama,
          email: input.email,
          phone: input.noWhatsapp,
        }
      );

      // 7. Simpan Transaksi PENDING ke database
      const trxInsert = await client.query(
        `
        INSERT INTO transaksi (
          kode_transaksi,
          pembeli_id,
          kuota_id,
          jumlah_tiket,
          harga_satuan,
          total_bayar,
          status_pembayaran,
          gateway_order_id,
          qris_payload,
          qris_url,
          expired_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9, $10)
        RETURNING id, kode_transaksi, total_bayar, jumlah_tiket, expired_at, qris_payload, qris_url
        `,
        [
          kodeTransaksi,
          pembeliId,
          kuotaId,
          requestedQty,
          hargaSatuan,
          totalBayar,
          qrisResult.orderId,
          qrisResult.qrPayload,
          qrisResult.qrUrl || null,
          expiredAt,
        ]
      );

      const trx = trxInsert.rows[0];
      return {
        transaksiId: trx.id,
        kodeTransaksi: trx.kode_transaksi,
        totalBayar: parseFloat(trx.total_bayar),
        jumlahTiket: trx.jumlah_tiket,
        expiredAt: trx.expired_at.toISOString(),
        qrisPayload: trx.qris_payload,
        qrisUrl: trx.qris_url,
      };
    });
  }

  /**
   * Konfirmasi Pembayaran Sukses (Webhook Payment Gateway)
   * Mengubah status PAID, mengonversi kuota terpesan menjadi terjual,
   * dan menerbitkan N tiket dengan UUID v4 untuk scannable QR Code.
   */
  static async confirmPaymentAndIssueTickets(
    orderIdOrTrxId: string,
    gatewayOrderId?: string,
    expectedGrossAmount?: number | string
  ) {
    return await withTransaction(async (client: PoolClient) => {
      // 1. Kunci baris transaksi (Row Locking untuk idempoten)
      const trxQuery = `
        SELECT 
          t.id, 
          t.kode_transaksi, 
          t.pembeli_id, 
          t.kuota_id, 
          t.jumlah_tiket, 
          t.total_bayar,
          t.status_pembayaran,
          p.nama AS pembeli_nama,
          p.email AS pembeli_email,
          p.no_whatsapp AS pembeli_phone,
          k.nama_event AS route_name
        FROM transaksi t
        JOIN pembeli p ON t.pembeli_id = p.id
        JOIN kuota_tiket k ON t.kuota_id = k.id
        WHERE t.id::text = $1 OR t.kode_transaksi = $1 OR t.gateway_order_id = $1
        FOR UPDATE OF t;
      `;
      const trxResult = await client.query(trxQuery, [orderIdOrTrxId]);

      if (trxResult.rows.length === 0) {
        throw new Error(`Transaksi dengan identifier ${orderIdOrTrxId} tidak ditemukan`);
      }

      const trx = trxResult.rows[0];

      // Verifikasi kesesuaian jumlah nominal pembayaran jika disertakan
      if (
        expectedGrossAmount !== undefined &&
        expectedGrossAmount !== null &&
        expectedGrossAmount !== ""
      ) {
        const expected = Number(expectedGrossAmount);
        const actual = Number(trx.total_bayar);
        if (!Number.isNaN(expected) && Math.abs(actual - expected) > 0.01) {
          throw new Error(
            `Gross amount mismatch: transaksi sebesar ${actual}, callback gateway sebesar ${expected}`
          );
        }
      }

      // Idempoten jika sudah REFUNDED
      if (trx.status_pembayaran === "REFUNDED") {
        return {
          status: "ALREADY_REFUNDED",
          transaksiId: trx.id,
          kodeTransaksi: trx.kode_transaksi,
        };
      }

      // Idempoten: Jika sudah PAID, kembalikan tiket yang sudah diterbitkan
      if (trx.status_pembayaran === "PAID") {
        const existingTickets = await client.query(
          "SELECT id, kode_tiket, status_kehadiran FROM tiket WHERE transaksi_id = $1",
          [trx.id]
        );
        return {
          status: "ALREADY_PAID",
          transaksiId: trx.id,
          tickets: existingTickets.rows,
        };
      }

      // Penanganan transaksi EXPIRED yang terlambat dibayar (aman: tidak dobel tiket / rusak kuota)
      if (
        trx.status_pembayaran === "EXPIRED" ||
        trx.status_pembayaran === "NEEDS_REFUND"
      ) {
        console.warn(
          `[Webhook Warning] Pembayaran diterima untuk transaksi ${trx.kode_transaksi} yang sudah EXPIRED. Tiket tidak diterbitkan.`
        );
        await client.query(
          `
          UPDATE transaksi
          SET status_pembayaran = 'NEEDS_REFUND',
              gateway_order_id = COALESCE($1, gateway_order_id),
              updated_at = NOW()
          WHERE id = $2 AND status_pembayaran = 'EXPIRED'
          `,
          [gatewayOrderId || null, trx.id]
        );
        return {
          status: "NEEDS_REFUND",
          transaksiId: trx.id,
          kodeTransaksi: trx.kode_transaksi,
          message: "Pembayaran terlambat diterima; transaksi memerlukan pengembalian dana.",
        };
      }

      // 2. Kunci baris kuota tiket untuk update stok pasti
      await client.query("SELECT id FROM kuota_tiket WHERE id = $1 FOR UPDATE", [
        trx.kuota_id,
      ]);

      // 3. Update stok kuota: pindahkan dari terpesan ke terjual
      await client.query(
        `
        UPDATE kuota_tiket
        SET kuota_terpesan = GREATEST(0, kuota_terpesan - $1),
            kuota_terjual = kuota_terjual + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [trx.jumlah_tiket, trx.kuota_id]
      );

      // 4. Update status transaksi menjadi PAID
      await client.query(
        `
        UPDATE transaksi
        SET status_pembayaran = 'PAID',
            paid_at = NOW(),
            gateway_order_id = COALESCE($1, gateway_order_id),
            updated_at = NOW()
        WHERE id = $2
        `,
        [gatewayOrderId || null, trx.id]
      );

      // 5. Terbitkan Tiket Individual dengan UUID v4
      const issuedTickets: Array<{ id: string; kodeTiket: string }> = [];
      for (let i = 0; i < trx.jumlah_tiket; i++) {
        const ticketUuid = uuidv4(); // UUID v4 murni untuk scannable QR Code
        const shortCode = ticketUuid.substring(0, 8).toUpperCase();
        const kodeTiket = `TKT-2026-${shortCode}`;

        await client.query(
          `
          INSERT INTO tiket (id, transaksi_id, kode_tiket, status_kehadiran)
          VALUES ($1, $2, $3, 'AVAILABLE')
          `,
          [ticketUuid, trx.id, kodeTiket]
        );

        issuedTickets.push({ id: ticketUuid, kodeTiket });
      }

      // 6. Kirim E-Tiket ke Email Pembeli secara asinkron (Nodemailer)
      EmailService.sendETickets({
        to: trx.pembeli_email,
        recipientName: trx.pembeli_nama,
        kodeTransaksi: trx.kode_transaksi,
        tickets: issuedTickets,
        totalBayar: parseFloat(trx.total_bayar),
        eventName: trx.route_name,
      }).catch((err) =>
        console.error("[EmailService] Error saat background sending:", err)
      );

      return {
        status: "SUCCESS",
        transaksiId: trx.id,
        kodeTransaksi: trx.kode_transaksi,
        tickets: issuedTickets,
      };
    });
  }

  /**
   * Mengambil detail transaksi beserta e-tiket untuk halaman pembayaran & e-tiket
   */
  static async getTransactionStatus(transaksiId: string) {
    const trxQuery = `
      SELECT 
        t.id AS "transaksiId",
        t.kode_transaksi AS "kodeTransaksi",
        t.status_pembayaran AS "statusPembayaran",
        t.total_bayar::numeric AS "totalBayar",
        t.jumlah_tiket AS "jumlahTiket",
        t.qris_payload AS "qrisPayload",
        t.qris_url AS "qrisUrl",
        t.expired_at AS "expiredAt",
        t.paid_at AS "paidAt",
        p.nama AS "namaPembeli",
        p.email AS "email",
        p.no_whatsapp AS "noWhatsapp",
        k.nama_event AS "namaEvent",
        k.kategori AS "kategori"
      FROM transaksi t
      JOIN pembeli p ON t.pembeli_id = p.id
      JOIN kuota_tiket k ON t.kuota_id = k.id
      WHERE t.id::text = $1
    `;
    const trxRes = await pool.query(trxQuery, [transaksiId]);
    if (trxRes.rows.length === 0) {
      throw new Error("Transaksi tidak ditemukan");
    }

    const trx = trxRes.rows[0];

    // Ambil daftar tiket jika sudah diterbitkan
    const ticketsRes = await pool.query(
      `
      SELECT 
        id, 
        kode_tiket AS "kodeTiket", 
        status_kehadiran AS "statusKehadiran", 
        waktu_scan AS "waktuScan"
      FROM tiket
      WHERE transaksi_id = $1
      ORDER BY kode_tiket ASC
      `,
      [trx.transaksiId]
    );

    return {
      ...trx,
      tickets: ticketsRes.rows,
    };
  }

  /**
   * Mengambil detail satu tiket berdasarkan UUID (untuk halaman E-Tiket perorangan)
   */
  static async getTicketById(ticketUuid: string) {
    const query = `
      SELECT 
        t.id,
        t.kode_tiket AS "kodeTiket",
        t.status_kehadiran AS "statusKehadiran",
        t.waktu_scan AS "waktuScan",
        tr.kode_transaksi AS "kodeTransaksi",
        tr.paid_at AS "paidAt",
        p.nama AS "namaPembeli",
        p.email AS "email",
        p.no_whatsapp AS "noWhatsapp",
        k.nama_event AS "namaEvent",
        k.kategori AS "kategori"
      FROM tiket t
      JOIN transaksi tr ON t.transaksi_id = tr.id
      JOIN pembeli p ON tr.pembeli_id = p.id
      JOIN kuota_tiket k ON tr.kuota_id = k.id
      WHERE t.id = $1
    `;
    const res = await pool.query(query, [ticketUuid]);
    if (res.rows.length === 0) {
      throw new Error("Tiket dengan ID tersebut tidak ditemukan");
    }
    return res.rows[0];
  }

  /**
   * Tandai transaksi NEEDS_REFUND menjadi REFUNDED (Aksi Admin)
   * Idempoten, mencatat jejak waktu dan nama operator.
   */
  static async markAsRefunded(
    orderIdOrTrxId: string,
    notes?: string,
    operatorName: string = "Admin"
  ) {
    return await withTransaction(async (client: PoolClient) => {
      const trxQuery = `
        SELECT id, kode_transaksi, status_pembayaran, refund_notes, refunded_at, refunded_by
        FROM transaksi
        WHERE id::text = $1 OR kode_transaksi = $1 OR gateway_order_id = $1
        FOR UPDATE OF transaksi;
      `;
      const trxResult = await client.query(trxQuery, [orderIdOrTrxId]);

      if (trxResult.rows.length === 0) {
        throw new Error(`Transaksi dengan identifier ${orderIdOrTrxId} tidak ditemukan`);
      }

      const trx = trxResult.rows[0];

      // Idempoten: Jika sudah REFUNDED, kembalikan detail yang ada
      if (trx.status_pembayaran === "REFUNDED") {
        return {
          success: true,
          status: "REFUNDED",
          alreadyRefunded: true,
          transaksiId: trx.id,
          kodeTransaksi: trx.kode_transaksi,
          notes: trx.refund_notes || null,
          refundedAt: trx.refunded_at ? new Date(trx.refunded_at).toISOString() : null,
          refundedBy: trx.refunded_by || null,
        };
      }

      if (trx.status_pembayaran !== "NEEDS_REFUND") {
        throw new Error(
          `Hanya transaksi berstatus NEEDS_REFUND yang dapat ditandai REFUNDED (status saat ini: ${trx.status_pembayaran})`
        );
      }

      const updateResult = await client.query(
        `
        UPDATE transaksi
        SET status_pembayaran = 'REFUNDED',
            refund_notes = $1,
            refunded_at = NOW(),
            refunded_by = $2,
            updated_at = NOW()
        WHERE id = $3
        RETURNING id, kode_transaksi, status_pembayaran, refund_notes, refunded_at, refunded_by;
        `,
        [notes || null, operatorName, trx.id]
      );

      const updated = updateResult.rows[0];
      return {
        success: true,
        status: "REFUNDED",
        alreadyRefunded: false,
        transaksiId: updated.id,
        kodeTransaksi: updated.kode_transaksi,
        notes: updated.refund_notes,
        refundedAt: updated.refunded_at
          ? new Date(updated.refunded_at).toISOString()
          : new Date().toISOString(),
        refundedBy: updated.refunded_by,
      };
    });
  }
}

export function startQuotaSweeper(intervalMs: number = 30000) {
  const timer = setInterval(async () => {
    try {
      const count = await TransactionService.releaseExpiredReservations();
      if (count > 0) {
        console.log(`[Sweeper] Berhasil melepaskan ${count} reservasi kuota kedaluwarsa.`);
      }
    } catch (err: any) {
      console.warn("[Sweeper Warning] Gagal memeriksa reservasi kedaluwarsa:", err.message);
    }
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }
  return timer;
}
