"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";

export default function AdminScannerPage() {
  const [scanResult, setScanResult] = useState<{
    status: "IDLE" | "VALID" | "ALREADY_SCANNED" | "NOT_FOUND";
    message: string;
    data?: any;
  }>({
    status: "IDLE",
    message: "Arahkan kamera ke QR Code e-tiket peserta",
  });

  const [manualInput, setManualInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [scannerStarted, setScannerStarted] = useState(false);

  const scannerRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Audio Beep Generator menggunakan Web Audio API (Tanpa butuh file audio eksternal)
  const playBeep = (type: "success" | "error") => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "success") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime); // Nada A5
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15); // E6
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, ctx.currentTime); // Nada A3 rendah
        osc.frequency.setValueAtTime(150, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (e) {
      console.warn("Gagal memainkan suara audio:", e);
    }
  };

  // Fungsi Eksekusi Validasi Scan ke API
  const handleVerifyTicket = async (ticketUuid: string) => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const response = await api.scanTicket(ticketUuid.trim(), "Kru Bus");

      if (response.status === "VALID") {
        playBeep("success");
        setScanResult({
          status: "VALID",
          message: "TIKET VALID! Akses masuk diberikan.",
          data: response.data,
        });
        setHistory((prev) => [
          { status: "VALID", time: new Date().toLocaleTimeString(), data: response.data },
          ...prev.slice(0, 9),
        ]);
      } else if (response.status === "ALREADY_SCANNED") {
        playBeep("error");
        setScanResult({
          status: "ALREADY_SCANNED",
          message: "PERINGATAN: Tiket sudah pernah di-scan sebelumnya!",
          data: response.data,
        });
        setHistory((prev) => [
          { status: "ALREADY_SCANNED", time: new Date().toLocaleTimeString(), data: response.data },
          ...prev.slice(0, 9),
        ]);
      } else {
        playBeep("error");
        setScanResult({
          status: "NOT_FOUND",
          message: response.pesan || "Tiket tidak terdaftar dalam sistem!",
        });
      }
    } catch (err: any) {
      playBeep("error");
      setScanResult({
        status: "NOT_FOUND",
        message: err.message || "Tiket tidak valid atau error sistem.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Inisialisasi html5-qrcode kamera smartphone
  useEffect(() => {
    let html5QrCode: any;

    const startCamera = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        html5QrCode = new Html5Qrcode("reader-viewport");
        scannerRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        await html5QrCode.start(
          { facingMode: "environment" }, // Kamera belakang smartphone
          config,
          (decodedText: string) => {
            // Callback saat QR Code berhasil dibaca kamera
            handleVerifyTicket(decodedText);
          },
          () => {
            // Callback scanning frame (abaikan)
          }
        );
        setScannerStarted(true);
      } catch (err: any) {
        console.warn("Gagal membuka kamera:", err);
      }
    };

    startCamera();

    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current?.clear();
          });
      }
    };
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      handleVerifyTicket(manualInput);
      setManualInput("");
    }
  };

  return (
    <main className="page-container" style={{ maxWidth: "600px" }}>
      {/* SCANNER HEADER */}
      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <span className="badge badge-primary" style={{ marginBottom: "8px" }}>
          Sistem Validasi Gate &bull; 2026
        </span>
        <h1 style={{ fontSize: "26px" }}>Scanner Tiket Naik Bus</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
          Pindai barcode QR pada smartphone peserta untuk validasi instan anti-duplikasi.
        </p>
      </div>

      {/* CAMERA VIEWPORT CONTAINER */}
      <div className="scanner-viewport-box">
        <div id="reader-viewport" style={{ width: "100%", height: "100%" }} />
        {scannerStarted && <div className="scanner-laser-line" />}
      </div>

      {/* RESULT FEEDBACK CARD (DYNAMIC ALERT) */}
      <div style={{ marginTop: "20px" }}>
        {scanResult.status === "VALID" && (
          <div
            style={{
              background: "rgba(16, 185, 129, 0.2)",
              border: "2px solid #10b981",
              borderRadius: "16px",
              padding: "20px",
              textAlign: "center",
              animation: "fadeIn 0.3s ease-in-out",
            }}
          >
            <div style={{ fontSize: "40px" }}>✅</div>
            <h2 style={{ color: "#34d399", fontSize: "22px", margin: "8px 0" }}>
              TIKET VALID!
            </h2>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: "#fff" }}>
              {scanResult.data?.namaPembeli}
            </div>
            <div style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
              Kode: {scanResult.data?.kodeTiket} &bull; Kategori: {scanResult.data?.kategori || "VIP"}
            </div>
          </div>
        )}

        {scanResult.status === "ALREADY_SCANNED" && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              border: "2px solid #ef4444",
              borderRadius: "16px",
              padding: "20px",
              textAlign: "center",
              animation: "fadeIn 0.3s ease-in-out",
            }}
          >
            <div style={{ fontSize: "40px" }}>⛔</div>
            <h2 style={{ color: "#f87171", fontSize: "22px", margin: "8px 0" }}>
              TIKET SUDAH DIGUNAKAN!
            </h2>
            <p style={{ color: "#fca5a5", fontSize: "14px" }}>
              Tiket atas nama <strong>{scanResult.data?.namaPembeli}</strong> telah di-scan sebelumnya pada:
            </p>
            <div
              style={{
                fontFamily: "monospace",
                color: "#fff",
                background: "rgba(0,0,0,0.4)",
                padding: "8px 14px",
                borderRadius: "8px",
                display: "inline-block",
                marginTop: "10px",
                fontSize: "13px",
              }}
            >
              {scanResult.data?.waktuScan ? new Date(scanResult.data.waktuScan).toLocaleString("id-ID") : "-"}
            </div>
          </div>
        )}

        {scanResult.status === "NOT_FOUND" && (
          <div
            style={{
              background: "rgba(245, 158, 11, 0.15)",
              border: "2px solid #f59e0b",
              borderRadius: "16px",
              padding: "20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "40px" }}>⚠️</div>
            <h2 style={{ color: "#fbbf24", fontSize: "20px", margin: "8px 0" }}>
              TIKET TIDAK VALID
            </h2>
            <p style={{ color: "#fde68a", fontSize: "14px" }}>{scanResult.message}</p>
          </div>
        )}
      </div>

      {/* FALLBACK INPUT MANUAL UNTUK PANITIA */}
      <div className="glass-card" style={{ marginTop: "24px" }}>
        <h3 style={{ fontSize: "15px", marginBottom: "8px" }}>⌨️ Input Manual UUID / Kode Tiket</h3>
        <p style={{ fontSize: "12px", color: "var(--text-subtle)", marginBottom: "14px" }}>
          Gunakan jika layar smartphone peserta retak atau kamera terkendala pencahayaan.
        </p>
        <form onSubmit={handleManualSubmit} style={{ display: "flex", gap: "10px" }}>
          <input
            type="text"
            className="form-input"
            placeholder="Masukkan UUID Tiket (cth: a1b2c3d4-...)"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
          />
          <button
            type="submit"
            className="btn-primary"
            style={{ width: "auto", padding: "12px 24px", whiteSpace: "nowrap" }}
            disabled={isProcessing}
          >
            {isProcessing ? "Memeriksa..." : "Verifikasi"}
          </button>
        </form>
      </div>

      {/* RECENT SCAN HISTORY */}
      {history.length > 0 && (
        <div className="glass-card" style={{ marginTop: "20px" }}>
          <h3 style={{ fontSize: "15px", marginBottom: "12px" }}>📋 Riwayat Scan Sesi Ini</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {history.map((item, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(15, 20, 34, 0.6)",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  borderLeft: item.status === "VALID" ? "4px solid #10b981" : "4px solid #ef4444",
                }}
              >
                <div>
                  <strong style={{ color: "#fff" }}>{item.data?.namaPembeli || "Unknown"}</strong>
                  <div style={{ fontSize: "11px", color: "var(--text-subtle)" }}>
                    {item.data?.kodeTiket || "-"} &bull; {item.time}
                  </div>
                </div>
                <span
                  className={item.status === "VALID" ? "badge badge-success" : "badge badge-danger"}
                  style={{ fontSize: "11px" }}
                >
                  {item.status === "VALID" ? "VALID" : "DUPLICATE"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
