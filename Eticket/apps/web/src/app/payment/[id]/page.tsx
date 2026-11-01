"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/api";
import {
  getBusBookingInfo,
  saveTicketBookings,
  type BusBookingInfo,
} from "@/lib/bus-booking";

export default function PaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const transactionId = unwrappedParams.id;
  const router = useRouter();

  const [trx, setTrx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<number>(15 * 60);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");
  const [busBooking, setBusBooking] = useState<BusBookingInfo | null>(null);

  // 1. Fetch Transaksi Awal
  useEffect(() => {
    const savedBooking = getBusBookingInfo(transactionId);
    setBusBooking(savedBooking);

    api
      .getTransaction(transactionId)
      .then((res) => {
        if (res.data) {
          setTrx(res.data);
          if (res.data.statusPembayaran === "PAID") {
            if (savedBooking && Array.isArray(res.data.tickets)) {
              saveTicketBookings(res.data.tickets, savedBooking);
            }
            router.push(`/ticket/${transactionId}`);
          }
          if (res.data.expiredAt) {
            const diff = Math.floor(
              (new Date(res.data.expiredAt).getTime() - Date.now()) / 1000
            );
            setTimeLeft(Math.max(0, diff));
          }
        }
      })
      .catch((err) => {
        setError(err.message || "Gagal memuat transaksi pembayaran");
      })
      .finally(() => setLoading(false));
  }, [transactionId, router]);

  // 2. Countdown Timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // 3. Auto-Polling Status Pembayaran (Mendeteksi Webhook Midtrans)
  useEffect(() => {
    if (!trx || trx.statusPembayaran === "PAID" || timeLeft <= 0) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await api.getTransaction(transactionId);
        if (res.data?.statusPembayaran === "PAID") {
          clearInterval(pollInterval);
          const booking = getBusBookingInfo(transactionId);
          if (booking && Array.isArray(res.data.tickets)) {
            saveTicketBookings(res.data.tickets, booking);
          }
          router.push(`/ticket/${transactionId}`);
        }
      } catch (e) {
        // Abaikan transient error saat polling
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [trx, transactionId, timeLeft, router]);

  // Helper Simulasi Sukses untuk Pengujian Cepat
  const handleSimulatePayment = async () => {
    setSimulating(true);
    try {
      const response = await api.simulateSuccess(transactionId);
      const booking = busBooking ?? getBusBookingInfo(transactionId);
      if (booking && Array.isArray(response.data?.tickets)) {
        saveTicketBookings(response.data.tickets, booking);
      }
      router.push(`/ticket/${transactionId}`);
    } catch (err: any) {
      alert("Simulasi gagal: " + err.message);
    } finally {
      setSimulating(false);
    }
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`;

  if (loading) {
    return (
      <div className="page-container" style={{ textAlign: "center", padding: "80px 0" }}>
        <div style={{ fontSize: "28px", marginBottom: "16px" }}>⏳</div>
        <p style={{ color: "var(--text-muted)" }}>Memuat tagihan barcode QRIS resmi...</p>
      </div>
    );
  }

  if (error || !trx) {
    return (
      <div className="page-container" style={{ textAlign: "center", padding: "80px 0" }}>
        <div style={{ fontSize: "36px", marginBottom: "16px" }}>⚠️</div>
        <h2>Tagihan Tidak Ditemukan</h2>
        <p style={{ color: "var(--text-muted)", marginTop: "8px" }}>{error}</p>
        <button
          onClick={() => router.push("/")}
          className="btn-primary"
          style={{ width: "auto", marginTop: "24px", padding: "12px 24px" }}
        >
          Kembali ke Beranda
        </button>
      </div>
    );
  }

  return (
    <main className="page-container" style={{ maxWidth: "680px" }}>
      <div className="glass-card" style={{ textAlign: "center" }}>
        {/* HEADER COUNTDOWN */}
        <div style={{ marginBottom: "24px" }}>
          <span className="badge badge-warning" style={{ fontSize: "14px", padding: "8px 18px" }}>
            ⏱️ Selesaikan dalam {formattedTime}
          </span>
          <h1 style={{ fontSize: "26px", marginTop: "16px" }}>Pembayaran QRIS Dinamis</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
            Kode Transaksi: <strong style={{ color: "#fff" }}>{trx.kodeTransaksi}</strong>
          </p>
        </div>

        {/* QRIS BARCODE CARD (Responsive & High Contrast) */}
        <div className="qris-card">
          {/* QRIS BRAND HEADER */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "2px solid #e2e8f0",
              paddingBottom: "12px",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontWeight: "900", fontSize: "20px", letterSpacing: "1px", color: "#1e293b" }}>
              QRIS
            </div>
            <div style={{ fontSize: "10px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>
              Standar Pembayaran Nasional
            </div>
          </div>

          {/* DYNAMIC QR CODE */}
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
            <QRCodeSVG
              value={trx.qrisPayload || `QRIS_TRX_${trx.kodeTransaksi}`}
              size={220}
              level="M"
              includeMargin={false}
              style={{ maxWidth: "100%", height: "auto" }}
            />
          </div>

          <div
            style={{
              marginTop: "16px",
              borderTop: "2px dashed #e2e8f0",
              paddingTop: "14px",
              fontSize: "13px",
              color: "#475569",
            }}
          >
            <div>Rute: <strong>{trx.namaEvent || "Samarinda → Penajam"}</strong></div>
            <div>Jadwal: <strong>
              {busBooking
                ? `${busBooking.travelDate} · ${busBooking.departure} WITA`
                : trx.kategori || "Bus demo"}
            </strong></div>
            <div>Kursi: <strong>{busBooking?.seatNumbers.join(", ") || "Demo"}</strong></div>
            <div style={{ fontSize: "20px", fontWeight: "800", color: "#1e1b4b", marginTop: "4px" }}>
              Rp {Number(trx.totalBayar).toLocaleString("id-ID")}
            </div>
          </div>
        </div>

        {/* STATUS DETECTOR & INSTRUCTIONS */}
        <div style={{ marginTop: "28px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              color: "#34d399",
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
                boxShadow: "0 0 10px #10b981",
              }}
            />
            Menunggu pembayaran... Halaman akan otomatis diperbarui.
          </div>

          <div
            style={{
              background: "rgba(15, 20, 34, 0.8)",
              border: "1px solid var(--border-glass)",
              borderRadius: "14px",
              padding: "16px",
              marginTop: "20px",
              textAlign: "left",
              fontSize: "13px",
              color: "var(--text-muted)",
            }}
          >
            <strong style={{ color: "#fff", display: "block", marginBottom: "6px" }}>
              Panduan Pembayaran:
            </strong>
            <ol style={{ paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
              <li>Buka aplikasi m-Banking (BCA, Mandiri, BRI, BNI) atau E-Wallet (GoPay, OVO, ShopeePay, Dana).</li>
              <li>Pilih menu <strong>Pindai / Scan QRIS</strong>.</li>
              <li>Arahkan kamera ke kode QR di atas atau ambil tangkapan layar.</li>
              <li>Pastikan nominal bayar sesuai dan konfirmasi PIN Anda.</li>
            </ol>
          </div>

          {/* SIMULATION BUTTON FOR LOCAL DEV TESTING */}
          <div style={{ marginTop: "20px", borderTop: "1px solid var(--border-glass)", paddingTop: "16px" }}>
            <button
              onClick={handleSimulatePayment}
              disabled={simulating}
              style={{
                background: "rgba(99, 102, 241, 0.15)",
                border: "1px solid rgba(99, 102, 241, 0.4)",
                color: "#a5b4fc",
                padding: "10px 20px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              {simulating
                ? "Memproses Konfirmasi..."
                : "⚡ Klik di Sini untuk Simulasi Bayar Berhasil (Testing Dev)"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
