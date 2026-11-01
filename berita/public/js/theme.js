// Inisialisasi dan Pergantian Tema Gelap / Terang (Dark/Light Mode)
(function() {
  const THEME_KEY = 'berita_opensource_theme';
  const LEGACY_THEME_KEY = 'namaberita_theme';
  
  // Ambil tema yang tersimpan atau preferensi sistem
  const savedTheme = localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY);
  if (savedTheme) {
    localStorage.setItem(THEME_KEY, savedTheme);
    localStorage.removeItem(LEGACY_THEME_KEY);
  }
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', initialTheme);

  window.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (!themeToggleBtn) return;

    function updateIcon(theme) {
      const icon = themeToggleBtn.querySelector('.theme-icon');
      if (icon) {
        icon.textContent = theme === 'dark' ? '☀️' : '🌙';
      }
      themeToggleBtn.setAttribute('title', theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap');
      themeToggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap');
    }

    updateIcon(initialTheme);

    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem(THEME_KEY, newTheme);
      updateIcon(newTheme);
    });
  });
})();
