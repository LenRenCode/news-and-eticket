// Inisialisasi Data Awal (Seed)
const bcrypt = require('bcrypt');
const { db } = require('./index');

function seedData() {
  // 1. Seed Kategori Awal
  const categories = [
    { name: 'Terkini', slug: 'terkini' },
    { name: 'Politik', slug: 'politik' },
    { name: 'Olahraga', slug: 'olahraga' },
    { name: 'Teknologi', slug: 'teknologi' },
    { name: 'Lainnya', slug: 'lainnya' }
  ];

  const checkCategoryStmt = db.prepare('SELECT id FROM categories WHERE slug = ?');
  const insertCategoryStmt = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)');

  const insertCategoryTx = db.transaction((items) => {
    for (const item of items) {
      const existing = checkCategoryStmt.get(item.slug);
      if (!existing) {
        insertCategoryStmt.run(item.name, item.slug);
      }
    }
  });

  insertCategoryTx(categories);

  // 2. Seed Akun Owner Pertama (hanya jika belum ada user sama sekali)
  const countUsersStmt = db.prepare('SELECT COUNT(*) AS total FROM users');
  const { total } = countUsersStmt.get();

  if (total === 0) {
    const ownerUsername = process.env.OWNER_USERNAME?.trim();
    const ownerPassword = process.env.OWNER_PASSWORD;

    if (!ownerUsername || !ownerPassword) {
      throw new Error('OWNER_USERNAME dan OWNER_PASSWORD wajib diatur untuk membuat akun Owner pertama.');
    }

    // Hash password dengan bcrypt.
    const passwordHash = bcrypt.hashSync(ownerPassword, 10);

    const insertUserStmt = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active, must_change_password)
      VALUES (?, ?, 'owner', 1, 1)
    `);

    insertUserStmt.run(ownerUsername, passwordHash);
    console.log(`[SEED] Akun Owner pertama berhasil dibuat: username="${ownerUsername}" (wajib ganti password).`);
  }

  // 3. Seed Sampel Artikel Terbit (jika belum ada artikel)
  const countArticlesStmt = db.prepare('SELECT COUNT(*) AS total FROM articles');
  const { total: totalArticles } = countArticlesStmt.get();

  if (totalArticles === 0) {
    const owner = db.prepare('SELECT id FROM users LIMIT 1').get();
    const catTech = db.prepare("SELECT id FROM categories WHERE slug = 'teknologi'").get();
    const catPol = db.prepare("SELECT id FROM categories WHERE slug = 'politik'").get();
    const catSport = db.prepare("SELECT id FROM categories WHERE slug = 'olahraga'").get();
    const catNow = db.prepare("SELECT id FROM categories WHERE slug = 'terkini'").get();

    const sampleArticles = [
      {
        title: 'Revolusi AI Generatif 2026: Mengubah Lanskap Industri dan Produktivitas Global',
        slug: 'revolusi-ai-generatif-2026-mengubah-lanskap-industri',
        summary: 'Kecerdasan buatan generasi terbaru kini mampu melakukan otomasi kompleks dalam alur kerja rekayasa perangkat lunak dan analisis data.',
        content: `<p>Perkembangan kecerdasan buatan (Artificial Intelligence) pada tahun 2026 telah mencapai tonggak sejarah baru. Tidak lagi sekadar sebagai asisten percakapan teks, agen AI kini bertransformasi menjadi mitra kolaboratif yang mampu memecahkan masalah arsitektur sistem berskala besar secara mandiri.</p><p>Para peneliti dan pakar industri teknologi mencatat peningkatan efisiensi hingga 40% pada tim pengembangan yang mengadopsi integrasi agen otonom. Kendati demikian, tantangan regulasi etika, privasi data, dan keamanan siber tetap menjadi fokus perhatian utama para pemimpin teknologi dunia.</p><p>Melalui standardisasi tata kelola AI global yang sedang dirumuskan, masa depan kolaborasi antara manusia dan mesin diproyeksikan akan menciptakan jutaan peluang lapangan kerja baru di sektor rekayasa digital.</p>`,
        category_id: catTech ? catTech.id : null,
        author_id: owner.id,
        status: 'terbit',
        views: 245,
        published_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        tags: ['Teknologi', 'Kecerdasan Buatan', 'Inovasi']
      },
      {
        title: 'Sidang Parlemen Bahas Kebijakan Fiskal Terpadu untuk Stabilitas Ekonomi',
        slug: 'sidang-parlemen-bahas-kebijakan-fiskal-terpadu',
        summary: 'DPR dan pemerintah menyepakati kerangka fiskal baru guna mendorong pemerataan investasi industri ramah lingkungan di berbagai daerah.',
        content: `<p>Sidang paripurna yang digelar hari ini secara resmi menyepakati rancangan arah kebijakan fiskal jangka menengah. Prioritas utama diarahkan pada insentif investasi industri hijau serta perlindungan daya beli masyarakat melalui stabilisasi harga komoditas pokok.</p><p>Menteri Koordinator Bidang Perekonomian menegaskan bahwa ketahanan fiskal nasional tetap berada dalam kondisi yang sangat kokoh di tengah dinamika perdagangan global.</p>`,
        category_id: catPol ? catPol.id : null,
        author_id: owner.id,
        status: 'terbit',
        views: 182,
        published_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        tags: ['Ekonomi', 'Pemerintah', 'Kebijakan']
      },
      {
        title: 'Kemenangan Dramatis di Menit Akhir Bawa Tim Nasional Lolos ke Babak Final',
        slug: 'kemenangan-dramatis-di-menit-akhir-bawa-timnas-lolos-ke-final',
        summary: 'Gol sundulan di menit ke-93 memastikan kemenangan bersejarah setelah perjuangan sengit 120 menit di hadapan 80 ribu penonton.',
        content: `<p>Pertandingan semifinal yang berlangsung malam tadi menyuguhkan drama luar biasa. Setelah bermain imbang 1-1 hingga waktu normal berakhir, tensi pertandingan kian memuncak pada babak perpanjangan waktu.</p><p>Sorak penonton membahana saat tendangan sudut di masa perpanjangan waktu berhasil dikonversi menjadi gol kemenangan penentu tiket ke partai puncak.</p>`,
        category_id: catSport ? catSport.id : null,
        author_id: owner.id,
        status: 'terbit',
        views: 310,
        published_at: new Date(Date.now() - 3600000 * 8).toISOString(),
        tags: ['Sepakbola', 'Timnas', 'Olahraga']
      },
      {
        title: 'Infrastruktur Transportasi Cerdas Mulai Diuji Coba di Lima Kota Besar',
        slug: 'infrastruktur-transportasi-cerdas-mulai-diuji-coba',
        summary: 'Sistem pengatur lalu lintas berbasis sensor pintar terbukti memangkas waktu kemacetan hingga 35 persen pada jam sibuk.',
        content: `<p>Implementasi teknologi smart mobility resmi diterapkan pada koridor jalan protokol di lima kota besar. Dengan memanfaatkan jaringan sensor IoT dan algoritma optimasi lampu lalu lintas, waktu tempuh kendaraan umum mengalami peningkatan efisiensi yang signifikan.</p>`,
        category_id: catNow ? catNow.id : null,
        author_id: owner.id,
        status: 'terbit',
        views: 95,
        published_at: new Date(Date.now() - 3600000 * 12).toISOString(),
        tags: ['Transportasi', 'Kota Cerdas', 'Infrastruktur']
      },
      {
        title: 'Eksplorasi Ruang Angkasa: Teleskop Antariksa Tangkap Fenomena Galaksi Purba',
        slug: 'eksplorasi-ruang-angkasa-teleskop-tangkap-galaksi-purba',
        summary: 'Gambar beresolusi tinggi menunjukkan pembentukan bintang awal yang terjadi kurang dari 400 juta tahun setelah peristiwa Big Bang.',
        content: `<p>Badan antariksa internasional merilis citra spektakuler sebuah klaster galaksi purba. Penemuan ini membuka wawasan baru bagi para astrofisikawan dalam memahami evolusi awal alam semesta.</p>`,
        category_id: catTech ? catTech.id : null,
        author_id: owner.id,
        status: 'terbit',
        views: 420,
        published_at: new Date(Date.now() - 3600000 * 18).toISOString(),
        tags: ['Astronomi', 'Teknologi', 'Sains']
      },
      {
        title: 'Festival Seni dan Kebudayaan Nusantara Pukau Ribuan Wisatawan',
        slug: 'festival-seni-dan-kebudayaan-nusantara-pukau-wisatawan',
        summary: 'Ratusan seniman tradisional dari berbagai pelosok negeri menampilkan tarian kolosal dan pameran kriya warisan leluhur.',
        content: `<p>Kemeriahan festival seni tahunan kembali memikat perhatian publik. Menampilkan ragam instalasi kriya batik, musik gamelan kontemporer, dan parade kostum tradisional khas kepulauan Indonesia.</p>`,
        category_id: catNow ? catNow.id : null,
        author_id: owner.id,
        status: 'terbit',
        views: 64,
        published_at: new Date(Date.now() - 3600000 * 24).toISOString(),
        tags: ['Budaya', 'Pariwisata', 'Seni']
      }
    ];

    const insertArticleStmt = db.prepare(`
      INSERT INTO articles (title, slug, summary, content, image_path, category_id, author_id, status, views, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTagStmt = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const linkTagStmt = db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)');

    const insertSampleTx = db.transaction((articles) => {
      for (const art of articles) {
        const info = insertArticleStmt.run(
          art.title,
          art.slug,
          art.summary,
          art.content,
          '/images/default-article.svg',
          art.category_id,
          art.author_id,
          art.status,
          art.views,
          art.published_at,
          art.published_at,
          art.published_at
        );

        const articleId = info.lastInsertRowid;

        // Catat view sampel
        db.prepare('INSERT INTO article_views (article_id, viewed_date) VALUES (?, CURRENT_DATE)').run(articleId);

        if (art.tags && art.tags.length > 0) {
          for (const tagName of art.tags) {
            insertTagStmt.run(tagName);
            const tag = getTagStmt.get(tagName);
            if (tag) {
              linkTagStmt.run(articleId, tag.id);
            }
          }
        }
      }
    });

    insertSampleTx(sampleArticles);
    console.log('[SEED] Berhasil menambahkan 6 artikel sampel berstatus terbit untuk pengujian.');
  }
}

module.exports = { seedData };
