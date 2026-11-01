# Demo Tiket Bus QRIS

Aplikasi demo pemesanan bus untuk rute **Samarinda–Penajam** dan sebaliknya. Alur memakai guest checkout, QRIS, e-tiket QR, scanner, dan ekspor laporan; jadwal, tarif, kapasitas, dan kursi masih data contoh.

> Status: aplikasi menyediakan alur pembelian, login admin, laporan, dan prediksi penjualan. Konfigurasi produksi dan uji menyeluruh tetap perlu diselesaikan sebelum aplikasi digunakan untuk acara sungguhan.

## Fitur yang sudah dibuat

### Pembeli

- Halaman pembelian menampilkan rute, jadwal, tarif contoh, dan kuota dari API.
- Checkout tanpa registrasi akun dengan nama, email, nomor WhatsApp, dan jumlah tiket.
- Pemilih kursi dan tanggal perjalanan untuk demo; kursi belum dikunci antar pembeli.
- Batas jumlah tiket per transaksi divalidasi di UI dan API.
- Kuota ditahan saat checkout menggunakan transaksi database dan row lock untuk mencegah penjualan melebihi stok.
- Halaman pembayaran menampilkan QRIS dan waktu kedaluwarsa; status pembayaran diperiksa berkala.
- Setelah pembayaran berhasil, halaman e-tiket menampilkan QR code dan menyediakan cetak/simpan PDF.
- Data tiket juga disiapkan untuk pengiriman melalui email SMTP.

### Admin dan panitia

- Dashboard admin dibuka langsung melalui `/admin` dan dilindungi login; halaman login tersedia di `/admin/login` dan tidak ditautkan dari menu utama.
- Dashboard menampilkan ringkasan kuota, tiket terjual, kuota tersisa, tren penjualan, dan estimasi tiket/pendapatan dua bulan berikutnya.
- Halaman scanner mendukung pemindaian QR dengan kamera serta input UUID secara manual untuk validasi tiket naik bus.
- API menolak tiket yang belum lunas dan membedakan tiket valid, tidak ditemukan, dan sudah pernah dipindai.
- Check-in menggunakan row lock dalam transaksi agar satu tiket tidak berhasil dipakai dua kali secara bersamaan.
- Laporan Excel `.xlsx` berisi data transaksi/tiket, statistik acara, data bulanan aktual/prediksi, dan diagram batang teks berskala relatif.
- API scanner, simulasi pembayaran lokal, dan ekspor laporan memerlukan sesi admin.

### Integrasi dan data

- API menggunakan Node.js, Express, TypeScript, dan `pg` untuk berinteraksi dengan PostgreSQL.
- Integrasi Midtrans Core API untuk membuat tagihan QRIS dan memeriksa signature webhook.
- Tersedia mode simulasi QRIS/pembayaran untuk pengembangan saat kredensial gateway belum dikonfigurasi.
- Skema Prisma mendeskripsikan tabel kuota tiket, pembeli, transaksi, dan tiket.
- Ada fallback database in-memory saat PostgreSQL tidak dapat dihubungi untuk membantu pengembangan lokal; data fallback ini bukan penyimpanan produksi.

## Struktur proyek

```text
apps/
  api/
    src/
      app.ts                       # Endpoint REST API
      server.ts                    # Menjalankan server Express
      modules/
        checkin/                   # Validasi dan check-in tiket
        payments/                  # Integrasi Midtrans dan QRIS
        reports/                   # Pembuatan ekspor Excel
        tickets/                   # Pengiriman tiket melalui email
        transactions/              # Kuota, checkout, dan transaksi
  web/
    src/
      app/
        page.tsx                   # Halaman guest checkout
        payment/[id]/page.tsx      # Halaman instruksi/status pembayaran
        ticket/[id]/page.tsx       # E-tiket dan QR code
        admin/page.tsx             # Dashboard admin/panitia
        admin/scanner/page.tsx     # Scanner dan check-in
      lib/api.ts                   # Klien untuk REST API
packages/
  database/
    prisma/schema.prisma           # Skema PostgreSQL/Prisma
  shared/src/index.ts              # Tipe request dan response lintas aplikasi
```

## Teknologi

- **Web:** Next.js 15, React 19, TypeScript
- **API:** Node.js, Express 5, TypeScript
- **Database:** PostgreSQL, `pg`, dan Prisma
- **QR:** `qrcode.react` untuk tampilan QR dan `html5-qrcode` untuk scanner kamera
- **Pembayaran:** Midtrans Core API (QRIS)
- **Email:** Nodemailer/SMTP
- **Ekspor:** SheetJS (`xlsx`)
- **Workspace:** pnpm

## Endpoint API

| Method | Endpoint | Kegunaan |
|---|---|---|
| `GET` | `/health` | Memeriksa status API |
| `GET` | `/api/quota` | Mendapatkan informasi kuota aktif |
| `POST` | `/api/checkout` | Membuat transaksi guest checkout dan tagihan QRIS |
| `GET` | `/api/transactions/:id` | Mendapatkan status transaksi beserta tiket |
| `GET` | `/api/tickets/:uuid` | Mendapatkan detail satu tiket |
| `POST` | `/api/payments/webhook` | Menerima notifikasi pembayaran Midtrans |
| `POST` | `/api/payments/simulate-success/:id` | Simulasi pembayaran berhasil untuk pengembangan |
| `POST` | `/api/admin/login` | Login admin dan membuat sesi cookie |
| `POST` | `/api/admin/logout` | Menghapus sesi admin |
| `GET` | `/api/admin/session` | Memeriksa sesi login admin |
| `GET` | `/api/admin/forecast` | Mendapatkan statistik dan prediksi bulanan (admin) |
| `POST` | `/api/scan` | Memvalidasi dan mencatat check-in (admin) |
| `GET` | `/api/reports/export-excel` | Mengunduh laporan backup `.xlsx` (admin) |

## Persiapan menjalankan lokal

### Prasyarat

- Node.js versi LTS
- pnpm
- PostgreSQL lokal atau database PostgreSQL yang dapat diakses

### Instalasi

1. Pasang dependency dari root proyek:

   ```bash
   pnpm install
   ```

2. Salin `.env.example` menjadi `.env` di root proyek dan isi `DATABASE_URL`, konfigurasi Midtrans sandbox, serta SMTP bila ingin menguji pengiriman email.
   - Isi `ADMIN_USERNAME` dan `ADMIN_PASSWORD` untuk akun lokal.
   - Ganti `ADMIN_SESSION_SECRET` dengan secret acak minimal 32 karakter. Contoh pembuatannya: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Pastikan PostgreSQL dapat diakses dan skema/tabel sudah dibuat. Skema ada di `packages/database/prisma/schema.prisma`; belum ada migrasi SQL tersimpan di repository. `pnpm db:migrate` menjalankan Prisma Migrate dan memerlukan `DATABASE_URL` yang valid.
4. Untuk aplikasi web, sediakan `NEXT_PUBLIC_API_URL` pada environment Next.js (contohnya di `apps/web/.env.local`) dengan alamat API, misalnya `http://localhost:4000`.
5. Jalankan API dan web dari dua terminal terpisah:

   ```bash
   pnpm dev:api
   ```

   ```bash
   pnpm dev:web
   ```

6. API berjalan pada port `4000` secara default dan web pada port `3000`. URL/port API dapat diubah melalui `API_PORT`; origin web untuk CORS diatur menggunakan `WEB_ORIGIN`.
7. Buka `http://localhost:3000/admin/login` untuk login, lalu dashboard admin di `http://localhost:3000/admin`. Menu utama tidak menampilkan tautan admin/scanner.

### Perintah workspace

| Perintah | Kegunaan |
|---|---|
| `pnpm dev:api` | Menjalankan API dalam mode pengembangan |
| `pnpm dev:web` | Menjalankan web Next.js |
| `pnpm db:generate` | Membuat Prisma Client |
| `pnpm db:migrate` | Menjalankan migrasi Prisma |
| `pnpm --filter @eticket/api build` | Build TypeScript API |
| `pnpm --filter @eticket/web build` | Build web Next.js |

## Environment

Template konfigurasi tersedia di [.env.example](./.env.example). Variabel yang digunakan:

| Variabel | Kegunaan |
|---|---|
| `DATABASE_URL` | Koneksi PostgreSQL |
| `API_PORT` | Port server API (default `4000`) |
| `NEXT_PUBLIC_API_URL` | URL API yang diakses browser web |
| `WEB_ORIGIN` | Origin web yang diizinkan oleh CORS |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Kredensial satu akun admin lokal |
| `ADMIN_SESSION_SECRET` | Kunci HMAC sesi admin, minimal 32 karakter |
| `PAYMENT_API_BASE_URL` | URL Midtrans, gunakan sandbox saat pengembangan |
| `PAYMENT_API_KEY` | Server Key Midtrans |
| `PAYMENT_WEBHOOK_SECRET` | Tersedia pada template konfigurasi; pastikan mekanisme verifikasi webhook sesuai konfigurasi Midtrans yang dipakai |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Konfigurasi server pengiriman email |
| `EMAIL_FROM` | Alamat pengirim e-tiket |

Jangan commit `.env` atau memasukkan server key/SMTP credential ke variabel `NEXT_PUBLIC_*`.

## Catatan sebelum produksi

- Rute, jadwal, tarif, kapasitas, dan pilihan kursi pada demo belum terhubung ke operator bus. Kursi hanya disimpan di browser, bukan reservasi terjamin pada server.
- Integrasikan operator dan simpan/reservasi kursi di backend sebelum menerima pemesanan perjalanan nyata.

- `/api/payments/simulate-success/:id` hanya tersedia di luar production dan memerlukan sesi admin. Dalam production, `PAYMENT_API_KEY` wajib tersedia dan webhook dengan signature kosong atau tidak valid ditolak (`401`); siapkan kredensial Midtrans sebelum menerima pembayaran nyata.
- Fallback in-memory ditujukan untuk pengembangan dan tidak mempertahankan data setelah proses berhenti. Pastikan PostgreSQL dan tabel sudah benar sebelum pengujian integrasi/produksi.
- Skema Prisma sudah tersedia, tetapi migrasi belum disimpan ke repository. Tinjau hasil migrasi dan seed kuota acara pada database sebelum menjalankan aplikasi.
- Login admin memakai satu akun dari environment dan cookie sesi HttpOnly berdurasi delapan jam; siapkan password dan secret yang berbeda/kuat untuk setiap deployment. Web dan API perlu berada pada origin yang sama atau subdomain satu situs agar kebijakan cookie SameSite=Lax berfungsi.
- Prediksi menggunakan rata-rata bergerak dari sampai tiga bulan terakhir transaksi yang lunas; prediksi tidak tersedia sebelum ada penjualan lunas dan bukan jaminan pendapatan. Dashboard menyediakan diagram garis, sedangkan Excel menyertakan tabel aktual/prediksi dan diagram batang teks berskala relatif sebagai bahan analisis lanjutan.
- Siapkan dan verifikasi webhook publik HTTPS, konfigurasi CORS khusus domain, validasi input, pembatasan request, logging/audit, backup database, serta uji pemulihan.
- Alur pelepasan kuota untuk transaksi kedaluwarsa dan rekonsiliasi pembayaran perlu diuji dan dipastikan sebelum acara.
- Ekspor Excel membantu pencarian data offline, tetapi tidak menyinkronkan hasil scan ketika jaringan terputus. Prosedur check-in offline dan sinkronisasinya masih perlu ditentukan.
- Belum ada suite pengujian otomatis untuk alur checkout bersamaan, callback pembayaran, penerbitan/pengiriman email, scan duplikat, dan ekspor.
