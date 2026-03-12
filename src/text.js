import { gsap } from 'gsap';

export function createLineElement(text, container) {
  const el = document.createElement('p');
  el.className = 'narration-line';
  el.textContent = text;
  container.appendChild(el);
  return el;
}

export function buildTextTimeline(lines, container, reducedMotion = false) {
  clearNarrationLayer(container);

  const tl = gsap.timeline();

  lines.forEach((line) => {
    const el = createLineElement(line.text, container);

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
