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
      align: line.align,
    });

    if (reducedMotion) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, line.enter / 1000);
      tl.to(el, { opacity: 0, duration: 0.3, ease: 'none' }, line.exit / 1000);
    } else {
      tl.fromTo(
        el,
        { opacity: 0, y: 18, filter: 'blur(4px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, ease: 'power3.out' },
        line.enter / 1000,
      );
      tl.to(
        el,
        { opacity: 0, y: -10, filter: 'blur(3px)', duration: 0.9, ease: 'power2.in' },
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

      tl.call(
        () => {
          if (isCaptionEnabled && !isCaptionEnabled()) return;
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
