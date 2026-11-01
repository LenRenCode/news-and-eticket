// Rute Manajemen Kategori (Khusus Editor & Owner)
const express = require('express');
const router = express.Router();

const { getAdminPath } = require('../utils/adminPath');
const { requireRole } = require('../middleware/auth');
const {
  getAllCategoriesWithCounts,
  createCategory,
  deleteCategory
} = require('../services/categoryService');

// Terapkan batasan peran: hanya Owner dan Editor
router.use(requireRole('owner', 'editor'));

// 1. Tampilkan Daftar Kategori
router.get('/', (req, res) => {
  const adminPath = getAdminPath();
  const categories = getAllCategoriesWithCounts();

  res.render('admin/categories/index', {
    adminPath,
    currentUser: req.session.user,
    categories,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// 2. Tambah Kategori Baru
router.post('/tambah', (req, res) => {
  const adminPath = getAdminPath();
  const { name, slug } = req.body;

  const result = createCategory(name, slug);
  if (!result.success) {
    return res.redirect(`${adminPath}/kategori?error=${encodeURIComponent(result.message)}`);
  }

  res.redirect(`${adminPath}/kategori?success=Kategori+berhasil+ditambahkan`);
});

// 3. Hapus Kategori
router.post('/hapus/:id', (req, res) => {
  const adminPath = getAdminPath();
  const categoryId = parseInt(req.params.id);

  const result = deleteCategory(categoryId);
  if (!result.success) {
    return res.redirect(`${adminPath}/kategori?error=${encodeURIComponent(result.message)}`);
  }

  res.redirect(`${adminPath}/kategori?success=Kategori+berhasil+dihapus`);
});

module.exports = router;
