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
      expect(fromToCall[1]).toEqual({ opacity: 0, y: 8 });
      expect(fromToCall[2]).toMatchObject({ duration: 0.8, ease: 'power2.out' });
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
  });

  describe('clearNarrationLayer', () => {
    it('removes all children from container', () => {
      container.appendChild(document.createElement('p'));
      container.appendChild(document.createElement('p'));

      clearNarrationLayer(container);

      expect(container.children.length).toBe(0);
    });

    it('kills GSAP tweens on children', () => {
      container.appendChild(document.createElement('p'));

      clearNarrationLayer(container);

      expect(gsap.killTweensOf).toHaveBeenCalled();
    });

    it('handles empty container', () => {
      clearNarrationLayer(container);

      expect(container.children.length).toBe(0);
    });
  });
});
