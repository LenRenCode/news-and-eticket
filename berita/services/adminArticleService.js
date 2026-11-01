// Service Manajemen Berita & Redaksi di Panel Admin
const path = require('path');
const fs = require('fs');
const sanitizeHtml = require('sanitize-html');
const { db, uploadsDir } = require('../db/index');
const { slugify } = require('./categoryService');

const ARTICLE_STATUSES = ['draft', 'diajukan', 'terbit'];

// Konfigurasi Sanitasi HTML untuk Konten Artikel
const SANITIZE_OPTIONS = {
  allowedTags: [
    'h2', 'h3', 'h4', 'p', 'b', 'i', 'strong', 'em', 'u', 's',
    'ul', 'ol', 'li', 'a', 'blockquote', 'hr', 'br', 'span'
  ],
  allowedAttributes: {
    'a': ['href', 'target', 'rel', 'title']
  },
  allowedSchemes: ['http', 'https', 'mailto']
};

function cleanArticleContent(htmlContent) {
  return sanitizeHtml(htmlContent || '', SANITIZE_OPTIONS);
}

// 1. Ambil Statistik Dashboard Sesuai Peran
function getArticleStats(authorId = null) {
  let totalArticles = 0;
  let draftArticles = 0;
  let submittedArticles = 0;
  let todayViews = 0;

  if (authorId) {
    totalArticles = db.prepare('SELECT COUNT(*) AS total FROM articles WHERE author_id = ?').get(authorId).total;
    draftArticles = db.prepare("SELECT COUNT(*) AS total FROM articles WHERE status = 'draft' AND author_id = ?").get(authorId).total;
    submittedArticles = db.prepare("SELECT COUNT(*) AS total FROM articles WHERE status = 'diajukan' AND author_id = ?").get(authorId).total;
    todayViews = db.prepare(`
      SELECT COUNT(v.id) AS total 
      FROM article_views v
      JOIN articles a ON v.article_id = a.id
      WHERE v.viewed_date = CURRENT_DATE AND a.author_id = ?
    `).get(authorId).total;
  } else {
    totalArticles = db.prepare('SELECT COUNT(*) AS total FROM articles').get().total;
    draftArticles = db.prepare("SELECT COUNT(*) AS total FROM articles WHERE status = 'draft'").get().total;
    submittedArticles = db.prepare("SELECT COUNT(*) AS total FROM articles WHERE status = 'diajukan'").get().total;
    todayViews = db.prepare("SELECT COUNT(*) AS total FROM article_views WHERE viewed_date = CURRENT_DATE").get().total;
  }

  return {
    totalArticles,
    draftArticles,
    submittedArticles,
    todayViews,
    // Alias untuk kompatibilitas
    total: totalArticles,
    draft: draftArticles,
    diajukan: submittedArticles,
    dibaca_hari_ini: todayViews
  };
}

// 2. Ambil Semua Kategori untuk Form Editor
function getEditorData() {
  return db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
}

// 3. Ambil Kategori Berdasarkan ID
function getCategoryById(id) {
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

// 4. Simpan / Perbarui Kategori
function saveCategory({ id = null, name }) {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    throw new Error('Nama kategori wajib diisi.');
  }

  let slug = slugify(cleanName);
  if (!slug) slug = 'kategori';

  if (id) {
    const existing = db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').get(slug, id);
    if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;
    db.prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?').run(cleanName, slug, id);
  } else {
    const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(cleanName, slug);
  }
}

// 5. Hapus Kategori
function removeCategory(id) {
  try {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return true;
  } catch (err) {
    return false;
  }
}

// 6. Daftar Artikel untuk Panel Admin (dengan Filter & Otorisasi Peran)
function listArticles({ user, query = '', status = '' }) {
  const conditions = [];
  const params = [];

  // Penulis hanya melihat berita miliknya sendiri
  if (user && user.role === 'penulis') {
    conditions.push('a.author_id = ?');
    params.push(user.id);
  }

  // Filter pencarian judul atau isi
  if (query && query.trim()) {
    conditions.push('(a.title LIKE ? OR a.content LIKE ? OR a.summary LIKE ?)');
    const term = `%${query.trim()}%`;
    params.push(term, term, term);
  }

  // Filter status artikel
  if (status && ARTICLE_STATUSES.includes(status)) {
    conditions.push('a.status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT 
      a.id, a.title, a.slug, a.status, a.views, a.created_at, a.published_at, a.image_path,
      c.name AS category_name,
      u.username AS author_name,
      a.author_id
    FROM articles a
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN users u ON a.author_id = u.id
    ${whereClause}
    ORDER BY a.created_at DESC
  `).all(...params);
}

// 7. Ambil Berita untuk Form Edit
function getArticleForEditor(id, user) {
  const article = db.prepare(`
    SELECT a.*, c.name AS category_name
    FROM articles a
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.id = ?
  `).get(id);

  if (!article) return null;

  // Penulis hanya boleh mengedit berita miliknya sendiri
  if (user && user.role === 'penulis' && article.author_id !== user.id) {
    return null;
  }

  const tags = db.prepare(`
    SELECT t.name 
    FROM tags t
    JOIN article_tags at ON t.id = at.tag_id
    WHERE at.article_id = ?
  `).all(id);

  article.tags = tags.map(t => t.name);
  article.tagsString = article.tags.join(', ');
  return article;
}

// Helper Sinkronisasi Tag
function syncArticleTags(articleId, tagsInput) {
  db.prepare('DELETE FROM article_tags WHERE article_id = ?').run(articleId);

  let tagArray = [];
  if (Array.isArray(tagsInput)) {
    tagArray = tagsInput;
  } else if (typeof tagsInput === 'string') {
    tagArray = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
  }

  const tagNames = [...new Set(tagArray.map(t => t.trim()).filter(Boolean))];
  const insertTagStmt = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
  const linkStmt = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');

  for (const name of tagNames) {
    insertTagStmt.run(name);
    const tag = getTagStmt.get(name);
    if (tag) {
      linkStmt.run(articleId, tag.id);
    }
  }
}

// 8. Simpan Berita Baru atau Pembaruan Berita
function saveArticle({ articleId = null, user, fields, imagePath = null }) {
  const title = (fields.title || '').trim();
  const categoryId = fields.category_id ? parseInt(fields.category_id) : null;
  const rawStatus = (fields.status || 'draft').trim();
  const rawContent = fields.content || '';
  const rawSummary = fields.summary || '';
  const tags = fields.tags || '';

  if (!title) {
    throw new Error('Judul berita wajib diisi.');
  }
  if (!categoryId) {
    throw new Error('Kategori berita wajib dipilih.');
  }

  // Sanitasi konten artikel dengan sanitize-html
  const content = cleanArticleContent(rawContent);

  // Validasi status penerbitan berdasarkan peran
  let status = 'draft';
  if (user.role === 'penulis') {
    // Penulis hanya boleh memilih draft atau diajukan
    status = rawStatus === 'diajukan' ? 'diajukan' : 'draft';
  } else {
    // Editor dan Owner boleh menerbitkan
    status = ARTICLE_STATUSES.includes(rawStatus) ? rawStatus : 'draft';
  }

  const summary = (rawSummary || '').trim() ||
    content.replace(/<[^>]*>?/gm, '').slice(0, 160).trim();

  // Mode Edit
  if (articleId) {
    const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
    if (!existing) return null;

    if (user.role === 'penulis' && existing.author_id !== user.id) {
      throw new Error('Anda tidak memiliki izin untuk mengedit naskah ini.');
    }

    let slug = existing.slug;
    if (title !== existing.title) {
      let baseSlug = slugify(title) || 'berita';
      slug = baseSlug;
      let counter = 1;
      while (db.prepare('SELECT id FROM articles WHERE slug = ? AND id != ?').get(slug, articleId)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
    }

    let publishedAt = existing.published_at;
    if (status === 'terbit' && !publishedAt) {
      publishedAt = new Date().toISOString();
    } else if (status !== 'terbit') {
      publishedAt = null;
    }

    const finalImagePath = imagePath || existing.image_path || '/images/default-article.svg';

    db.prepare(`
      UPDATE articles SET
        title = ?,
        slug = ?,
        summary = ?,
        content = ?,
        image_path = ?,
        category_id = ?,
        status = ?,
        published_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, slug, summary, content, finalImagePath, categoryId, status, publishedAt, articleId);

    syncArticleTags(articleId, tags);

    return {
      articleId,
      previousImagePath: imagePath && existing.image_path !== imagePath ? existing.image_path : null
    };
  }

  // Mode Buat Baru
  let baseSlug = slugify(title) || 'berita';
  let slug = baseSlug;
  let counter = 1;
  while (db.prepare('SELECT id FROM articles WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  const publishedAt = status === 'terbit' ? new Date().toISOString() : null;
  const finalImagePath = imagePath || '/images/default-article.svg';

  const info = db.prepare(`
    INSERT INTO articles (
      title, slug, summary, content, image_path, category_id,
      author_id, status, views, published_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(title, slug, summary, content, finalImagePath, categoryId, user.id, status, publishedAt);

  const newArticleId = info.lastInsertRowid;
  syncArticleTags(newArticleId, tags);

  return { articleId: newArticleId, previousImagePath: null };
}

// 9. Hapus Berita
function removeArticle(id, imagePath = null) {
  try {
    db.prepare('DELETE FROM articles WHERE id = ?').run(id);

    // Hapus file gambar jika ada di uploads/ dan bukan default
    if (imagePath && imagePath.startsWith('/uploads/')) {
      const filename = path.basename(imagePath);
      const fullPath = path.join(uploadsDir, filename);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  ARTICLE_STATUSES,
  cleanArticleContent,
  getArticleStats,
  getEditorData,
  getCategoryById,
  saveCategory,
  removeCategory,
  listArticles,
  getArticleForEditor,
  saveArticle,
  removeArticle
};
