const { db } = require('../db/index');
const { getAdminPath } = require('../utils/adminPath');

function requireAuth(req, res, next) {
  const adminPath = getAdminPath();
  res.locals.adminPath = adminPath;

  if (!req.session || !req.session.user?.id) {
    return res.redirect(adminPath);
  }

  const user = db.prepare(`
    SELECT id, username, role, is_active, must_change_password
    FROM users
    WHERE id = ?
  `).get(req.session.user.id);

  if (!user || user.is_active !== 1) {
    return req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('connect.sid');
      return res.redirect(adminPath);
    });
  }

  req.session.user = user;
  res.locals.adminUser = user;
  res.locals.currentUser = user;
  return next();
}

function requirePasswordChanged(req, res, next) {
  const adminPath = getAdminPath();

  if (res.locals.adminUser?.must_change_password === 1 &&
      !['/ganti-password', '/logout'].includes(req.path)) {
    return res.redirect(`${adminPath}/ganti-password`);
  }

  return next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = res.locals.adminUser || req.session?.user;
    if (!user) {
      return res.redirect(getAdminPath());
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).send('Anda tidak memiliki izin untuk membuka halaman ini.');
    }

    return next();
  };
}

function redirectIfAuthenticated(req, res, next) {
  const adminPath = getAdminPath();
  res.locals.adminPath = adminPath;

  if (req.session?.user?.id) {
    if (req.session.user.must_change_password === 1) {
      return res.redirect(`${adminPath}/ganti-password`);
    }
    return res.redirect(adminPath);
  }

  return next();
}

module.exports = {
  getAdminPath,
  requireAuth,
  requirePasswordChanged,
  requireRole,
  redirectIfAuthenticated
};
