import { gsap } from 'gsap';

export function createLineElement(text, container, options = {}) {
  const el = document.createElement('p');
  el.className = 'narration-line';
  el.textContent = text;

  const { x, y, align } = options;

  if (x !== undefined && x !== null && y !== undefined && y !== null) {
    el.classList.add('narration-line--positioned');
    el.style.position = 'absolute';
    el.style.left = `${x}vw`;
    el.style.top = `${y}vh`;

    if (align === 'center') {
      el.style.textAlign = 'center';
      el.style.transform = 'translate(-50%, -50%)';
    } else if (align === 'right') {
      el.style.textAlign = 'right';
      el.style.transform = 'translate(-100%, -50%)';
    } else {
      el.style.textAlign = 'left';
      el.style.transform = 'translateY(-50%)';
    }
  }

  container.appendChild(el);
  return el;
}

export function buildTextTimeline(lines, container, reducedMotion = false) {
  clearNarrationLayer(container);

  const tl = gsap.timeline();

  lines.forEach((line) => {
    const el = createLineElement(line.text, container, {
      x: line.x,
      y: line.y,
      align: line.align,
    });

    if (reducedMotion) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, line.enter / 1000);
      tl.to(el, { opacity: 0, duration: 0.3, ease: 'none' }, line.exit / 1000);
    } else {
      tl.fromTo(
        el,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' },
        line.enter / 1000,
      );
      tl.to(el, { opacity: 0, y: -6, duration: 0.6, ease: 'power2.in' }, line.exit / 1000);
    }
  });

  return tl;
}

export function clearNarrationLayer(container) {
  gsap.killTweensOf(container.children);
  container.replaceChildren();
}
