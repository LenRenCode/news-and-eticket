const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { ZipArchive } = require('archiver');
const yauzl = require('yauzl');
const Database = require('better-sqlite3');
const { db, dbPath, uploadsDir, backupDir } = require('../db');

const MAX_BACKUP_SIZE = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10000;
const BACKUP_FILENAME = /^(?:namaberita|berita-opensource)-[\dTZ-]+-[a-f0-9]{8}\.zip$/;

function createZip(databasePath, destinationPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationPath, { flags: 'wx' });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      output.destroy();
      reject(error);
    };

    output.once('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.once('error', fail);
    archive.once('error', fail);
    archive.once('warning', fail);

    archive.pipe(output);
    archive.file(databasePath, { name: 'berita.db' });
    archive.directory(uploadsDir, 'uploads');
    archive.finalize().catch(fail);
  });
}

function inspectArchive(archivePath, extractDirectory = null) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: false }, (openError, zipFile) => {
      if (openError) return reject(new Error('File ZIP tidak valid atau rusak.'));

      const entries = [];
      const names = new Set();
      let totalSize = 0;
      let hasDatabase = false;
      let settled = false;

      const fail = error => {
        if (settled) return;
        settled = true;
        zipFile.close();
        reject(error);
      };

      zipFile.once('error', error => fail(
        /invalid relative path|absolute path/i.test(error.message)
          ? new Error('Arsip memuat path yang tidak aman.')
          : new Error(`Gagal membaca ZIP: ${error.message}`)
      ));
      zipFile.on('end', () => {
        if (settled) return;
        if (!hasDatabase) return fail(new Error('Backup ZIP harus berisi berita.db di root arsip.'));
        settled = true;
        zipFile.close();
        resolve(entries);
      });

      zipFile.on('entry', entry => {
        if (settled) return;
        try {
          const entryName = entry.fileName;
          if (entryName.includes('\\') || entryName.startsWith('/') || /^[a-zA-Z]:/.test(entryName)) {
            throw new Error('Arsip memuat path yang tidak aman.');
          }

          const isDirectory = entryName.endsWith('/');
          const pathParts = entryName.split('/');
          if (isDirectory) pathParts.pop();
          if (!pathParts.length || pathParts.some(part => !part || part === '.' || part === '..')) {
            throw new Error('Arsip memuat path yang tidak aman.');
          }
          if (pathParts[0] !== 'uploads' && (entryName !== 'berita.db' || isDirectory)) {
            throw new Error('Arsip memuat file yang tidak diizinkan.');
          }
          if (entryName === 'uploads' || entryName === 'uploads/') {
            if (!isDirectory) throw new Error('Arsip memuat path yang tidak aman.');
          } else if (pathParts[0] === 'uploads' && pathParts.length < 2 && !isDirectory) {
            throw new Error('Arsip memuat path yang tidak aman.');
          }

          const unixMode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (unixMode && unixMode !== (isDirectory ? 0x4000 : 0x8000)) {
            throw new Error('Arsip memuat tipe file yang tidak diizinkan.');
          }
          if (entry.generalPurposeBitFlag & 1) {
            throw new Error('Arsip terenkripsi tidak didukung.');
          }
          if (!isDirectory && entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
            throw new Error('Metode kompresi ZIP tidak didukung.');
          }
          if (entry.uncompressedSize > MAX_BACKUP_SIZE) {
            throw new Error('Ukuran hasil ekstraksi backup melebihi batas 512 MB.');
          }

          const canonicalName = isDirectory ? entryName.slice(0, -1) : entryName;
          if (names.has(canonicalName)) {
            throw new Error('Arsip memuat nama file duplikat.');
          }
          names.add(canonicalName);
          if (names.size > MAX_ARCHIVE_ENTRIES) {
            throw new Error('Arsip berisi terlalu banyak file.');
          }

          totalSize += entry.uncompressedSize;
          if (totalSize > MAX_BACKUP_SIZE) {
            throw new Error('Ukuran hasil ekstraksi backup melebihi batas 512 MB.');
          }
          if (entryName === 'berita.db' && !isDirectory) hasDatabase = true;
          entries.push(entry);

          if (extractDirectory && !isDirectory) {
            const relativePath = entryName === 'berita.db'
              ? 'berita.db'
              : path.join('uploads', ...pathParts.slice(1));
            const destination = path.resolve(extractDirectory, relativePath);
            if (!destination.startsWith(`${path.resolve(extractDirectory)}${path.sep}`)) {
              throw new Error('Arsip memuat path yang tidak aman.');
            }

            fs.mkdirSync(path.dirname(destination), { recursive: true });
            zipFile.openReadStream(entry, (streamError, readStream) => {
              if (streamError) return fail(streamError);
              let extractedSize = 0;
              const sizeGuard = new Transform({
                transform(chunk, encoding, callback) {
                  extractedSize += chunk.length;
                  if (extractedSize > entry.uncompressedSize || extractedSize > MAX_BACKUP_SIZE) {
                    return callback(new Error('Ukuran hasil ekstraksi tidak sesuai dengan arsip.'));
                  }
                  return callback(null, chunk);
                }
              });
              pipeline(readStream, sizeGuard, fs.createWriteStream(destination, { flags: 'wx' }))
                .then(() => zipFile.readEntry())
                .catch(fail);
            });
            return;
          }

          zipFile.readEntry();
        } catch (error) {
          fail(error);
        }
      });

      zipFile.readEntry();
    });
  });
}

function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `berita-opensource-${timestamp}-${crypto.randomBytes(4).toString('hex')}.zip`;
  const backupPath = path.join(backupDir, filename);
  const databaseCopy = path.join(backupDir, `.${filename}.db`);

  return db.backup(databaseCopy)
    .then(() => createZip(databaseCopy, backupPath))
    .then(() => filename)
    .catch(error => {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      throw error;
    })
    .finally(() => {
      if (fs.existsSync(databaseCopy)) fs.unlinkSync(databaseCopy);
    });
}

function listBackups() {
  return fs.readdirSync(backupDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && BACKUP_FILENAME.test(entry.name))
    .map(entry => {
      const fullPath = path.join(backupDir, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        filename: entry.name,
        size: stats.size,
        createdAt: stats.mtime
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

function getBackupPath(filename) {
  if (typeof filename !== 'string' || !BACKUP_FILENAME.test(filename)) return null;
  const fullPath = path.resolve(backupDir, filename);
  return path.dirname(fullPath) === path.resolve(backupDir) ? fullPath : null;
}

function deleteBackup(filename) {
  const backupPath = getBackupPath(filename);
  if (!backupPath || !fs.existsSync(backupPath)) return false;
  fs.unlinkSync(backupPath);
  return true;
}

function validateDatabaseFile(filename) {
  const candidate = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (candidate.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('Database backup tidak lolos pemeriksaan integritas.');
    }

    const tables = new Set(candidate.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all().map(row => row.name));
    for (const table of ['users', 'categories', 'articles', 'tags', 'article_tags']) {
      if (!tables.has(table)) throw new Error(`Tabel ${table} tidak ditemukan di backup.`);
    }
  } finally {
    candidate.close();
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
    else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath);
    else throw new Error('Folder uploads memuat tipe file yang tidak dapat dicadangkan.');
  }
}

function removeDatabaseSidecars() {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
}

async function restoreBackup(uploadFile) {
  if (!uploadFile || typeof uploadFile.path !== 'string' || !fs.existsSync(uploadFile.path)) {
    throw new Error('File backup tidak ditemukan.');
  }
  if (fs.statSync(uploadFile.path).size > MAX_BACKUP_SIZE) {
    throw new Error('Ukuran file backup melebihi batas 512 MB.');
  }

  const tempDir = fs.mkdtempSync(path.join(backupDir, '.restore-'));
  const uploadedArchive = path.join(tempDir, 'uploaded.zip');
  const restoredDirectory = path.join(tempDir, 'restored');
  const restoredDatabase = path.join(restoredDirectory, 'berita.db');
  const restoredUploads = path.join(restoredDirectory, 'uploads');

  try {
    fs.copyFileSync(uploadFile.path, uploadedArchive, fs.constants.COPYFILE_EXCL);
    await inspectArchive(uploadedArchive);
    await inspectArchive(uploadedArchive, restoredDirectory);
    fs.mkdirSync(restoredUploads, { recursive: true });
    validateDatabaseFile(restoredDatabase);

    const safetyBackup = await createBackup();
    const rollbackDir = fs.mkdtempSync(path.join(backupDir, '.rollback-'));
    const rollbackDb = path.join(rollbackDir, 'berita.db');
    const rollbackUploads = path.join(rollbackDir, 'uploads');

    try {
      await db.backup(rollbackDb);
      copyDirectory(uploadsDir, rollbackUploads);

      db.close();
      removeDatabaseSidecars();
      fs.copyFileSync(restoredDatabase, dbPath);
      fs.rmSync(uploadsDir, { recursive: true, force: true });
      fs.renameSync(restoredUploads, uploadsDir);
    } catch (error) {
      if (fs.existsSync(rollbackDb)) {
        removeDatabaseSidecars();
        fs.copyFileSync(rollbackDb, dbPath);
      }
      if (fs.existsSync(rollbackUploads)) {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
        fs.renameSync(rollbackUploads, uploadsDir);
      }
      throw error;
    } finally {
      fs.rmSync(rollbackDir, { recursive: true, force: true });
    }

    return { safetyBackup, restartRequired: true };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  createBackup,
  deleteBackup,
  getBackupPath,
  listBackups,
  restoreBackup
};
