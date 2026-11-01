const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { dataDir } = require('../db');

function revokeUserSessions(userId) {
  const sessionDbPath = path.join(dataDir, 'sessions.db');
  if (!fs.existsSync(sessionDbPath)) {
    throw new Error('Database sesi belum tersedia; sesi pengguna tidak dapat dicabut.');
  }

  const sessionDb = new Database(sessionDbPath);
  try {
    return sessionDb.prepare(`
      DELETE FROM sessions
      WHERE json_extract(sess, '$.user.id') = ?
    `).run(userId).changes;
  } finally {
    sessionDb.close();
  }
}

module.exports = { revokeUserSessions };
