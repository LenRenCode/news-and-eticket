import { PoolClient } from "pg";
import { withTransaction } from "../db";

export interface ScanResult {
  status: "VALID" | "ALREADY_SCANNED" | "NOT_FOUND";
  pesan: string;
  data?: {
    ticketId: string;
    kodeTiket: string;
    namaPembeli: string;
    waktuScan?: string;
    namaEvent?: string;
    kategori?: string;
  };
}

export class ScannerService {
  /**
   * Validasi dan Eksekusi Scan Check-In Tiket dengan Atomic Row Lock (FOR UPDATE)
   * Mencegah 2 panitia memindai tiket yang sama di gate berbeda dalam mikrodetik yang sama.
   */
  static async validateAndCheckIn(
    ticketUuid: string,
    scannedBy: string = "Gate Staff 1"
  ): Promise<ScanResult> {
    // Validasi format UUID sederhana
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(ticketUuid.trim())) {
      return {
        status: "NOT_FOUND",
        pesan: "Format kode QR tidak valid (Bukan UUID resmi).",
      };
    }

    return await withTransaction(async (client: PoolClient) => {
      // Kunci baris tiket saat dipindai
      const query = `
        SELECT 
          t.id,
          t.kode_tiket,
          t.status_kehadiran,
          t.waktu_scan,
          t.scanned_by,
          tr.status_pembayaran,
          p.nama AS nama_pembeli,
          k.nama_event,
          k.kategori
        FROM tiket t
        JOIN transaksi tr ON t.transaksi_id = tr.id
        JOIN pembeli p ON tr.pembeli_id = p.id
        JOIN kuota_tiket k ON tr.kuota_id = k.id
        WHERE t.id = $1
        FOR UPDATE OF t;
      `;
      const res = await client.query(query, [ticketUuid.trim()]);

      if (res.rows.length === 0) {
        return {
          status: "NOT_FOUND",
          pesan: "Tiket tidak ditemukan di dalam database!",
        };
      }

      const ticket = res.rows[0];

      // Verifikasi status pembayaran transaksi harus PAID
      if (ticket.status_pembayaran !== "PAID") {
        return {
          status: "NOT_FOUND",
          pesan: "Transaksi untuk tiket ini belum lunas / tidak valid!",
        };
      }

      // Jika tiket sudah pernah digunakan
      if (ticket.status_kehadiran === "SCANNED") {
        return {
          status: "ALREADY_SCANNED",
          pesan: "PERINGATAN: Tiket sudah pernah digunakan / di-scan sebelumnya!",
          data: {
            ticketId: ticket.id,
            kodeTiket: ticket.kode_tiket,
            namaPembeli: ticket.nama_pembeli,
            waktuScan: ticket.waktu_scan?.toISOString(),
            namaEvent: ticket.nama_event,
            kategori: ticket.kategori,
          },
        };
      }

      // Tiket valid dan baru pertama kali dipindai -> Update atomik ke SCANNED
      const updateQuery = `
        UPDATE tiket
        SET status_kehadiran = 'SCANNED',
            waktu_scan = NOW(),
            scanned_by = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING waktu_scan;
      `;
      const updateRes = await client.query(updateQuery, [ticket.id, scannedBy]);
      const waktuScanBaru = updateRes.rows[0].waktu_scan;

      return {
        status: "VALID",
        pesan: "TIKET VALID! Akses masuk diberikan.",
        data: {
          ticketId: ticket.id,
          kodeTiket: ticket.kode_tiket,
          namaPembeli: ticket.nama_pembeli,
          waktuScan: waktuScanBaru.toISOString(),
          namaEvent: ticket.nama_event,
          kategori: ticket.kategori,
        },
      };
    });
  }
}
