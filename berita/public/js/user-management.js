document.addEventListener('DOMContentLoaded', () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-';

  document.querySelectorAll('[data-generate-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      if (!input) return;

      const bytes = new Uint8Array(20);
      window.crypto.getRandomValues(bytes);
      input.value = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
});
