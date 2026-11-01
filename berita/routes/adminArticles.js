// Rute Manajemen Berita di Panel Admin
const express = require('express');
const router = express.Router();

const { getAdminPath } = require('../utils/adminPath');
const upload = require('../middleware/upload');
const { formatDateIndo } = require('../utils/dateFormatter');
const { getAllCategories } = require('../services/categoryService');
const {
  getAdminArticles,
  getArticleForEdit,
  createArticle,
  updateArticle,
  deleteArticle
} = require('../services/adminArticleService');

// 1. Daftar Berita (dengan Pencarian dan Filter Status)
router.get('/', (req, res) => {
  const adminPath = getAdminPath();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const search = req.query.search || '';
  const status = req.query.status || '';

  const { articles, total, totalPages, hasNext, hasPrev } = getAdminArticles({
    user: req.session.user,
    search,
    status,
    page,
    limit: 10
  });

  res.render('admin/articles/index', {
    adminPath,
    currentUser: req.session.user,
    articles,
    currentSearch: search,
    currentStatus: status,
    pagination: {
      page,
      total,
      totalPages,
      hasNext,
      hasPrev
    },
    formatDateIndo
  });
});

// 2. Form Tambah Berita Baru
router.get('/tambah', (req, res) => {
  const adminPath = getAdminPath();
  const categories = getAllCategories();

  res.render('admin/articles/form', {
    adminPath,
    currentUser: req.session.user,
    categories,
    isEdit: false,
    article: null,
    error: null
  });
});

// 3. Proses Simpan Berita Baru
router.post('/tambah', (req, res) => {
  // Tangani middleware upload multer
  upload.single('image')(req, res, (err) => {
    const adminPath = getAdminPath();
    const categories = getAllCategories();

    if (err) {
      return res.status(400).render('admin/articles/form', {
        adminPath,
        currentUser: req.session.user,
        categories,
        isEdit: false,
        article: req.body,
        error: err.message
      });
    }

    const { title, category_id, status, content, summary, tags } = req.body;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;

    const result = createArticle({
      user: req.session.user,
      title,
      category_id,
      status,
      content,
      summary,
      tags,
      image_path
    });

    if (!result.success) {
      return res.status(400).render('admin/articles/form', {
        adminPath,
        currentUser: req.session.user,
        categories,
        isEdit: false,
        article: req.body,
        error: result.message
      });
    }

    res.redirect(`${adminPath}/berita`);
  });
});

// 4. Form Edit Berita
router.get('/edit/:id', (req, res) => {
  const adminPath = getAdminPath();
  const articleId = parseInt(req.params.id);
  const article = getArticleForEdit(articleId);

  if (!article) {
    return res.redirect(`${adminPath}/berita`);
  }

  // Penulis hanya boleh mengedit berita miliknya sendiri
  if (req.session.user.role === 'penulis' && article.author_id !== req.session.user.id) {
    return res.status(403).send('Anda tidak berhak mengedit naskah berita ini.');
  }

  const categories = getAllCategories();

  res.render('admin/articles/form', {
    adminPath,
    currentUser: req.session.user,
    categories,
    isEdit: true,
    article,
    error: null
  });
});

// 5. Proses Simpan Pembaruan Berita
router.post('/edit/:id', (req, res) => {
  upload.single('image')(req, res, (err) => {
    const adminPath = getAdminPath();
    const articleId = parseInt(req.params.id);
    const categories = getAllCategories();

    if (err) {
      return res.status(400).render('admin/articles/form', {
        adminPath,
        currentUser: req.session.user,
        categories,
        isEdit: true,
        article: { id: articleId, ...req.body },
        error: err.message
      });
    }

    const { title, category_id, status, content, summary, tags } = req.body;
    const image_path = req.file ? `/uploads/${req.file.filename}` : null;

    const result = updateArticle({
      id: articleId,
      user: req.session.user,
      title,
      category_id,
      status,
      content,
      summary,
      tags,
      image_path
    });

    if (!result.success) {
      return res.status(400).render('admin/articles/form', {
        adminPath,
        currentUser: req.session.user,
        categories,
        isEdit: true,
        article: { id: articleId, ...req.body },
        error: result.message
      });
    }

    res.redirect(`${adminPath}/berita`);
  });
});

// 6. Hapus Berita
router.post('/hapus/:id', (req, res) => {
  const adminPath = getAdminPath();
  const articleId = parseInt(req.params.id);

  const result = deleteArticle(articleId, req.session.user);
  if (!result.success) {
    return res.status(403).send(result.message);
  }

  res.redirect(`${adminPath}/berita`);
});

module.exports = router;
