// Middleware Upload Gambar Artikel Menggunakan Multer
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { uploadsDir } = require('../db/index');

// Konfigurasi penyimpanan disk di folder portabel data/uploads/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Nama file acak untuk mencegah konflik dan path traversal
    const ext = path.extname(file.originalname).toLowerCase();
    const randomName = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, randomName);
  }
});

// Filter tipe file: hanya jpg, jpeg, png, webp
function fileFilter(req, file, cb) {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format file tidak didukung! Hanya diperbolehkan JPG, PNG, atau WebP.'));
  }
}

// Batasan ukuran maksimum: 3 MB
const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024 // 3 MB
  },
  fileFilter
});

module.exports = upload;
