document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-article-editor]');
  const editor = document.querySelector('[data-editor-content]');
  const source = document.querySelector('[data-editor-source]');
  if (!form || !editor || !source) return;

  document.querySelectorAll('.editor-toolbar button').forEach((button) => {
    button.addEventListener('click', () => {
      editor.focus();
      const { command, value } = button.dataset;
      if (command === 'createLink') {
        const url = window.prompt('Masukkan alamat tautan (https:// atau mailto:)');
        if (url) document.execCommand(command, false, url);
        return;
      }
      document.execCommand(command, false, value || null);
    });
  });

  form.addEventListener('submit', () => {
    source.value = editor.innerHTML;
  });
});
