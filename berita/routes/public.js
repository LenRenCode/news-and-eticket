// Rute Halaman Publik Portal Berita "Berita OpenSource"
const express = require('express');
const router = express.Router();

const {
  getAllCategories,
  getHeadlineArticles,
  getLatestArticles,
  getPopularArticles,
  getArticlesByCategory,
  searchArticles,
  getArticleBySlug,
  incrementViews,
  getRelatedArticles
} = require('../services/articleService');

const { formatDateIndo } = require('../utils/dateFormatter');

function getPage(queryValue) {
  const page = Number(queryValue);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

// 1. Beranda: Headline, Berita Terbaru (Paginasi), Sidebar Populer
router.get('/', (req, res) => {
  try {
    const requestedPage = getPage(req.query.page);
    const categories = getAllCategories();
    const headlineSlides = getHeadlineArticles(5);
    const result = getLatestArticles({
      page: requestedPage,
      limit: 6,
      excludeIds: headlineSlides.map(article => article.id)
    });

    const popularArticles = getPopularArticles(5);

    res.render('public/index', {
      headlineSlides: result.page === 1 ? headlineSlides : [],
      latestArticles: result.articles,
      popularArticles,
      categories,
      pagination: {
        page: result.page,
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.hasNext,
        hasPrev: result.hasPrev
      },
      formatDateIndo
    });
  } catch (err) {
    console.error('[PUBLIC ROUTE ERROR - INDEX]', err);
    res.status(500).send('Terjadi kesalahan saat memuat halaman beranda.');
  }
});

// 2. Halaman Kategori: Daftar Berita per Kategori dengan Paginasi
router.get('/kategori/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const page = getPage(req.query.page);
    const categories = getAllCategories();
    const result = getArticlesByCategory({ categorySlug: slug, page, limit: 6 });

    if (!result) {
      return res.status(404).render('public/not-found', {
        categories,
        title: 'Kategori Tidak Ditemukan'
      });
    }

    const popularArticles = getPopularArticles(5);

    res.render('public/category', {
      category: result.category,
      articles: result.articles,
      popularArticles,
      categories,
      pagination: {
        page: result.page,
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.hasNext,
        hasPrev: result.hasPrev
      },
      formatDateIndo
    });
  } catch (err) {
    console.error('[PUBLIC ROUTE ERROR - CATEGORY]', err);
    res.status(500).send('Terjadi kesalahan saat memuat kategori.');
  }
});

// 3. Pencarian Berita: Berdasarkan Judul atau Isi dengan Paginasi
router.get('/cari', (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = getPage(req.query.page);
    const categories = getAllCategories();

    if (!query) {
      return res.redirect('/');
    }

    const result = searchArticles({
      query,
      page,
      limit: 6
    });

    const popularArticles = getPopularArticles(5);

    res.render('public/search', {
      searchQuery: query,
      articles: result.articles,
      popularArticles,
      categories,
      pagination: {
        page: result.page,
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.hasNext,
        hasPrev: result.hasPrev
      },
      formatDateIndo
    });
  } catch (err) {
    console.error('[PUBLIC ROUTE ERROR - SEARCH]', err);
    res.status(500).send('Terjadi kesalahan saat melakukan pencarian.');
  }
});

// 4. Halaman Baca Berita: Detail Artikel, Tag, Counter Views (+1), Berita Terkait
router.get('/artikel/:slug', (req, res) => {
  try {
    const { slug } = req.params;
    const article = getArticleBySlug(slug);

    if (!article) {
      return res.status(404).render('public/not-found', {
        categories: getAllCategories(),
        title: 'Artikel Tidak Ditemukan'
      });
    }

    // Tambah jumlah view (+1) & simpan catatan harian
    incrementViews(article.id);
    article.views += 1;

    // Ambil berita terkait dalam kategori yang sama
    const relatedArticles = getRelatedArticles(article.category_id, article.id, 3);
    const categories = getAllCategories();

    res.render('public/article', {
      article,
      relatedArticles,
      categories,
      formatDateIndo
    });
  } catch (err) {
    console.error('[PUBLIC ROUTE ERROR - DETAIL]', err);
    res.status(500).send('Terjadi kesalahan saat memuat artikel.');
  }
});

router.use((req, res) => {
  res.status(404).render('public/not-found', {
    categories: getAllCategories(),
    title: 'Halaman Tidak Ditemukan'
  });
});

module.exports = router;
