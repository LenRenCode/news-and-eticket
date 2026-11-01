// Koneksi Database dan Pengaturan Folder Data Portabel
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

// Tentukan path folder data (default: ./data)
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || './data');
const uploadsDir = path.join(dataDir, 'uploads');
const backupDir = path.join(dataDir, 'backup');

// Buat folder data dan subfoldernya secara otomatis jika belum ada
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Inisialisasi database SQLite utama
const dbPath = path.join(dataDir, 'berita.db');
const db = new Database(dbPath);

// Konfigurasi performa dan integritas data
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = {
  db,
  dataDir,
  uploadsDir,
  backupDir,
  dbPath
};
