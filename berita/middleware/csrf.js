const crypto = require('crypto');

function createCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (!req.session) {
    return next(new Error('Sesi belum diinisialisasi sebelum middleware CSRF.'));
  }

  const token = createCsrfToken(req);
  res.locals.csrfToken = token;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Hanya tunda pengecekan multipart untuk route yang memang memiliki upload handler (multer)
  const fullPath = (req.baseUrl || '') + req.path;
  const isUploadRoute = /\/berita(\/\d+)?$/.test(fullPath) || fullPath.endsWith('/backup/restore');
  if (req.is('multipart/form-data') && isUploadRoute && !req._csrfDeferred) {
    req._csrfDeferred = true;
    return next();
  }

  const submittedToken = req.body?._csrf || req.headers['x-csrf-token'] || req.headers['csrf-token'];
  const sessionToken = req.session.csrfToken;
  if (typeof submittedToken !== 'string' || typeof sessionToken !== 'string') {
    return res.status(403).send('Permintaan tidak valid. Muat ulang halaman dan coba lagi.');
  }

  const submittedBuffer = Buffer.from(submittedToken);
  const sessionBuffer = Buffer.from(sessionToken);
  if (submittedBuffer.length !== sessionBuffer.length ||
      !crypto.timingSafeEqual(submittedBuffer, sessionBuffer)) {
    return res.status(403).send('Permintaan tidak valid. Muat ulang halaman dan coba lagi.');
  }

  return next();
}

module.exports = { createCsrfToken, csrfProtection };
