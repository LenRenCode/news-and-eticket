// Service Pengambilan Data Artikel untuk Halaman Publik
const { db } = require('../db/index');
const { cleanArticleContent } = require('./adminArticleService');

const ownerUsername = process.env.OWNER_USERNAME || 'admin';

// Helper query dasar untuk artikel yang berstatus 'terbit'
const BASE_SELECT = `
  SELECT 
    a.id, a.title, a.slug, a.summary, a.content, a.image_path,
    a.status, a.views, a.created_at, a.updated_at, a.published_at,
    c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
    CASE WHEN u.username = ? THEN 'Redaksi' ELSE u.username END AS author_name
  FROM articles a
  LEFT JOIN categories c ON a.category_id = c.id
  LEFT JOIN users u ON a.author_id = u.id
  WHERE a.status = 'terbit'
`;

// 1. Ambil Semua Kategori yang Memiliki Artikel Terbit atau Semua Kategori Aktif
function getAllCategories() {
  return db.prepare(`
    SELECT c.*, COUNT(a.id) AS article_count
    FROM categories c
    LEFT JOIN articles a ON c.id = a.category_id AND a.status = 'terbit'
    GROUP BY c.id
    ORDER BY c.id ASC
  `).all();
}

// 2. Ambil beberapa artikel terbit untuk slider headline.
function getHeadlineArticles(limit = 5) {
  return db.prepare(`
    ${BASE_SELECT}
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ?
  `).all(ownerUsername, limit);
}

function getHeadlineArticle() {
  return getHeadlineArticles(1)[0] || null;
}

// 3. Ambil Daftar Berita Terbaru dengan Paginasi (opsional mengecualikan ID headline)
function getLatestArticles({ page = 1, limit = 6, excludeId = null, excludeIds = [] } = {}) {
  let whereClause = "WHERE a.status = 'terbit'";
  const excludedIds = [...new Set([
    ...excludeIds,
    ...(excludeId === null ? [] : [excludeId])
  ].filter(id => Number.isSafeInteger(Number(id)) && Number(id) > 0).map(Number))];

  if (excludedIds.length) {
    whereClause += ` AND a.id NOT IN (${excludedIds.map(() => '?').join(', ')})`;
  }

  // Hitung total artikel
  const countRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM articles a
    ${whereClause}
  `).get(...excludedIds);

  const total = countRow ? countRow.total : 0;
  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * limit;

  // Ambil data artikel
  const articles = db.prepare(`
    ${BASE_SELECT}
    ${excludedIds.length ? `AND a.id NOT IN (${excludedIds.map(() => '?').join(', ')})` : ""}
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ? OFFSET ?
  `).all(ownerUsername, ...excludedIds, limit, offset);

  return {
    articles,
    total,
    page: currentPage,
    totalPages,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1
  };
}

// 4. Ambil Berita Populer (Berdasarkan views terbanyak)
function getPopularArticles(limit = 5) {
  return db.prepare(`
    ${BASE_SELECT}
    ORDER BY a.views DESC, COALESCE(a.published_at, a.created_at) DESC
    LIMIT ?
  `).all(ownerUsername, limit);
}

// 5. Ambil Berita Berdasarkan Kategori dengan Paginasi
function getArticlesByCategory({ categorySlug, page = 1, limit = 6 }) {
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(categorySlug);
  if (!category) return null;

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM articles a
    WHERE a.status = 'terbit' AND a.category_id = ?
  `).get(category.id);

  const total = countRow ? countRow.total : 0;
  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * limit;

  const articles = db.prepare(`
    ${BASE_SELECT}
    AND a.category_id = ?
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ? OFFSET ?
  `).all(ownerUsername, category.id, limit, offset);

  return {
    category,
    articles,
    total,
    page: currentPage,
    totalPages,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1
  };
}

// 6. Pencarian Berita (Judul atau Isi) dengan Paginasi
function searchArticles({ query = '', page = 1, limit = 6 }) {
  const searchTerm = `%${query.trim()}%`;

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM articles a
    WHERE a.status = 'terbit' AND (a.title LIKE ? OR a.content LIKE ?)
  `).get(searchTerm, searchTerm);

  const total = countRow ? countRow.total : 0;
  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * limit;

  const articles = db.prepare(`
    ${BASE_SELECT}
    AND (a.title LIKE ? OR a.content LIKE ?)
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ? OFFSET ?
  `).all(ownerUsername, searchTerm, searchTerm, limit, offset);

  return {
    query,
    articles,
    total,
    page: currentPage,
    totalPages,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1
  };
}

// 7. Ambil Detail Artikel Berdasarkan Slug beserta Tag
function getArticleBySlug(slug) {
  const article = db.prepare(`
    ${BASE_SELECT}
    AND a.slug = ?
  `).get(ownerUsername, slug);

  if (!article) return null;
  article.content = cleanArticleContent(article.content);

  // Ambil tag artikel
  const tags = db.prepare(`
    SELECT t.id, t.name
    FROM tags t
    JOIN article_tags at ON t.id = at.tag_id
    WHERE at.article_id = ?
  `).all(article.id);

  article.tags = tags;
  return article;
}

// 8. Tambah Jumlah Dibaca (+1) dan Catat ke Pencatatan View Harian
function incrementViews(articleId) {
  const updateViews = db.prepare('UPDATE articles SET views = views + 1 WHERE id = ?');
  const recordDailyView = db.prepare('INSERT INTO article_views (article_id, viewed_date) VALUES (?, CURRENT_DATE)');

  const tx = db.transaction((id) => {
    updateViews.run(id);
    recordDailyView.run(id);
  });

  tx(articleId);
}

// 9. Ambil Berita Terkait (Kategori sama, kecualikan artikel saat ini)
function getRelatedArticles(categoryId, currentArticleId, limit = 3) {
  if (!categoryId) return [];

  return db.prepare(`
    ${BASE_SELECT}
    AND a.category_id = ? AND a.id != ?
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ?
  `).all(ownerUsername, categoryId, currentArticleId, limit);
}

module.exports = {
  getAllCategories,
  getHeadlineArticles,
  getHeadlineArticle,
  getLatestArticles,
  getPopularArticles,
  getArticlesByCategory,
  searchArticles,
  getArticleBySlug,
  incrementViews,
  getRelatedArticles
};
