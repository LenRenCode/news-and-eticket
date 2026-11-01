# Portal Berita & Tiket Bus Antar Kota

Aplikasi web terintegrasi satu pintu (single-origin reverse proxy) yang menggabungkan portal berita (`berita/` Express + EJS + SQLite) dan sistem pemesanan tiket bus (`Eticket/` Next.js + Express API + PostgreSQL) di bawah **satu port publik (3000)**.

- **Port Publik (3000)**: Satu-satunya port yang diakses oleh pengguna/browser.
- **Next.js Web (3001)** & **API Tiket (4000)**: Berjalan internal dan hanya mendengarkan pada loopback `127.0.0.1`.
- **Rute URL**:
  - `/` & semua artikel berita dilayani langsung oleh portal Berita.
  - `/tiket/*` diteruskan (reverse proxy) ke Next.js dengan proteksi server-side middleware untuk `/tiket/admin/*`.
  - `/tiket-api/*` diteruskan ke API tiket dengan path rewrite otomatis ke `/api/*`.

---

## ⚙️ Mode Aplikasi: `APP_MODE` (Demo vs Production)

Aplikasi memiliki switch mode eksplisit melalui variabel lingkungan `APP_MODE`:

Jika kedua variabel mode tidak diatur, aplikasi menggunakan **production**.
`NODE_ENV=production` selalu mengalahkan `APP_MODE=demo`; mode demo hanya aktif
jika diminta eksplisit dan proses tidak berjalan sebagai production.

| Fitur / Karakteristik | `APP_MODE=demo` | `APP_MODE=production` |
| :--- | :--- | :--- |
| **Database Tiket** | Boleh In-Memory Mock jika PostgreSQL offline | **WAJIB** PostgreSQL aktif; error fail-closed jika offline |
| **Payment Gateway** | Boleh QRIS simulasi jika key kosong/placeholder | **WAJIB** Server Key Midtrans asli; menolak placeholder |
| **Cookie Sesi** | Tidak menggunakan atribut `Secure` (jalan di HTTP) | Menggunakan `Secure` saat diakses via HTTPS |
| **Simulasi Bayar** | Endpoint `/api/payments/simulate-success` aktif | Endpoint simulasi pembayaran otomatis **404 Nonaktif** |
| **Pelepasan Reservasi** | Aktif transaksional + sweeper berkala | Aktif transaksional + sweeper berkala |

---

## 📋 Prasyarat & Konfigurasi

- **Node.js**: Versi 22+
- **npm** (atau pnpm)
- **PostgreSQL**: Wajib saat `APP_MODE=production`, opsional saat `APP_MODE=demo`.

### 1. Salin Berkas Konfigurasi Lingkungan

Salin template konfigurasi dari root atau subproyek:

```bash
cp .env.example .env
cp berita/.env.example berita/.env
cp Eticket/.env.example Eticket/apps/api/.env
```

Sesuaikan nilai rahasia di dalam file `.env`:
- `APP_MODE`: Atur ke `demo` untuk uji coba lokal, atau `production` untuk staging/produksi.
- `berita/.env`: atur `SESSION_SECRET` (minimal 32 karakter) dan `OWNER_PASSWORD`.
- `Eticket/apps/api/.env`: atur `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, dan `ADMIN_SESSION_SECRET` (minimal 32 karakter).

---

## 🚀 Menjalankan Aplikasi (Satu Perintah)

Semua layanan dapat dijalankan langsung dari direktori root:

### 1. Mode Pengembangan / Demo (`dev:all`)
Menjalankan Berita (Express), Next.js dev server (port 3001 di 127.0.0.1), dan API tiket (tsx di 127.0.0.1:4000) dalam mode demo:

```bash
npm run dev:all
```

### 2. Mode Produksi (`start:all`)
Membangun bundle Next.js (`next build`) & build API TypeScript, lalu menjalankan server produksi. Script ini otomatis menghormati variabel `APP_MODE`:

```bash
# Menjalankan dalam mode produksi standar (fail-closed jika PostgreSQL/Midtrans belum siap):
npm run start:all

# Atau menjalankan production build dalam mode demo di mesin lokal:
APP_MODE=demo npm run start:all
```

---

## 🔒 Konfigurasi Reverse Proxy TLS (Nginx / Caddy) di Depan Port 3000

Pada lingkungan produksi publik, pasang reverse proxy TLS (HTTPS) di depan port 3000. Server Node telah dikonfigurasi dengan `trust proxy = loopback` sehingga `req.ip` membaca IP pengunjung asli dari header `X-Forwarded-For`.

### Contoh Konfigurasi Caddy (`Caddyfile`):
```caddy
yourdomain.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto https
    }
}
```

### Contoh Konfigurasi Nginx:
```nginx
server {
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

### URL Webhook Publik Midtrans:
Daftarkan URL webhook berikut pada Midtrans Dashboard (Settings -> Configuration):
```text
https://yourdomain.com/tiket-api/payments/webhook
```

---

## 📦 Pembersihan & Ekspor Distribusi (`export-clean`)

Untuk membuat paket arsip distribusi yang bersih tanpa dependensi cache (`node_modules`), build output (`.next`, `dist`), kredensial aktif (`.env*`), database lama (`sessions.db`, `berita/data/*.db`), dan file uploads:

```bash
./scripts/export-clean.sh
```

Hasil arsip akan tersimpan sebagai `portalberita-jualticket-clean.zip` dan secara otomatis diverifikasi integritasnya.

---

## 🌐 Akses Pengguna & URL

Setelah server aktif, akses melalui port publik 3000:

- **Portal Berita**: [http://localhost:3000](http://localhost:3000)
- **Pemesanan Tiket Bus**: [http://localhost:3000/tiket](http://localhost:3000/tiket)
- **Panel Admin Tiket**: [http://localhost:3000/tiket/admin](http://localhost:3000/tiket/admin) *(Proteksi server-side)*
- **API Health Check**: [http://localhost:3000/tiket-api/health](http://localhost:3000/tiket-api/health)
- **API Kuota Tiket**: [http://localhost:3000/tiket-api/quota](http://localhost:3000/tiket-api/quota)

---

## 🛡️ Kebijakan Keamanan & Integritas Data

1. **Proteksi Server-Side Admin**: Halaman `/tiket/admin/*` diproteksi sebelum render via Next.js Edge Middleware dengan Web Crypto HMAC-SHA256. Request tanpa cookie sesi valid ditolak langsung dengan HTTP 307 Redirect ke `/tiket/admin/login`.
2. **Pelepasan Reservasi Kuota Kedaluwarsa**: Kuota tiket tertahan (`kuota_terpesan`) otomatis dilepas secara transaksional di dalam kueri checkout (setelah `FOR UPDATE`) serta oleh sweeper berkala di latar belakang.
3. **Pembayaran Terlambat**: Pembayaran webhook yang sah untuk transaksi yang sudah kedaluwarsa ditandai `NEEDS_REFUND`, tidak menerbitkan tiket, dan muncul pada ekspor Excel admin untuk tindak lanjut pengembalian dana.
4. **Rate Limiting**: Pembatasan laju request sederhana diterapkan pada endpoint sensitif API tiket (`POST /api/checkout` maks 20/menit dan `POST /api/admin/login` maks 5/menit). Login portal berita tetap tanpa limitasi sesuai keputusan pemilik.
