"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type MonthlyValue = {
  month: string;
  tickets: number;
  revenue: number;
};

type ForecastValue = {
  month: string;
  tickets: number | null;
  revenue: number | null;
};

type MonthlyForecast = {
  history: MonthlyValue[];
  forecasts: ForecastValue[];
  hasSalesHistory: boolean;
  method: string;
  sampleMonths: number;
};

type QuotaStats = {
  namaEvent: string;
  totalKuota: number;
  kuotaTerjual: number;
  kuotaTerpesan: number;
  sisaKuota: number;
  harga: number;
};

function formatMonth(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("id-ID", {
    month: "short",
    year: "2-digit",
  });
}

function MonthlyChart({
  title,
  history,
  forecasts,
  metric,
  formatValue,
}: {
  title: string;
  history: MonthlyValue[];
  forecasts: ForecastValue[];
  metric: "tickets" | "revenue";
  formatValue: (value: number) => string;
}) {
  const actualValues = history.map((item) => item[metric]);
  const projectedValues = forecasts.map((item) => item[metric]);
  const values = [...actualValues, ...projectedValues.filter((value): value is number => value !== null)];
  const chartWidth = 700;
  const chartHeight = 240;
  const left = 48;
  const right = 16;
  const top = 18;
  const bottom = 40;
  const maxValue = Math.max(...values, 1);
  const x = (index: number) =>
    left + (index / Math.max(values.length - 1, 1)) * (chartWidth - left - right);
  const y = (value: number) =>
    top + (1 - value / maxValue) * (chartHeight - top - bottom);
  const actualLine = actualValues.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const forecastLine = [
    `${x(Math.max(actualValues.length - 1, 0))},${y(actualValues[actualValues.length - 1] ?? 0)}`,
    ...projectedValues
      .map((value, index) =>
        value === null ? null : `${x(actualValues.length + index)},${y(value)}`
      )
      .filter((point): point is string => point !== null),
  ].join(" ");
  const labels = [...history.map((item) => item.month), ...forecasts.map((item) => item.month)];

  return (
    <section className="glass-card forecast-card">
      <div className="forecast-card-heading">
        <div>
          <h2>{title}</h2>
          <p className="forecast-subtitle">Aktual dan proyeksi dua bulan berikutnya</p>
        </div>
        <span className="forecast-legend">
          <span className="legend-actual" /> Aktual
          <span className="legend-projection" /> Prediksi
        </span>
      </div>
      <div className="forecast-chart-scroll">
        <svg
          className="forecast-chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={title}
        >
          {[0, 0.5, 1].map((fraction) => {
            const value = maxValue * fraction;
            const lineY = y(value);
            return (
              <g key={fraction}>
                <line x1={left} x2={chartWidth - right} y1={lineY} y2={lineY} className="chart-gridline" />
                <text x={left - 8} y={lineY + 4} textAnchor="end" className="chart-axis-label">
                  {formatValue(value)}
                </text>
              </g>
            );
          })}
          <polyline points={actualLine} className="chart-actual-line" />
          {forecasts.some((value) => value[metric] !== null) ? (
            <polyline points={forecastLine} className="chart-forecast-line" />
          ) : null}
          {values.map((value, index) => (
            <g key={`${labels[index]}-${index}`}>
              <circle
                cx={x(index)}
                cy={y(value)}
                r={index < actualValues.length ? 4 : 5}
                className={index < actualValues.length ? "chart-actual-point" : "chart-forecast-point"}
              />
              {(index % 2 === 0 || index >= actualValues.length) ? (
                <text x={x(index)} y={chartHeight - 12} textAnchor="middle" className="chart-axis-label">
                  {formatMonth(labels[index])}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<QuotaStats | null>(null);
  const [forecast, setForecast] = useState<MonthlyForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([api.getQuota(), api.getMonthlyForecast()])
      .then(([quotaResponse, forecastResponse]) => {
        if (!active) return;
        setStats(quotaResponse.data);
        setForecast(forecastResponse.data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const totalRevenue = stats ? stats.kuotaTerjual * stats.harga : 0;
  const exportUrl = api.getExportExcelUrl();
  const soldPercent = stats
    ? Math.min(100, Math.round((stats.kuotaTerjual / (stats.totalKuota || 1)) * 100))
    : 0;
  const currency = (value: number) => `Rp ${Math.round(value).toLocaleString("id-ID")}`;

  return (
    <main className="page-container">
      <div className="admin-header">
        <div>
          <span className="badge badge-primary">Dashboard admin</span>
          <h1 style={{ fontSize: "clamp(22px, 4vw, 32px)", marginTop: "10px" }}>
            Laporan & Prediksi Penjualan
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
            {stats?.namaEvent ?? "Data perjalanan"} · Statistik transaksi lunas dan estimasi dua bulan ke depan.
          </p>
        </div>
        <a href={exportUrl} className="btn-export">
          <span aria-hidden="true">📊</span>
          <span>Unduh laporan Excel</span>
        </a>
      </div>

      {error ? (
        <div className="admin-error glass-card" role="alert">
          Gagal memuat laporan: {error}. Periksa koneksi API dan database PostgreSQL.
        </div>
      ) : null}

      {loading ? <p className="forecast-subtitle">Memuat statistik...</p> : null}

      <div className="admin-stats-grid">
        <div className="stat-card">
          <div className="stat-label">Tiket terjual</div>
          <div className="stat-value" style={{ color: "#818cf8" }}>
            {stats?.kuotaTerjual.toLocaleString("id-ID") ?? "—"}
          </div>
          <div className="stat-sub">
            {stats ? `dari ${stats.totalKuota.toLocaleString("id-ID")} tiket (${soldPercent}%)` : "Menunggu data"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Penerimaan tiket terjual</div>
          <div className="stat-value" style={{ color: "#34d399", fontSize: "clamp(20px, 2.5vw, 28px)" }}>
            {stats ? currency(totalRevenue) : "—"}
          </div>
          <div className="stat-sub">Estimasi berdasarkan harga tiket saat ini</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sisa kuota</div>
          <div className="stat-value" style={{ color: "#fbbf24" }}>
            {stats?.sisaKuota.toLocaleString("id-ID") ?? "—"}
          </div>
          <div className="stat-sub">
            {stats ? `${stats.kuotaTerpesan} tiket menunggu pembayaran` : "Menunggu data"}
          </div>
        </div>
        <div className="stat-card stat-card-action">
          <div>
            <div className="stat-label">Check-in peserta</div>
            <div className="stat-sub">Validasi tiket menggunakan kamera atau kode manual.</div>
          </div>
          <Link href="/admin/scanner" className="btn-secondary">
            Buka scanner keberangkatan
          </Link>
        </div>
      </div>

      {forecast?.hasSalesHistory ? (
        <>
          <div className="forecast-intro glass-card">
            <div>
              <h2>Analisis statistik</h2>
              <p>
                Metode {forecast.method.toLowerCase()}, menggunakan {forecast.sampleMonths} bulan data
                terakhir dari transaksi yang sudah lunas. Prediksi adalah estimasi tren, bukan jaminan penjualan.
              </p>
            </div>
            <div className="forecast-values">
              {forecast.forecasts.map((value) => (
                <div key={value.month} className="forecast-value">
                  <strong>{formatMonth(value.month)}</strong>
                  <span>{value.tickets?.toLocaleString("id-ID") ?? "—"} tiket</span>
                  <span>{value.revenue === null ? "—" : currency(value.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="forecast-charts">
            <MonthlyChart
              title="Tren & prediksi tiket terjual"
              history={forecast.history}
              forecasts={forecast.forecasts}
              metric="tickets"
              formatValue={(value) => Math.round(value).toLocaleString("id-ID")}
            />
            <MonthlyChart
              title="Tren & prediksi pendapatan"
              history={forecast.history}
              forecasts={forecast.forecasts}
              metric="revenue"
              formatValue={(value) => {
                const amount = Math.round(value);
                return amount >= 1_000_000
                  ? `${(amount / 1_000_000).toFixed(1)} jt`
                  : `${Math.round(amount / 1_000)} rb`;
              }}
            />
          </div>
        </>
      ) : forecast ? (
        <div className="glass-card forecast-empty">
          <h2>Prediksi belum tersedia</h2>
          <p>Belum ada transaksi lunas dalam 12 bulan terakhir. Data prediksi akan muncul setelah penjualan tercatat.</p>
        </div>
      ) : null}

      <div className="glass-card forecast-note">
        <h2>Data dan metode di file Excel</h2>
        <p>
          Laporan mencakup data tiket untuk pemeriksaan offline, ringkasan statistik acara, serta
          sheet bulanan yang memisahkan angka aktual dan prediksi dengan diagram batang teks
          berskala relatif. Seluruh angka prediksi memakai transaksi berstatus lunas.
        </p>
      </div>
    </main>
  );
}
