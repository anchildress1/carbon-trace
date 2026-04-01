import { gsap } from 'gsap';

export function createLineElement(text, container, options = {}) {
  const el = document.createElement('p');
  el.className = 'narration-line';
  el.textContent = text;

  const { x, y } = options;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError('createLineElement requires finite numeric x and y positions');
  }
  el.classList.add('narration-line--positioned');
  el.style.position = 'absolute';
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.style.transform = 'translateY(-50%)';

  container.appendChild(el);
  return el;
}

export function buildNarrationTimeline(lines, container, opts = {}) {
  clearNarrationLayer(container);

  const {
    reducedMotion = false,
    captions,
    captionContainer,
    captionDelay = 0,
    isCaptionEnabled,
  } = opts;

  const tl = gsap.timeline({ paused: true });

  lines.forEach((line, i) => {
    if (typeof line.enter !== 'number' || typeof line.exit !== 'number') {
      console.error(`Narration line ${i} has invalid enter/exit timing:`, line);
      return;
    }
    const el = createLineElement(line.text, container, {
      x: line.x,
      y: line.y,
    });

    if (reducedMotion) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, line.enter / 1000);
      tl.to(el, { opacity: 0, duration: 0.3, ease: 'none' }, line.exit / 1000);
    } else {
      tl.fromTo(
        el,
        { opacity: 0, y: -20, filter: 'blur(4px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, ease: 'power3.out' },
        line.enter / 1000,
      );
      tl.to(
        el,
        { opacity: 0, y: 90, x: 0, filter: 'blur(14px)', duration: 1.8, ease: 'power2.in' },
        line.exit / 1000,
      );
    }
  });

  const captionEntries = [];

  if (Array.isArray(captions) && captions.length > 0 && captionContainer) {
    captions.forEach((caption) => {
      const startSec = (captionDelay + caption.start) / 1000;
      const endSec = (captionDelay + caption.end) / 1000;

      const entry = { text: caption.text, startSec, endSec, el: null };
      captionEntries.push(entry);

      // Guard: if this entry already has a DOM element, remove it before
      // creating a new one. This prevents duplicate captions when the
      // timeline callback fires more than once (e.g., play(0) after a
      // buffering resume, or rapid replay). Do not remove this guard —
      // the duplicate-caption bug has been reintroduced multiple times.
      tl.call(
        () => {
          if (isCaptionEnabled && !isCaptionEnabled()) return;
          if (entry.el) {
            entry.el.remove();
            entry.el = null;
          }
          const el = document.createElement('p');
          el.className = 'caption-text';
          el.textContent = caption.text;
          captionContainer.appendChild(el);
          entry.el = el;
        },
        [],
        startSec,
      );

      tl.call(
        () => {
          if (entry.el) {
            entry.el.remove();
            entry.el = null;
          }
        },
        [],
        endSec,
      );
    });
  }

  return { timeline: tl, captionEntries };
}

export function clearNarrationLayer(container) {
  gsap.killTweensOf(container.children);
  container.replaceChildren();
}
