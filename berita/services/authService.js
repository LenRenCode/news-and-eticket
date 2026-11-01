// Service Autentikasi dan Manajemen Password
const bcrypt = require('bcrypt');
const { db } = require('../db/index');

// 1. Verifikasi Login Pengguna
function loginUser(username, password) {
  const cleanUsername = (username || '').trim();
  const cleanPassword = password || '';

  if (!cleanUsername || !cleanPassword) {
    return { success: false, message: 'Username atau password salah' };
  }

  // Cari akun berdasarkan username (case-insensitive)
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(cleanUsername);

  // Jika akun tidak ditemukan
  if (!user) {
    return { success: false, message: 'Username atau password salah' };
  }

  // Tolak jika akun berstatus nonaktif (is_active = 0) dengan pesan error generik
  if (user.is_active !== 1) {
    return { success: false, message: 'Username atau password salah' };
  }

  // Verifikasi hash password dengan bcrypt
  const isMatch = bcrypt.compareSync(cleanPassword, user.password_hash);
  if (!isMatch) {
    return { success: false, message: 'Username atau password salah' };
  }

  // Login berhasil (tanpa batasan percobaan login sesuai keputusan pemilik)
  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      must_change_password: user.must_change_password
    }
  };
}

// 2. Ganti Password Wajib Pengguna
function changePassword(userId, currentPassword, newPassword, confirmPassword) {
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(userId);
  if (!user) {
    return { success: false, message: 'Pengguna tidak ditemukan.' };
  }

  if (typeof currentPassword !== 'string' ||
      !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return { success: false, message: 'Password saat ini atau sementara tidak benar.' };
  }

  const cleanNew = typeof newPassword === 'string' ? newPassword : '';
  const cleanConfirm = typeof confirmPassword === 'string' ? confirmPassword : '';

  // Validasi: Minimal 8 karakter
  if (cleanNew.length < 8) {
    return { success: false, message: 'Password baru minimal harus 8 karakter.' };
  }
  if (Buffer.byteLength(cleanNew, 'utf8') > 72) {
    return { success: false, message: 'Password baru maksimal 72 byte.' };
  }

  // Validasi: Tidak boleh sama dengan username
  if (cleanNew.toLowerCase() === user.username.toLowerCase()) {
    return { success: false, message: 'Password baru tidak boleh sama dengan username.' };
  }

  // Validasi: Konfirmasi password harus cocok
  if (cleanNew !== cleanConfirm) {
    return { success: false, message: 'Konfirmasi password tidak cocok.' };
  }

  // Hash password baru dengan bcrypt
  const saltRounds = 10;
  const newHash = bcrypt.hashSync(cleanNew, saltRounds);

  // Update password dan matikan status wajib ganti password (must_change_password = 0)
  db.prepare(`
    UPDATE users 
    SET password_hash = ?, must_change_password = 0
    WHERE id = ?
  `).run(newHash, userId);

  return { success: true };
}

module.exports = {
  loginUser,
  changePassword
};
