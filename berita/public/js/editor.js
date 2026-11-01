// Editor Teks Sederhana (Toolbar Format HTML Ringan)
document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('article-content');
  if (!textarea) return;

  function insertFormatting(prefix, suffix, defaultText = '') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end) || defaultText;
    const replacement = prefix + selectedText + suffix;

    textarea.setRangeText(replacement, start, end, 'select');
    textarea.focus();
  }

  // Event handler untuk tombol toolbar
  document.querySelectorAll('[data-editor-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const action = btn.getAttribute('data-editor-action');

      switch (action) {
        case 'bold':
          insertFormatting('<strong>', '</strong>', 'Teks Tebal');
          break;
        case 'italic':
          insertFormatting('<em>', '</em>', 'Teks Miring');
          break;
        case 'h2':
          insertFormatting('<h2>', '</h2>\n', 'Subjudul H2');
          break;
        case 'h3':
          insertFormatting('<h3>', '</h3>\n', 'Subjudul H3');
          break;
        case 'ul':
          insertFormatting('<ul>\n  <li>', '</li>\n  <li>Item 2</li>\n</ul>\n', 'Item 1');
          break;
        case 'ol':
          insertFormatting('<ol>\n  <li>', '</li>\n  <li>Langkah 2</li>\n</ol>\n', 'Langkah 1');
          break;
        case 'link':
          const url = prompt('Masukkan URL tautan (contoh: https://example.com):', 'https://');
          if (url && url !== 'https://') {
            insertFormatting(`<a href="${url}" target="_blank" rel="noopener">`, '</a>', 'Teks Tautan');
          }
          break;
        case 'quote':
          insertFormatting('<blockquote>\n  ', '\n</blockquote>\n', 'Kutipan berita...');
          break;
        case 'p':
          insertFormatting('<p>', '</p>\n', 'Paragraf baru');
          break;
      }
    });
  });
});
