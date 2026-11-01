// Server Utama Aplikasi Web Berita "Berita OpenSource"
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');

const { db, dataDir, uploadsDir } = require('./db/index');
const { initSchema } = require('./db/schema');
const { seedData } = require('./db/seed');
const { getAdminPath } = require('./utils/adminPath');
const { csrfProtection } = require('./middleware/csrf');
const adminRouter = require('./routes/admin');
const publicRouter = require('./routes/public');

// Inisialisasi skema database dan data awal.
initSchema();
seedData();

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy hanya loopback agar req.ip dan req.secure mengenali header dari reverse proxy TLS (Nginx/Caddy)
app.set('trust proxy', 'loopback');

// Proxy Tiket Bus (Next.js & API Express) - Ditempatkan paling atas sebelum session, body parser, & CSRF
const ticketWebProxy = createProxyMiddleware({
  target: process.env.ETICKET_WEB_URL || 'http://127.0.0.1:3001',
  changeOrigin: true,
  xfwd: true,
  ws: true,
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes) => {
      const location = proxyRes.headers.location;
      if (
        proxyRes.statusCode &&
        proxyRes.statusCode >= 300 &&
        proxyRes.statusCode < 400 &&
        typeof location === 'string' &&
        new URL(
          location,
          process.env.ETICKET_WEB_URL || 'http://127.0.0.1:3001'
        ).pathname.toLowerCase().startsWith('/tiket/admin')
      ) {
        const redirect = new URL(
          location,
          process.env.ETICKET_WEB_URL || 'http://127.0.0.1:3001'
        );
        proxyRes.headers.location = `${redirect.pathname}${redirect.search}${redirect.hash}`;
      }
    }
  }
});

const ticketApiProxy = createProxyMiddleware({
  target: process.env.ETICKET_API_URL || 'http://127.0.0.1:4000',
  changeOrigin: true,
  xfwd: true,
  pathRewrite: (path) => path.replace(/^\/tiket-api(\/api)?/, '/api'),
  on: {
    proxyReq: fixRequestBody
  }
});

app.use((req, res, next) => {
  req.headers['x-forwarded-for'] = req.ip;
  if (req.path === '/tiket-api' || req.path.startsWith('/tiket-api/')) {
    return ticketApiProxy(req, res, next);
  }
  if (req.path === '/tiket' || req.path.startsWith('/tiket/')) {
    return ticketWebProxy(req, res, next);
  }
  return next();
});

const sessionSecret = process.env.SESSION_SECRET;
const adminPath = getAdminPath();

if (!sessionSecret) {
  throw new Error('SESSION_SECRET wajib diatur di file .env.');
}

const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.APP_MODE === 'production';

// Simpan sesi login bersama data aplikasi agar mudah dipindahkan.
const sessionDbPath = path.join(dataDir, 'sessions.db');
const sessionDb = new Database(sessionDbPath);
const sessionStore = new SqliteStore({
  client: sessionDb,
  expired: {
    clear: true,
    intervalMs: 15 * 60 * 1000 // Bersihkan sesi kedaluwarsa tiap 15 menit
  }
});
sessionDb.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(datetime(expire))');

app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction ? 'auto' : false,
    maxAge: 1000 * 60 * 60 * 24 // 1 hari
  }
}));

// Parsing request.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Tampilan EJS dan file statis.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.adminPath = adminPath;
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(csrfProtection);
app.use(adminPath, adminRouter);
app.use('/', publicRouter);

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[SERVER] Berita OpenSource berjalan di http://localhost:${PORT}`);
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url && (req.url === '/tiket' || req.url.startsWith('/tiket/'))) {
      ticketWebProxy.upgrade(req, socket, head);
    }
  });
}

module.exports = app;
