document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector('[data-hero-carousel]');
  if (!carousel) return;

  const slides = Array.from(carousel.querySelectorAll('[data-hero-slide]'));
  const dots = Array.from(carousel.querySelectorAll('[data-hero-dot]'));
  const currentLabel = carousel.querySelector('[data-hero-current]');
  let currentIndex = 0;

  function showSlide(index) {
    currentIndex = (index + slides.length) % slides.length;

    slides.forEach((slide, slideIndex) => {
      slide.hidden = slideIndex !== currentIndex;
    });

    dots.forEach((dot, dotIndex) => {
      const isCurrent = dotIndex === currentIndex;
      dot.classList.toggle('active', isCurrent);
      dot.setAttribute('aria-current', String(isCurrent));
    });

    if (currentLabel) {
      currentLabel.textContent = String(currentIndex + 1).padStart(2, '0');
    }
  }

  carousel.querySelector('[data-hero-previous]')?.addEventListener('click', () => {
    showSlide(currentIndex - 1);
  });

  carousel.querySelector('[data-hero-next]')?.addEventListener('click', () => {
    showSlide(currentIndex + 1);
  });

  dots.forEach((dot, index) => {
    dot.addEventListener('click', () => showSlide(index));
  });
});
