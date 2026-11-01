"use client";

import { useEffect, useState, use } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/api";
import { getBusBookingInfo, type BusBookingInfo } from "@/lib/bus-booking";

export default function ETicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const identifier = unwrappedParams.id;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busBooking, setBusBooking] = useState<BusBookingInfo | null>(null);

  useEffect(() => {
    setBusBooking(getBusBookingInfo(identifier));

    // Cek apakah identifier adalah Transaksi ID atau Tiket UUID
    api
      .getTransaction(identifier)
      .then((res) => {
        if (res.data) {
          setData({ type: "transaction", ...res.data });
        }
      })
      .catch(() => {
        // Coba fetch sebagai individual ticket jika bukan transaksi
        return api.getTicket(identifier).then((res) => {
          if (res.data) {
            setData({ type: "ticket", ticket: res.data });
          }
        });
      })
      .catch((err) => {
        setError(err.message || "E-Tiket tidak ditemukan");
      })
      .finally(() => setLoading(false));
  }, [identifier]);

  if (loading) {
    return (
      <div className="page-container" style={{ textAlign: "center", padding: "80px 0" }}>
        <div style={{ fontSize: "32px", marginBottom: "16px" }}>🎟️</div>
        <p style={{ color: "var(--text-muted)" }}>Menerbitkan E-Tiket ber-barcode resmi...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-container" style={{ textAlign: "center", padding: "80px 0" }}>
        <div style={{ fontSize: "36px", marginBottom: "16px" }}>⚠️</div>
        <h2>E-Tiket Belum Tersedia</h2>
        <p style={{ color: "var(--text-muted)", marginTop: "8px" }}>
          {error || "Pembayaran belum terkonfirmasi atau tiket tidak ditemukan."}
        </p>
      </div>
    );
  }

  // Tentukan daftar tiket yang akan dirender (Bisa 1 atau banyak)
  const ticketsToRender =
    data.type === "transaction"
      ? data.tickets
      : [data.ticket];

  const buyerName =
    data.type === "transaction"
      ? data.namaPembeli
      : data.ticket?.namaPembeli;
  const eventName =
    data.type === "transaction"
      ? data.namaEvent
    : data.ticket?.namaEvent || "Samarinda → Penajam";
  const categoryName =
    data.type === "transaction"
      ? data.kategori
    : data.ticket?.kategori || "Bus demo";

  return (
    <main className="page-container" style={{ maxWidth: "600px" }}>
      {/* ACTION BAR ATAS (NO PRINT) */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <span className="badge badge-success" style={{ fontSize: "13px" }}>
            ✓ Pembayaran Terkonfirmasi Lunas
          </span>
          <h1 style={{ fontSize: "22px", marginTop: "8px" }}>E-Tiket Digital Resmi</h1>
        </div>
        <button
          onClick={() => window.print()}
          className="btn-print"
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            border: "1px solid var(--border-glass)",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          🖨️ Cetak / Simpan PDF (A4)
        </button>
      </div>

      {/* DAFTAR TIKET (SCREENSHOT & PRINT OPTIMIZED) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        {ticketsToRender.map((ticket: any, index: number) => {
          const isScanned = ticket.statusKehadiran === "SCANNED";

          return (
            <div key={ticket.id} className="ticket-card">
              {/* TICKET HEADER */}
              <div className="ticket-header">
                <div style={{ fontSize: "12px", letterSpacing: "2px", textTransform: "uppercase", opacity: 0.9 }}>
                  E-TIKET BUS &bull; DEMO
                </div>
                <h2 style={{ fontSize: "24px", margin: "6px 0" }}>{eventName}</h2>
                <div style={{ fontSize: "14px", opacity: 0.9 }}>
                  {categoryName} &bull; Penumpang #{index + 1}
                </div>
              </div>

              {/* TICKET NOTCH DIVIDER */}
              <div className="ticket-notch-divider">
                <div className="ticket-dashed-line" />
              </div>

              {/* TICKET BODY WITH SCANNABLE QR */}
              <div className="ticket-body">
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-subtle)", textTransform: "uppercase" }}>
                    Nama Pemegang Tiket
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: "bold", color: "#fff" }}>
                    {buyerName}
                  </div>
                </div>

                {/* SCANNABLE QR CODE CONTAINER */}
                <div className="qr-code-box">
                  <QRCodeSVG
                    value={ticket.id} // UUID v4 YANG DIGUNAKAN SCANNER GATE
                    size={200}
                    level="H"
                    includeMargin={false}
                  />
                  <div
                    style={{
                      marginTop: "10px",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      color: "#1e293b",
                      fontWeight: "bold",
                    }}
                  >
                    {ticket.kodeTiket}
                  </div>
                </div>

                {/* STATUS KEHADIRAN BADGE */}
                <div style={{ margin: "14px 0" }}>
                  {isScanned ? (
                    <span className="badge badge-danger" style={{ fontSize: "13px", padding: "8px 16px" }}>
                      ⛔ SUDAH DI-SCAN ({new Date(ticket.waktuScan).toLocaleTimeString("id-ID")})
                    </span>
                  ) : (
                    <span className="badge badge-success" style={{ fontSize: "13px", padding: "8px 16px" }}>
                      🟢 TIKET AKTIF &bull; SIAP CHECK-IN
                    </span>
                  )}
                </div>

                {/* METADATA INFORMASI */}
                <div
                  style={{
                    background: "rgba(15, 20, 34, 0.6)",
                    border: "1px solid var(--border-glass)",
                    borderRadius: "12px",
                    padding: "16px",
                    marginTop: "16px",
                    textAlign: "left",
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--text-subtle)", display: "block" }}>Rute</span>
                    <strong style={{ color: "#fff" }}>{eventName}</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-subtle)", display: "block" }}>Kursi</span>
                    <strong style={{ color: "#fff" }}>{busBooking?.seatNumbers[index] || "Demo"}</strong>
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <span style={{ color: "var(--text-subtle)", display: "block" }}>Keberangkatan</span>
                    <strong style={{ color: "#fff" }}>
                      {busBooking
                        ? `${busBooking.travelDate} · ${busBooking.departure} WITA`
                        : categoryName}
                    </strong>
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <span style={{ color: "var(--text-subtle)", display: "block" }}>Kode verifikasi</span>
                    <code style={{ fontSize: "11px", color: "#818cf8" }}>{ticket.id}</code>
                  </div>
                </div>
              </div>

              {/* FOOTER NOTICE */}
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.2)",
                  padding: "12px 20px",
                  fontSize: "11px",
                  color: "var(--text-subtle)",
                  textAlign: "center",
                  borderTop: "1px solid var(--border-glass)",
                }}
              >
                Simpan QR ini untuk ditunjukkan saat naik bus. Rute dan kursi pada demo belum terhubung ke operator bus.
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
