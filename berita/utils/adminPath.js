function getAdminPath(value = process.env.ADMIN_PATH) {
  const configuredPath = typeof value === 'string' && value.trim() ? value.trim() : 'admin';
  const segments = configuredPath.split('/').filter(Boolean);

  if (!segments.length || segments.some(segment => !/^[a-zA-Z0-9_-]+$/.test(segment))) {
    throw new Error('ADMIN_PATH harus berupa path URL yang terdiri dari huruf, angka, garis bawah, atau tanda hubung.');
  }

  return `/${segments.join('/')}`;
}

module.exports = { getAdminPath };
