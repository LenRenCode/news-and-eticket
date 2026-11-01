const bcrypt = require('bcrypt');
const { db } = require('../db');
const { revokeUserSessions } = require('./sessionService');

const USER_ROLES = ['owner', 'editor', 'penulis'];

function listUsers() {
  return db.prepare(`
    SELECT id, username, role, is_active, must_change_password, created_at
    FROM users
    ORDER BY username COLLATE NOCASE
  `).all();
}

function validateCredentials(usernameInput, passwordInput) {
  const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
  const password = typeof passwordInput === 'string' ? passwordInput : '';

  if (!username || username.length > 50) {
    throw new Error('Username wajib diisi dan maksimal 50 karakter.');
  }
  if ([...password].length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password harus minimal 8 karakter dan maksimal 72 byte.');
  }
  if (password.toLocaleLowerCase() === username.toLocaleLowerCase()) {
    throw new Error('Password tidak boleh sama dengan username.');
  }

  return { username, password };
}

function createUser({ username: usernameInput, password: passwordInput, role }) {
  const { username, password } = validateCredentials(usernameInput, passwordInput);
  if (!USER_ROLES.includes(role)) throw new Error('Peran pengguna tidak valid.');

  try {
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active, must_change_password)
      VALUES (?, ?, ?, 1, 1)
    `).run(username, bcrypt.hashSync(password, 10), role);
    return Number(result.lastInsertRowid);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('Username tersebut sudah digunakan.');
    }
    throw error;
  }
}

function resetUserPassword(userId, passwordInput) {
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Pengguna tidak ditemukan.');
  const { password } = validateCredentials(user.username, passwordInput);
  revokeUserSessions(userId);
  const result = db.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = 1
    WHERE id = ?
  `).run(bcrypt.hashSync(password, 10), userId);

  if (!result.changes) throw new Error('Pengguna tidak ditemukan.');
}

function ensureOwnerRemainsActive({ userId, nextRole, nextActive }) {
  const target = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(userId);
  if (!target) throw new Error('Pengguna tidak ditemukan.');

  const removesActiveOwner = target.role === 'owner' && target.is_active === 1 &&
    (nextRole !== 'owner' || nextActive !== 1);
  if (!removesActiveOwner) return;

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total
    FROM users
    WHERE role = 'owner' AND is_active = 1 AND id != ?
  `).get(userId);
  if (total === 0) throw new Error('Owner aktif terakhir tidak dapat dinonaktifkan atau diturunkan perannya.');
}

function updateUserRole(userId, role) {
  if (!USER_ROLES.includes(role)) throw new Error('Peran pengguna tidak valid.');

  const update = db.transaction(() => {
    ensureOwnerRemainsActive({ userId, nextRole: role, nextActive: 1 });
    const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    if (!result.changes) throw new Error('Pengguna tidak ditemukan.');
  });
  update();
}

function setUserActive(userId, isActive) {
  if (![0, 1].includes(isActive)) throw new Error('Status pengguna tidak valid.');

  const update = db.transaction(() => {
    ensureOwnerRemainsActive({ userId, nextRole: 'owner', nextActive: isActive });
    const result = db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive, userId);
    if (!result.changes) throw new Error('Pengguna tidak ditemukan.');
  });
  update();
}

module.exports = {
  USER_ROLES,
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  updateUserRole
};
