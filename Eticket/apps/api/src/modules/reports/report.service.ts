import * as XLSX from "xlsx";
import { pool } from "../db";

interface MonthlyValue {
  month: string;
  tickets: number;
  revenue: number;
}

interface MonthlyForecast {
  month: string;
  tickets: number | null;
  revenue: number | null;
}

export class ReportService {
  static async getMonthlyForecast() {
    const result = await pool.query(`
      SELECT
        TO_CHAR(periods.month_start, 'YYYY-MM') AS month,
        COALESCE(SUM(tr.jumlah_tiket), 0)::integer AS tickets,
        COALESCE(SUM(tr.total_bayar), 0)::double precision AS revenue
      FROM generate_series(
        DATE_TRUNC('month', NOW()) - INTERVAL '11 months',
        DATE_TRUNC('month', NOW()),
        INTERVAL '1 month'
      ) AS periods(month_start)
      LEFT JOIN transaksi tr
        ON tr.status_pembayaran = 'PAID'
        AND DATE_TRUNC('month', COALESCE(tr.paid_at, tr.created_at)) = periods.month_start
      GROUP BY periods.month_start
      ORDER BY periods.month_start ASC;
    `);

    const history: MonthlyValue[] = result.rows.map((row) => ({
      month: String(row.month),
      tickets: Number(row.tickets),
      revenue: Number(row.revenue),
    }));
    const lastHistoryMonth = history.at(-1)?.month;
    if (!lastHistoryMonth) {
      throw new Error("Database tidak mengembalikan periode statistik bulanan");
    }
    const hasSalesHistory = history.some(
      (value) => value.tickets > 0 || value.revenue > 0
    );
    const sample = history.slice(-3);
    const forecasts: MonthlyForecast[] = [];

    if (hasSalesHistory) {
      const projections: MonthlyValue[] = [];
      for (let horizon = 1; horizon <= 2; horizon += 1) {
        const previousProjection = projections.at(-1);
        let observations: MonthlyValue[];
        if (horizon === 1) {
          observations = sample;
        } else {
          if (!previousProjection) {
            throw new Error("Proyeksi bulan pertama tidak tersedia");
          }
          observations = [...history.slice(-2), previousProjection];
        }
        const average = (key: "tickets" | "revenue") =>
          observations.reduce((total, value) => total + value[key], 0) /
          observations.length;
        const monthDate = new Date(`${lastHistoryMonth}-01T00:00:00Z`);
        monthDate.setUTCMonth(monthDate.getUTCMonth() + horizon);
        projections.push({
          month: monthDate.toISOString().slice(0, 7),
          tickets: Math.max(0, Math.round(average("tickets"))),
          revenue: Math.max(0, Math.round(average("revenue"))),
        });
      }
      forecasts.push(...projections);
    } else {
      for (let horizon = 1; horizon <= 2; horizon += 1) {
        const monthDate = new Date(`${lastHistoryMonth}-01T00:00:00Z`);
        monthDate.setUTCMonth(monthDate.getUTCMonth() + horizon);
        forecasts.push({ month: monthDate.toISOString().slice(0, 7), tickets: null, revenue: null });
      }
    }

    return {
      history,
      forecasts,
      hasSalesHistory,
      method: "Rata-rata bergerak tiga bulan terakhir",
      sampleMonths: sample.length,
    };
  }

  /**
   * Menghasilkan Buffer file Excel (.xlsx) dari seluruh transaksi dan tiket di PostgreSQL
   * sebagai backup offline panitia pada hari H acara.
   */
  static async generateExcelBackup(): Promise<Buffer> {
    const query = `
      SELECT 
        tr.kode_transaksi AS "Kode Transaksi",
        tr.created_at AS "Waktu Transaksi",
        tr.status_pembayaran AS "Status Pembayaran",
        p.nama AS "Nama Pembeli",
        p.email AS "Email",
        p.no_whatsapp AS "WhatsApp",
        k.nama_event AS "Rute Bus",
        k.kategori AS "Jadwal",
        COALESCE(t.kode_tiket, '-') AS "Kode Tiket",
        COALESCE(t.id::text, '-') AS "UUID QR Code (Scan String)",
        COALESCE(t.status_kehadiran::text, 'BELUM TERBIT') AS "Status Kehadiran",
        t.waktu_scan AS "Waktu Check-In",
        t.scanned_by AS "Petugas Gate",
        tr.total_bayar::numeric AS "Total Bayar (IDR)",
        COALESCE(tr.refund_notes, '-') AS "Catatan Refund",
        tr.refunded_at AS "Waktu Refund",
        COALESCE(tr.refunded_by, '-') AS "Operator Refund"
      FROM transaksi tr
      JOIN pembeli p ON tr.pembeli_id = p.id
      JOIN kuota_tiket k ON tr.kuota_id = k.id
      LEFT JOIN tiket t ON tr.id = t.transaksi_id
      ORDER BY tr.created_at DESC, t.kode_tiket ASC;
    `;

    const [res, forecast] = await Promise.all([
      pool.query(query),
      this.getMonthlyForecast(),
    ]);
    const rows = res.rows;

    // Hitung ringkasan statistik
    const totalTransaksi = new Set(rows.map((r) => r["Kode Transaksi"])).size;
    const transaksiLunas = new Set(
      rows
        .filter((r) => r["Status Pembayaran"] === "PAID")
        .map((r) => r["Kode Transaksi"])
    ).size;
    const tiketHadir = rows.filter(
      (r) => r["Status Kehadiran"] === "SCANNED"
    ).length;
    const totalTiketTerbit = rows.filter(
      (r) => r["Kode Tiket"] !== "-"
    ).length;

    // Buat Workbook baru
    const wb = XLSX.utils.book_new();

    // Sheet 1: Master Data Check-in
    const wsMaster = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, wsMaster, "Master Data Tiket");

    // Sheet 2: Ringkasan
    const summaryData = [
      { Parameter: "Total Transaksi Tercatat", Nilai: totalTransaksi },
      { Parameter: "Transaksi Terkonfirmasi (PAID)", Nilai: transaksiLunas },
      { Parameter: "Total Tiket Diterbitkan", Nilai: totalTiketTerbit },
      { Parameter: "Total Penumpang Berangkat (Scanned)", Nilai: tiketHadir },
      {
        Parameter: "Tingkat Kehadiran (Attendance Rate)",
        Nilai:
          totalTiketTerbit > 0
            ? `${((tiketHadir / totalTiketTerbit) * 100).toFixed(1)}%`
            : "0%",
      },
      {
        Parameter: "Waktu Ekspor Dibuat",
        Nilai: new Date().toLocaleString("id-ID"),
      },
      {
        Parameter: "Metode Proyeksi",
        Nilai: forecast.method,
      },
      {
        Parameter: "Periode Data Historis",
        Nilai: `${forecast.history[0]?.month ?? "-"} s.d. ${
          forecast.history[forecast.history.length - 1]?.month ?? "-"
        }`,
      },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Perjalanan");

    const allMonthlyValues = [...forecast.history, ...forecast.forecasts];
    const maxTickets = Math.max(...allMonthlyValues.map((value) => value.tickets ?? 0), 0);
    const maxRevenue = Math.max(...allMonthlyValues.map((value) => value.revenue ?? 0), 0);
    const textBar = (value: number | null, max: number) => {
      if (value === null) return "Belum tersedia";
      if (value === 0 || max === 0) return "";
      return "#".repeat(Math.max(1, Math.round((value / max) * 20)));
    };
    const monthlyRows = [
      ...forecast.history.map((value) => ({
        Bulan: value.month,
        Jenis: "Aktual",
        "Tiket Terjual": value.tickets,
        "Pendapatan (IDR)": value.revenue,
        "Diagram Tiket (relatif)": textBar(value.tickets, maxTickets),
        "Diagram Pendapatan (relatif)": textBar(value.revenue, maxRevenue),
      })),
      ...forecast.forecasts.map((value) => ({
        Bulan: value.month,
        Jenis: "Prediksi",
        "Tiket Terjual": value.tickets ?? "",
        "Pendapatan (IDR)": value.revenue ?? "",
        "Diagram Tiket (relatif)": textBar(value.tickets, maxTickets),
        "Diagram Pendapatan (relatif)": textBar(value.revenue, maxRevenue),
      })),
    ];
    const wsMonthly = XLSX.utils.json_to_sheet(monthlyRows);
    wsMonthly["!cols"] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 24 },
      { wch: 28 },
      { wch: 32 },
    ];
    wsMonthly["!autofilter"] = { ref: `A1:F${monthlyRows.length + 1}` };
    XLSX.utils.book_append_sheet(wb, wsMonthly, "Analisis Bulanan");

    const forecastRows = [
      { Parameter: "Metode", Nilai: forecast.method },
      {
        Parameter: "Jendela Data",
        Nilai: `${forecast.sampleMonths} bulan terakhir`,
      },
      { Parameter: "Ada Data Penjualan", Nilai: forecast.hasSalesHistory ? "Ya" : "Tidak" },
      ...forecast.forecasts.map((value) => ({
        Parameter: `Prediksi tiket ${value.month}`,
        Nilai: value.tickets ?? "Belum tersedia",
      })),
      ...forecast.forecasts.map((value) => ({
        Parameter: `Prediksi pendapatan ${value.month} (IDR)`,
        Nilai: value.revenue ?? "Belum tersedia",
      })),
    ];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(forecastRows),
      "Statistik & Prediksi"
    );

    // Konversi ke Buffer format XLSX
    const excelBuffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    return excelBuffer;
  }
}
