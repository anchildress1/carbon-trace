import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('gsap', () => {
  const timelineMock = {
    fromTo: vi.fn().mockReturnThis(),
    to: vi.fn().mockReturnThis(),
  };
  return {
    gsap: {
      timeline: vi.fn(() => timelineMock),
      killTweensOf: vi.fn(),
    },
  };
});

import { createLineElement, buildTextTimeline, clearNarrationLayer } from '../../src/text.js';
import { gsap } from 'gsap';

describe('text.js', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    vi.clearAllMocks();
  });

  describe('createLineElement', () => {
    it('creates a paragraph element with narration-line class', () => {
      const el = createLineElement('Hello world', container);

      expect(el.tagName).toBe('P');
      expect(el.className).toBe('narration-line');
      expect(el.textContent).toBe('Hello world');
    });

    it('appends element to container', () => {
      createLineElement('Test', container);

      expect(container.children.length).toBe(1);
    });

    it('handles empty string', () => {
      const el = createLineElement('', container);

      expect(el.textContent).toBe('');
    });

    it('preserves HTML special characters as text content', () => {
      const el = createLineElement('<b>bold</b> & "quoted"', container);

      expect(el.textContent).toBe('<b>bold</b> & "quoted"');
      expect(el.children.length).toBe(0);
    });

    it('appends multiple elements sequentially', () => {
      createLineElement('First', container);
      createLineElement('Second', container);
      createLineElement('Third', container);

      expect(container.children.length).toBe(3);
      expect(container.children[2].textContent).toBe('Third');
    });

    it('applies absolute positioning when x and y are provided', () => {
      const el = createLineElement('Positioned', container, { x: 10, y: 70 });

      expect(el.style.position).toBe('absolute');
      expect(el.style.left).toBe('10vw');
      expect(el.style.top).toBe('70vh');
      expect(el.classList.contains('narration-line--positioned')).toBe(true);
    });

    it('applies left alignment by default when positioned', () => {
      const el = createLineElement('Left text', container, { x: 10, y: 50 });

      expect(el.style.textAlign).toBe('left');
      expect(el.style.transform).toBe('translateY(-50%)');
    });

    it('applies center alignment with translate(-50%, -50%)', () => {
      const el = createLineElement('Center text', container, { x: 50, y: 50, align: 'center' });

      expect(el.style.textAlign).toBe('center');
      expect(el.style.transform).toBe('translate(-50%, -50%)');
    });

    it('applies right alignment with translate(-100%, -50%)', () => {
      const el = createLineElement('Right text', container, { x: 75, y: 88, align: 'right' });

      expect(el.style.textAlign).toBe('right');
      expect(el.style.transform).toBe('translate(-100%, -50%)');
    });

    it('does not apply positioning when x/y are not provided', () => {
      const el = createLineElement('Default', container);

      expect(el.style.position).toBe('');
      expect(el.classList.contains('narration-line--positioned')).toBe(false);
    });

    it('does not apply positioning when options is empty object', () => {
      const el = createLineElement('Default', container, {});

      expect(el.style.position).toBe('');
    });

    it('handles x=0 and y=0 as valid positions', () => {
      const el = createLineElement('Origin', container, { x: 0, y: 0 });

      expect(el.style.position).toBe('absolute');
      expect(el.style.left).toBe('0vw');
      expect(el.style.top).toBe('0vh');
    });

    it('defaults to left alignment when align is unrecognized', () => {
      const el = createLineElement('Fallback', container, { x: 50, y: 50, align: 'justify' });

      expect(el.style.textAlign).toBe('left');
      expect(el.style.transform).toBe('translateY(-50%)');
    });
  });

  describe('buildTextTimeline', () => {
    it('creates a GSAP timeline from lines config', () => {
      const lines = [
        { text: 'Line one', enter: 500, exit: 4000 },
        { text: 'Line two', enter: 2000, exit: 6000 },
      ];

      const tl = buildTextTimeline(lines, container);

      expect(gsap.timeline).toHaveBeenCalled();
      expect(container.children.length).toBe(2);
      expect(tl.fromTo).toHaveBeenCalledTimes(2);
      expect(tl.to).toHaveBeenCalledTimes(2);
    });

    it('uses reduced motion styles when flag is true', () => {
      const lines = [{ text: 'Reduced', enter: 0, exit: 1000 }];

      const tl = buildTextTimeline(lines, container, true);

      const fromToCall = tl.fromTo.mock.calls[0];
      expect(fromToCall[1]).toEqual({ opacity: 0 });
      expect(fromToCall[2]).toMatchObject({ duration: 0.3, ease: 'none' });
    });

    it('uses ghost-drift styles when reduced motion is false', () => {
      const lines = [{ text: 'Drift', enter: 0, exit: 1000 }];

      const tl = buildTextTimeline(lines, container, false);

      const fromToCall = tl.fromTo.mock.calls[0];
      expect(fromToCall[1]).toEqual({ opacity: 0, y: 18, filter: 'blur(4px)' });
      expect(fromToCall[2]).toMatchObject({ duration: 1.2, ease: 'power3.out' });
    });

    it('clears existing content before building', () => {
      container.appendChild(document.createElement('p'));
      container.appendChild(document.createElement('p'));

      const lines = [{ text: 'New line', enter: 0, exit: 1000 }];
      buildTextTimeline(lines, container);

      expect(container.children.length).toBe(1);
    });

    it('handles empty lines array', () => {
      const tl = buildTextTimeline([], container);

      expect(container.children.length).toBe(0);
      expect(tl.fromTo).not.toHaveBeenCalled();
    });

    it('converts enter/exit ms to seconds for GSAP', () => {
      const lines = [{ text: 'Timed', enter: 2000, exit: 5000 }];

      const tl = buildTextTimeline(lines, container);

      const fromToCall = tl.fromTo.mock.calls[0];
      expect(fromToCall[3]).toBe(2);

      const toCall = tl.to.mock.calls[0];
      expect(toCall[2]).toBe(5);
    });

    it('converts zero enter/exit to 0 seconds', () => {
      const lines = [{ text: 'Instant', enter: 0, exit: 0 }];

      const tl = buildTextTimeline(lines, container);

      expect(tl.fromTo.mock.calls[0][3]).toBe(0);
      expect(tl.to.mock.calls[0][2]).toBe(0);
    });

    it('uses reduced motion exit animation with short duration', () => {
      const lines = [{ text: 'Exit test', enter: 0, exit: 3000 }];

      const tl = buildTextTimeline(lines, container, true);

      const toCall = tl.to.mock.calls[0];
      expect(toCall[1]).toMatchObject({ opacity: 0, duration: 0.3, ease: 'none' });
    });

    it('uses ghost-drift exit animation with y offset and blur', () => {
      const lines = [{ text: 'Exit drift', enter: 0, exit: 3000 }];

      const tl = buildTextTimeline(lines, container, false);

      const toCall = tl.to.mock.calls[0];
      expect(toCall[1]).toMatchObject({
        opacity: 0,
        y: -10,
        filter: 'blur(3px)',
        duration: 0.9,
        ease: 'power2.in',
      });
    });

    it('passes position data to createLineElement', () => {
      const lines = [
        { text: 'Positioned', enter: 0, exit: 1000, x: 10, y: 70, align: 'left' },
        { text: 'Centered', enter: 500, exit: 2000, x: 50, y: 50, align: 'center' },
      ];

      buildTextTimeline(lines, container);

      const first = container.children[0];
      expect(first.style.position).toBe('absolute');
      expect(first.style.left).toBe('10vw');
      expect(first.style.top).toBe('70vh');
      expect(first.style.textAlign).toBe('left');

      const second = container.children[1];
      expect(second.style.left).toBe('50vw');
      expect(second.style.textAlign).toBe('center');
    });

    it('handles lines without position data (backward-compatible)', () => {
      const lines = [{ text: 'No position', enter: 0, exit: 1000 }];

      buildTextTimeline(lines, container);

      const el = container.children[0];
      expect(el.style.position).toBe('');
      expect(el.classList.contains('narration-line--positioned')).toBe(false);
    });

    it('handles mixed positioned and non-positioned lines', () => {
      const lines = [
        { text: 'Positioned', enter: 0, exit: 1000, x: 10, y: 70, align: 'left' },
        { text: 'Default', enter: 500, exit: 2000 },
      ];

      buildTextTimeline(lines, container);

      expect(container.children[0].classList.contains('narration-line--positioned')).toBe(true);
      expect(container.children[1].classList.contains('narration-line--positioned')).toBe(false);
    });
  });

  describe('clearNarrationLayer', () => {
    it('removes all children from container', () => {
      container.appendChild(document.createElement('p'));
      container.appendChild(document.createElement('p'));

      clearNarrationLayer(container);

      expect(container.children.length).toBe(0);
    });

    it('kills GSAP tweens on children collection', () => {
      container.appendChild(document.createElement('p'));
      container.appendChild(document.createElement('p'));

      clearNarrationLayer(container);

      expect(gsap.killTweensOf).toHaveBeenCalledWith(container.children);
    });

    it('handles empty container', () => {
      clearNarrationLayer(container);

      expect(container.children.length).toBe(0);
    });
  });
});
