"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const BUS_TRIPS = [
  { id: 1, origin: "Samarinda", destination: "Penajam", departure: "08:00" },
  { id: 2, origin: "Samarinda", destination: "Penajam", departure: "13:00" },
  { id: 3, origin: "Samarinda", destination: "Penajam", departure: "17:00" },
  { id: 4, origin: "Penajam", destination: "Samarinda", departure: "08:00" },
  { id: 5, origin: "Penajam", destination: "Samarinda", departure: "13:00" },
  { id: 6, origin: "Penajam", destination: "Samarinda", departure: "17:00" },
] as const;

const SEATS = Array.from({ length: 10 }, (_, row) =>
  ["A", "B", "C", "D"].map((column) => `${row + 1}${column}`)
).flat();

function getLocalDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

export default function GuestCheckoutPage() {
  const router = useRouter();

  const [quotaData, setQuotaData] = useState({
    namaEvent: "Samarinda → Penajam",
    kategori: "Bus demo · 08:00",
    harga: 150000,
    totalKuota: 40,
    sisaKuota: 40,
  });
  const [tripId, setTripId] = useState<number>(1);
  const [travelDate, setTravelDate] = useState(getLocalDate);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);

  const [form, setForm] = useState({
    nama: "",
    email: "",
    noWhatsapp: "",
    jumlahTiket: 1,
  });

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedTrip = BUS_TRIPS.find((trip) => trip.id === tripId) ?? BUS_TRIPS[0];
  const direction = `${selectedTrip.origin} → ${selectedTrip.destination}`;
  const schedules = BUS_TRIPS.filter(
    (trip) => trip.origin === selectedTrip.origin
  );

  useEffect(() => {
    let cancelled = false;
    api
      .getQuota(tripId)
      .then((res) => {
        if (!cancelled && res.data) {
          setQuotaData({
            namaEvent: res.data.namaEvent,
            kategori: res.data.kategori,
            harga: Number(res.data.harga),
            totalKuota: Number(res.data.totalKuota),
            sisaKuota: Number(res.data.sisaKuota),
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Gagal memuat kuota perjalanan:", err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const totalBayar = form.jumlahTiket * quotaData.harga;

  const handleQtyChange = (delta: number) => {
    const nextVal = form.jumlahTiket + delta;
    if (nextVal >= 1 && nextVal <= 5) {
      setForm({ ...form, jumlahTiket: nextVal });
      setSelectedSeats((seats) => seats.slice(0, nextVal));
    }
  };

  const toggleSeat = (seat: string) => {
    setSelectedSeats((seats) => {
      if (seats.includes(seat)) return seats.filter((item) => item !== seat);
      if (seats.length >= form.jumlahTiket) return seats;
      return [...seats, seat];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (!form.nama.trim() || !form.email.trim() || !form.noWhatsapp.trim()) {
      setErrorMessage("Mohon lengkapi seluruh kolom formulir.");
      return;
    }
    if (travelDate < getLocalDate()) {
      setErrorMessage("Tanggal keberangkatan tidak boleh lewat.");
      return;
    }
    if (selectedSeats.length !== form.jumlahTiket) {
      setErrorMessage(`Pilih ${form.jumlahTiket} kursi sesuai jumlah penumpang.`);
      return;
    }

    setLoading(true);
    try {
      const response = await api.checkout({
        nama: form.nama,
        email: form.email,
        noWhatsapp: form.noWhatsapp,
        jumlahTiket: form.jumlahTiket,
        kuotaId: selectedTrip.id,
      });

      if (response.success && response.data?.transaksiId) {
        try {
          window.localStorage.setItem(
            `bus-booking-${response.data.transaksiId}`,
            JSON.stringify({
              origin: selectedTrip.origin,
              destination: selectedTrip.destination,
              travelDate,
              departure: selectedTrip.departure,
              seatNumbers: selectedSeats,
            })
          );
        } catch (storageError) {
          console.warn("Detail kursi demo tidak dapat disimpan di browser.", storageError);
        }
        router.push(`/payment/${response.data.transaksiId}`);
      } else {
        throw new Error(response.message || "Gagal membuat transaksi");
      }
    } catch (err: any) {
      setErrorMessage(
        err.message || "Terjadi kesalahan saat memproses checkout."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-container">
      <div className="hero-card">
        <div className="hero-layout">
          <div className="hero-info">
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
              <span className="badge badge-primary">Rute Bus Antar Kota</span>
              <span className="badge badge-success">
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: "#10b981",
                    boxShadow: "0 0 8px #10b981",
                    display: "inline-block",
                  }}
                />
                Tersisa {quotaData.sisaKuota} kursi
              </span>
            </div>
            <h1>{quotaData.namaEvent}</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
              {selectedTrip.origin} &bull; {selectedTrip.destination} &bull; Keberangkatan {selectedTrip.departure}
            </p>
          </div>

          <div className="hero-price-box">
            <div style={{ fontSize: "11px", color: "var(--text-subtle)", textTransform: "uppercase", fontWeight: 700 }}>
              Tarif demo per penumpang
            </div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#a5b4fc", marginTop: "2px" }}>
              {quotaData.kategori}
            </div>
            <div style={{ fontSize: "24px", fontWeight: "800", color: "#34d399", marginTop: "4px" }}>
              Rp {quotaData.harga.toLocaleString("id-ID")}
            </div>
          </div>
        </div>
      </div>

      <div className="checkout-grid">
        <div className="glass-card">
          <div style={{ marginBottom: "22px" }}>
            <h2 style={{ fontSize: "20px", marginBottom: "4px" }}>Pesan Tiket Bus</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "13.5px" }}>
              Pilih rute, jadwal, dan kursi. Data perjalanan ini masih berupa contoh.
            </p>
          </div>

          {errorMessage && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#fca5a5",
                padding: "12px 16px",
                borderRadius: "12px",
                fontSize: "13.5px",
                marginBottom: "18px",
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="bus-direction">Rute perjalanan</label>
              <select
                id="bus-direction"
                className="form-input"
                value={direction}
                onChange={(e) => {
                  const firstTrip = BUS_TRIPS.find(
                    (trip) => `${trip.origin} → ${trip.destination}` === e.target.value
                  );
                  if (firstTrip) {
                    setTripId(firstTrip.id);
                    setSelectedSeats([]);
                  }
                }}
              >
                <option value="Samarinda → Penajam">Samarinda → Penajam</option>
                <option value="Penajam → Samarinda">Penajam → Samarinda</option>
              </select>
            </div>

            <div className="booking-fields-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="travel-date">Tanggal berangkat</label>
                <input
                  id="travel-date"
                  type="date"
                  className="form-input"
                  min={getLocalDate()}
                  value={travelDate}
                  onChange={(e) => setTravelDate(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="departure-time">Jadwal contoh</label>
                <select
                  id="departure-time"
                  className="form-input"
                  value={tripId}
                  onChange={(e) => {
                    setTripId(Number(e.target.value));
                    setSelectedSeats([]);
                  }}
                >
                  {schedules.map((trip) => (
                    <option key={trip.id} value={trip.id}>{trip.departure} WITA</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="passenger-name">Nama penumpang</label>
              <input
                id="passenger-name"
                type="text"
                className="form-input"
                placeholder="Nama sesuai identitas"
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="passenger-email">Alamat email</label>
              <input
                id="passenger-email"
                type="email"
                className="form-input"
                placeholder="nama@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
              <span style={{ fontSize: "11.5px", color: "var(--text-subtle)", marginTop: "4px", display: "block" }}>
                E-tiket dikirim setelah pembayaran terkonfirmasi.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="passenger-phone">Nomor WhatsApp</label>
              <input
                id="passenger-phone"
                type="tel"
                className="form-input"
                placeholder="08xxxxxxxxxx"
                value={form.noWhatsapp}
                onChange={(e) => setForm({ ...form, noWhatsapp: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Jumlah penumpang (maks. 5)</label>
              <div className="qty-stepper">
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => handleQtyChange(-1)}
                  disabled={form.jumlahTiket <= 1}
                  aria-label="Kurang tiket"
                >
                  -
                </button>
                <span className="qty-value">{form.jumlahTiket}</span>
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => handleQtyChange(1)}
                  disabled={form.jumlahTiket >= 5}
                  aria-label="Tambah tiket"
                >
                  +
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Pilih kursi ({selectedSeats.length}/{form.jumlahTiket})</label>
              <div
                role="group"
                aria-label="Pilih nomor kursi"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "8px",
                  maxWidth: "300px",
                }}
              >
                {SEATS.map((seat) => {
                  const selected = selectedSeats.includes(seat);
                  return (
                    <button
                      key={seat}
                      type="button"
                      className={`seat-option${selected ? " selected" : ""}`}
                      aria-pressed={selected}
                      disabled={!selected && selectedSeats.length >= form.jumlahTiket}
                      onClick={() => toggleSeat(seat)}
                    >
                      {seat}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: "11.5px", color: "var(--text-subtle)", marginTop: "8px", display: "block" }}>
                Kursi, operator, jadwal, dan tarif ini masih data demo; pilihan kursi belum dikunci antar pembeli.
              </span>
            </div>

            <div
              style={{
                background: "rgba(99, 102, 241, 0.08)",
                border: "1px solid rgba(99, 102, 241, 0.22)",
                padding: "16px 18px",
                borderRadius: "14px",
                marginBottom: "22px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13.5px" }}>
                <span style={{ color: "var(--text-muted)" }}>
                  {form.jumlahTiket}x kursi {selectedSeats.join(", ") || "belum dipilih"}
                </span>
                <span style={{ fontWeight: 600 }}>Rp {totalBayar.toLocaleString("id-ID")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13.5px" }}>
                <span style={{ color: "var(--text-muted)" }}>Biaya Transaksi QRIS</span>
                <span style={{ color: "#34d399", fontWeight: 700 }}>GRATIS (Rp 0)</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: "10px",
                  borderTop: "1px solid rgba(255, 255, 255, 0.1)",
                  fontSize: "17px",
                  fontWeight: "bold",
                }}
              >
                <span>Total Tagihan</span>
                <span style={{ color: "#818cf8" }}>Rp {totalBayar.toLocaleString("id-ID")}</span>
              </div>
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Memproses pemesanan..." : "Lanjut ke Pembayaran QRIS"}
            </button>
          </form>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div className="glass-card">
            <h3 style={{ fontSize: "17px", marginBottom: "14px" }}>Informasi perjalanan</h3>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "12px" }}>
              <li style={{ display: "flex", gap: "10px", fontSize: "13.5px", color: "var(--text-muted)" }}>
                <span style={{ color: "#10b981", fontSize: "16px", fontWeight: 800 }}>✓</span>
                <span>
                  <strong style={{ color: "#fff" }}>Rute:</strong> {direction}
                </span>
              </li>
              <li style={{ display: "flex", gap: "10px", fontSize: "13.5px", color: "var(--text-muted)" }}>
                <span style={{ color: "#10b981", fontSize: "16px", fontWeight: 800 }}>✓</span>
                <span>
                  <strong style={{ color: "#fff" }}>Keberangkatan:</strong> {travelDate} pukul {selectedTrip.departure} WITA.
                </span>
              </li>
            </ul>
          </div>

          <div
            className="glass-card"
            style={{
              background: "linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(236, 72, 153, 0.08) 100%)",
              border: "1px solid rgba(99, 102, 241, 0.25)",
            }}
          >
            <h3 style={{ fontSize: "15px", marginBottom: "6px" }}>Status demo</h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "10px", lineHeight: "1.5" }}>
              Belum terhubung ke operator bus. Jadwal dan tarif adalah contoh; jangan gunakan untuk transaksi perjalanan nyata.
            </p>
            <a
              href="https://wa.me/6281234567890"
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: "13px",
                fontWeight: "700",
                color: "#34d399",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              Hubungi WhatsApp Panitia &rarr;
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
