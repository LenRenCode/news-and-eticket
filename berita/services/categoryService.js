// Service Manajemen Kategori (Editor & Owner)
const { db } = require('../db/index');

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Ganti spasi dengan -
    .replace(/[^\w\-]+/g, '')       // Hapus karakter non-word
    .replace(/\-\-+/g, '-')         // Ganti beberapa - berurutan dengan satu -
    .replace(/^-+/, '')             // Hapus - di awal
    .replace(/-+$/, '');            // Hapus - di akhir
}

// 1. Ambil Semua Kategori Beserta Jumlah Artikel
function getAllCategoriesWithCounts() {
  return db.prepare(`
    SELECT c.*, COUNT(a.id) AS article_count
    FROM categories c
    LEFT JOIN articles a ON c.id = a.category_id
    GROUP BY c.id
    ORDER BY c.id ASC
  `).all();
}

// 2. Ambil Kategori Berdasarkan ID
function getCategoryById(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

// 3. Tambah Kategori Baru
function createCategory(name, customSlug = '') {
  const cleanName = (name || '').trim();
  let cleanSlug = (customSlug || '').trim() || slugify(cleanName);

  if (!cleanName) {
    return { success: false, message: 'Nama kategori wajib diisi.' };
  }

  // Cek duplikasi slug
  const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(cleanSlug);
  if (existing) {
    cleanSlug = `${cleanSlug}-${Date.now().toString().slice(-4)}`;
  }

  try {
    const info = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(cleanName, cleanSlug);
    return { success: true, id: info.lastInsertRowid };
  } catch (err) {
    return { success: false, message: 'Gagal menambahkan kategori: ' + err.message };
  }
}

// 4. Ubah Kategori
function updateCategory(id, name, customSlug = '') {
  const cleanName = (name || '').trim();
  let cleanSlug = (customSlug || '').trim() || slugify(cleanName);

  if (!cleanName) {
    return { success: false, message: 'Nama kategori wajib diisi.' };
  }

  // Cek duplikasi slug pada kategori lain
  const existing = db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').get(cleanSlug, id);
  if (existing) {
    cleanSlug = `${cleanSlug}-${Date.now().toString().slice(-4)}`;
  }

  try {
    db.prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?').run(cleanName, cleanSlug, id);
    return { success: true };
  } catch (err) {
    return { success: false, message: 'Gagal memperbarui kategori: ' + err.message };
  }
}

// 5. Hapus Kategori
function deleteCategory(id) {
  try {
    // Foreign key articles.category_id ON DELETE SET NULL akan otomatis mengosongkan relasi artikel
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return { success: true };
  } catch (err) {
    return { success: false, message: 'Gagal menghapus kategori: ' + err.message };
  }
}

module.exports = {
  slugify,
  getAllCategoriesWithCounts,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory
};
