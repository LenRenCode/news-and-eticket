# Portal Berita & Sistem Pemesanan E-Tiket Bus Antar Kota

Aplikasi web terintegrasi satu pintu (*single-origin reverse proxy*) yang menggabungkan portal berita (`berita/` Express + EJS + SQLite) dan sistem pemesanan e-tiket bus (`Eticket/` Next.js + Express API + PostgreSQL) di bawah **satu port publik (port 3000)**.

- **Port Publik (3000)**: Satu-satunya port yang diakses oleh pengguna, admin, dan reverse proxy TLS luar.
- **Next.js Web (3001)** & **API Tiket (4000)**: Berjalan internal dan hanya terikat pada loopback `127.0.0.1`.
- **Rute URL**:
  - `/` & semua artikel berita dilayani langsung oleh portal Berita.
  - `/tiket/*` diteruskan (*reverse proxy*) ke Next.js Web dengan proteksi server-side middleware untuk `/tiket/admin/*`.
  - `/tiket-api/*` diteruskan ke API tiket dengan path rewrite otomatis ke `/api/*`.

---

## 🚀 1. Cara Menjalankan

### A. Mode Demo (Cepat / Pengujian Lokal Tanpa PostgreSQL)
Mode demo mengaktifkan in-memory database mock dan simulasi pembayaran QRIS untuk demonstrasi antarmuka:
```bash
# 1. Pasang dependensi
npm install
npm install --prefix berita
pnpm install --dir Eticket

# 2. Jalankan seluruh layanan sekaligus (port 3000)
npm run dev:all
# Atau bila ingin menjalankan production build dalam mode demo:
APP_MODE=demo npm run start:all
```
Buka browser di: [http://localhost:3000](http://localhost:3000).

---

### B. Mode Production (Staging & Live Server)
Mode produksi mewajibkan koneksi PostgreSQL nyata dan kredensial Midtrans asli (*fail-closed* jika database atau kunci belum disetel):
```bash
# 1. Pastikan PostgreSQL sudah aktif dan schema.sql sudah diterapkan (lihat bagian 4)
# 2. Salin dan lengkapi file .env (lihat bagian 3)
cp .env.example .env
cp berita/.env.example berita/.env
cp Eticket/.env.example Eticket/apps/api/.env

# 3. Bangun bundle Next.js & kompilasi TypeScript
npm run build

# 4. Jalankan seluruh layanan
APP_MODE=production npm run start:all
```

---

## 🔑 2. Daftar Variabel Lingkungan Wajib (`.env`)

Seluruh variabel wajib diisi sebelum beralih ke mode produksi. Jangan menyematkan nilai rahasia di repositori atau file publik:

### Root `.env` (atau diekspor ke environment sistem):
```env
APP_MODE=production
NODE_ENV=production
PORT=3000
DATABASE_URL=
SESSION_SECRET=
OWNER_USERNAME=
OWNER_PASSWORD=
ADMIN_USERNAME=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
PAYMENT_API_KEY=
PAYMENT_WEBHOOK_SECRET=
WEB_ORIGIN=
```

### `berita/.env`:
```env
PORT=3000
DATA_DIR=data
SESSION_SECRET=
OWNER_USERNAME=
OWNER_PASSWORD=
ADMIN_PATH=admin
ETICKET_WEB_URL=http://127.0.0.1:3001
ETICKET_API_URL=http://127.0.0.1:4000
```

### `Eticket/apps/api/.env`:
```env
APP_MODE=production
NODE_ENV=production
API_PORT=4000
DATABASE_URL=
ADMIN_USERNAME=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
PAYMENT_API_KEY=
PAYMENT_WEBHOOK_SECRET=
WEB_ORIGIN=http://127.0.0.1:3000
```

---

## 🗄️ 3. Cara Menyiapkan PostgreSQL

1. **Buat Pengguna dan Database PostgreSQL**:
   ```bash
   sudo -u postgres psql
   ```
   Di dalam prompt `psql`:
   ```sql
   CREATE USER eticket_user WITH PASSWORD 'ganti_dengan_password_kuat';
   CREATE DATABASE eticket_db OWNER eticket_user;
   GRANT ALL PRIVILEGES ON DATABASE eticket_db TO eticket_user;
   \c eticket_db
   GRANT ALL ON SCHEMA public TO eticket_user;
   \q
   ```

2. **Terapkan Skema Database**:
   ```bash
   psql -U eticket_user -d eticket_db -h 127.0.0.1 -f Eticket/packages/database/schema.sql
   ```

3. **Format DATABASE_URL**:
   ```text
   DATABASE_URL="postgres://eticket_user:ganti_dengan_password_kuat@127.0.0.1:5432/eticket_db"
   ```

---

## 🔒 4. Konfigurasi Reverse Proxy TLS (Nginx & Caddy)

Pasang reverse proxy dengan sertifikat SSL/TLS di depan port 3000:

### Opsi A: Caddy (`Caddyfile`)
```caddy
portal.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto https
    }
}
```

### Opsi B: Nginx (`/etc/nginx/sites-available/portal`)
```nginx
server {
    listen 80;
    server_name portal.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name portal.example.com;

    ssl_certificate /etc/letsencrypt/live/portal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/portal.example.com/privkey.pem;

    client_max_body_size 25M;

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

---

## 💳 5. URL Webhook Midtrans

Daftarkan URL callback ini pada **Dashboard Midtrans** (*Settings* &rarr; *Configuration* &rarr; *Payment Notification URL*):
```text
https://portal.example.com/tiket-api/payments/webhook
```

---

## 💾 6. Prosedur Backup & Restore

### A. Backup Data
1. **Portal Berita (SQLite & Unggahan Media)**:
   - Unduh langsung melalui Panel Admin Redaksi: `/admin/backup` &rarr; tombol "Unduh Backup `.zip`".
   - Atau salin manual dari terminal:
     ```bash
     tar -czvf backup_berita_$(date +%F).tar.gz berita/data/berita.db berita/data/uploads/
     ```
2. **Sistem Tiket (PostgreSQL)**:
   ```bash
   pg_dump -U eticket_user -h 127.0.0.1 -F c -b -v -f backup_tiket_$(date +%F).dump eticket_db
   ```

### B. Restore Data
1. **Portal Berita**:
   - Melalui Panel Admin: unggah file arsip `.zip` pada halaman `/admin/backup`.
   - Atau pulihkan manual:
     ```bash
     tar -xzvf backup_berita_YYYY-MM-DD.tar.gz
     ```
2. **Sistem Tiket (PostgreSQL)**:
   ```bash
   pg_restore -U eticket_user -h 127.0.0.1 -d eticket_db -c -v backup_tiket_YYYY-MM-DD.dump
   ```

---

## ✅ 7. Checklist Sebelum Online

Sebelum membuka layanan ke publik, periksa seluruh butir berikut:
- [ ] **Domain & TLS**: Domain aktif dan sertifikat HTTPS terpasang valid (Let's Encrypt / ZeroSSL).
- [ ] **Port Internal Tertutup**: Jalankan `ss -tlnp` dan pastikan port 3001 dan 4000 hanya mendengarkan `127.0.0.1`.
- [ ] **Variabel Lingkungan**: Salin `.env` lengkap, set `APP_MODE=production`, dan pastikan tidak ada nilai default/contoh yang tertinggal.
- [ ] **Rotasi Kredensial**: Buat password acak yang kuat untuk owner berita, admin tiket, database PostgreSQL, dan rahasia sesi HMAC (minimal 32 karakter).
- [ ] **Password Awal Redaksi**: Masuk ke panel berita `/admin`, ganti password sementara owner saat login pertama.
- [ ] **Integrasi Midtrans**: Server Key dan Webhook Secret Sandbox/Production sudah dikonfigurasi di dashboard Midtrans.
- [ ] **Uji Coba Transaksi 1 IDR**: Lakukan satu kali checkout uji coba live untuk memverifikasi QRIS dan notifikasi webhook.
- [ ] **Jadwal Backup Otomatis**: Buat cron job harian untuk pencadangan `pg_dump` dan arsip data berita.

---

## 📦 8. Verifikasi Arsip Bersih (`scripts/export-clean.sh`)

Untuk membuat paket arsip bersih siap distribusi:
```bash
./scripts/export-clean.sh
```
Script otomatis memverifikasi bahwa file `.zip` bebas dari `node_modules/`, `.next/`, `dist/`, `.env*` aktif, database lokal, dan file uploads.
