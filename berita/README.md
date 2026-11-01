# Berita OpenSource

Portal berita modern, mandiri, dan portabel yang dibangun menggunakan **Node.js**, **Express**, **SQLite (better-sqlite3)**, template engine **EJS**, serta **Vanilla CSS & JS**. Berjalan secara default di `http://localhost:3000`.

---

## 🚀 Fitur Utama

### 1. Halaman Publik Pembaca
- **Beranda**: Berita utama (Headline), grid "Berita Terbaru" dengan paginasi, dan sidebar pemeringkatan "Berita Populer" (berdasarkan jumlah views).
- **Kategori & Pencarian**: Filter berita per topik dan fitur pencarian judul serta isi berita.
- **Halaman Baca Artikel**: Menampilkan judul, kategori, penulis, tanggal format Indonesia (WIB), counter pembaca (+1 setiap dibuka), cover gambar, isi artikel terformat, tagar topik, dan kartu berita terkait.
- **Desain & Responsif**: Tipografi modern, layout adaptif mobile, serta dukungan **Mode Gelap / Terang (Dark/Light Mode)** yang tersimpan di `localStorage`.
- **Privasi & Keamanan**: Bersih 100% tanpa tautan atau tombol admin/login di seluruh halaman publik.

### 2. Panel Redaksi Tersembunyi & Sistem Keamanan
- **Alamat Rahasia**: Panel admin berada di URL dinamis yang ditentukan oleh `ADMIN_PATH` di `.env` (default: `/admin`).
- **Autentikasi & Sesi**: Autentikasi username + password dengan hash `bcrypt`. Cookie sesi `httpOnly` dan `sameSite: lax` disimpan di database SQLite `data/sessions.db`.
- **Proteksi CSRF**: Semua form berstatus `POST` terproteksi dengan Synchronizer Token Pattern (CSRF Token).
- **Wajib Ganti Password**: Akun baru atau akun yang di-reset wajib mengganti password sementara (minimal 8 karakter dan tidak boleh sama dengan username) sebelum dapat mengakses dashboard.
- **Otorisasi Peran**:
  - **Owner**: Akses penuh ke seluruh fitur, termasuk Manajemen Pengguna dan Backup/Restore.
  - **Editor**: Mengelola seluruh berita redaksi (menerbitkan, mengubah, menghapus) dan rubrik kategori.
  - **Penulis**: Hanya dapat menulis dan menyunting naskah miliknya sendiri dengan status `draft` atau `diajukan`.

### 3. Data Portabel (Single Folder `./data`)
Semua aset penting aplikasi disimpan terpusat di dalam satu folder:
```text
./data/
├── berita.db       # Database SQLite utama (skema berita, pengguna, kategori, tag)
├── sessions.db     # Sesi login pengguna
├── uploads/        # Gambar artikel yang diunggah
└── backup/         # Berkas cadangan arsip ZIP
```

---

## 📋 Panduan Instalasi & Menjalankan

### Persyaratan Sistem
- **Node.js** versi 22 ke atas
- **npm** versi 9 ke atas

### 1. Clone & Pasang Dependensi
```bash
git clone https://github.com/LenRenCode/web-news-berita.git
cd web-news-berita
npm install
```

### 2. Konfigurasi Lingkungan (`.env`)
Salin file template `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Sesuaikan konfigurasi di dalam file `.env`:
```ini
PORT=3000
DATA_DIR=./data
ADMIN_PATH=admin
SESSION_SECRET=kunci_rahasia_sesi_berita_opensource_acak_dan_panjang_minimal_32_karakter
OWNER_USERNAME=<set-unique-owner-name>
OWNER_PASSWORD=<set-unique-strong-password>
```

### 3. Menjalankan Server
- **Mode Produksi**:
  ```bash
  npm start
  ```
- **Mode Pengembangan (Hot Reload)**:
  ```bash
  npm run dev
  ```
Buka browser di [http://localhost:3000](http://localhost:3000) untuk mengakses portal berita publik, atau [http://localhost:3000/admin](http://localhost:3000/admin) untuk masuk ke panel redaksi.

---

## 🚚 Cara Memindahkan Aplikasi ke Komputer Lain (Portabilitas Data)

Karena seluruh data aplikasi tersimpan di dalam folder `./data`, Anda dapat memindahkan web berita ke komputer atau server lain tanpa perlu melakukan export-import database yang rumit:

1. **Salin Folder Proyek**:
   Salin seluruh direktori proyek, pastikan folder **`./data`** dan file **`.env`** ikut terbawa ke komputer baru.
2. **Pasang Dependensi di Komputer Baru**:
   ```bash
   npm install
   ```
3. **Jalankan Aplikasi**:
   ```bash
   npm start
   ```
Semua artikel, gambar sampul, data pengguna, dan sesi login akan **langsung berjalan persis seperti di komputer sebelumnya**!

---

## ⚙️ Penjelasan Variabel `.env`

| Variabel | Keterangan | Nilai Default |
| :--- | :--- | :--- |
| `PORT` | Port jaringan lokal tempat server web berjalan. | `3000` |
| `DATA_DIR` | Lokasi folder penyimpanan database, uploads, dan backup. | `./data` |
| `ADMIN_PATH` | Path URL rahasia untuk mengakses panel admin (tanpa tanda slash). | `admin` |
| `SESSION_SECRET` | Kunci enkripsi rahasia untuk menandatangani cookie sesi. | *(Acak / Rahasia)* |
| `OWNER_USERNAME` | Username akun Owner pertama (hanya dibuat saat database pertama kali diinisialisasi). | `admin` |
| `OWNER_PASSWORD` | Password awal akun Owner pertama (wajib diganti pada login pertama). | `OwnerPassword123!` |

---

## 💾 Fitur Backup & Restore (Khusus Owner)

1. **Buat Backup**:
   - Masuk ke panel admin sebagai Owner -> Menu **Backup**.
   - Klik tombol **Buat Backup**.
   - Sistem akan menggunakan **Backup API native `better-sqlite3`** untuk membuat snapshot `berita.db` yang konsisten tanpa mengunci database, lalu mengompresnya bersama folder `uploads/` ke dalam arsip `.zip`.
2. **Unduh & Hapus**:
   - Riwayat backup tersimpan rapi dan dapat diunduh kapan saja untuk arsip lokal.
3. **Restore Cadangan**:
   - Unggah berkas backup `.zip`.
   - Sistem secara otomatis:
     1. Memvalidasi isi arsip (mencegah eksploitasi Zip-Slip).
     2. Memeriksa integritas database SQLite.
     3. **Membuat backup pengaman otomatis** dari data lama sebelum proses penimpaan dilakukan.
     4. Mengganti database dan folder uploads, kemudian meminta restart server.

---

## 🛡️ Kebijakan Hak Akses Akun & Perlindungan

- **Akun Tidak Boleh Dihapus**: Demi integritas relasi artikel jurnalistik lama, akun pengguna hanya dapat dinonaktifkan (`is_active = 0`) atau diaktifkan kembali (`is_active = 1`).
- **Proteksi Owner Terakhir**: Sistem secara otomatis menolak upaya penonaktifan atau penurunan peran bagi akun Owner aktif terakhir.
- **Sanitasi HTML**: Seluruh naskah artikel dibersihkan menggunakan `sanitize-html` untuk mencegah injeksi script dan XSS.

---

## 📄 Lisensi
Hak Cipta Dilindungi Undang-Undang &copy; 2026 **Berita OpenSource**.
