// Skema Database SQLite untuk Web Berita
const { db } = require('./index');

function initSchema() {
  // 1. Tabel Users
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('owner', 'editor', 'penulis')) NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Tabel Categories
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL
    );
  `);

  // 3. Tabel Articles
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      summary TEXT,
      content TEXT NOT NULL,
      image_path TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      author_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT CHECK(status IN ('draft', 'diajukan', 'terbit')) NOT NULL DEFAULT 'draft',
      views INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_at DATETIME
    );
  `);

  // 4. Tabel Tags & Article_Tags
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_tags (
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (article_id, tag_id)
    );
  `);

  // 5. Tabel Pencatatan View Harian (untuk statistik "dibaca hari ini" pada dashboard)
  db.exec(`
    CREATE TABLE IF NOT EXISTS article_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      viewed_date DATE NOT NULL DEFAULT (CURRENT_DATE)
    );
    CREATE INDEX IF NOT EXISTS idx_article_views_date ON article_views(viewed_date);
  `);

  // Indeks untuk pencarian & filter cepat
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
    CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
    CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
  `);
}

module.exports = { initSchema };
