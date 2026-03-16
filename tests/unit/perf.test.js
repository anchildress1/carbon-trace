import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('gsap', () => {
  const timelineMock = {
    fromTo: vi.fn().mockReturnThis(),
    to: vi.fn().mockReturnThis(),
  };
  return {
    gsap: {
      timeline: vi.fn(() => timelineMock),
      to: vi.fn(),
      fromTo: vi.fn(),
      set: vi.fn(),
      killTweensOf: vi.fn(),
    },
  };
});

import { buildTextTimeline, clearNarrationLayer } from '../../src/text.js';
import { runEffect, clearEffects } from '../../src/effects.js';
import { initOverlay, updateProgress } from '../../src/overlay.js';

const BUDGET_MS = 50;

function measure(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('performance budgets', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    vi.clearAllMocks();
  });

  describe('text timeline creation', () => {
    it(`builds a 20-line timeline within ${BUDGET_MS}ms`, () => {
      const lines = Array.from({ length: 20 }, (_, i) => ({
        text: `Line ${i + 1} of the narration text content`,
        enter: i * 1000,
        exit: (i + 1) * 1000,
      }));

      const elapsed = measure(() => buildTextTimeline(lines, container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
    });

    it(`builds a 100-line timeline within ${BUDGET_MS}ms`, () => {
      const lines = Array.from({ length: 100 }, (_, i) => ({
        text: `Extended line ${i + 1}`,
        enter: i * 500,
        exit: (i + 1) * 500,
      }));

      const elapsed = measure(() => buildTextTimeline(lines, container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
    });
  });

  describe('clearNarrationLayer', () => {
    it(`clears 50 children within ${BUDGET_MS}ms`, () => {
      for (let i = 0; i < 50; i++) {
        container.appendChild(document.createElement('p'));
      }

      const elapsed = measure(() => clearNarrationLayer(container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
      expect(container.children.length).toBe(0);
    });
  });

  describe('effects creation', () => {
    it(`creates dust-drift (18 particles) within ${BUDGET_MS}ms`, () => {
      const elapsed = measure(() => runEffect('dust-drift', container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
      expect(container.children.length).toBe(18);
    });

    it(`creates dust-settle (14 particles) within ${BUDGET_MS}ms`, () => {
      const elapsed = measure(() => runEffect('dust-settle', container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
      expect(container.children.length).toBe(14);
    });

    it.each([
      'heat-pulse',
      'motion-drag',
      'near-still-pulse',
      'light-crack',
      'assembly-micro',
      'illumination-spread',
      'machine-steady',
      'fade-in',
      'water-run',
    ])('creates %s effect within budget', (effectName) => {
      const elapsed = measure(() => runEffect(effectName, container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
    });
  });

  describe('clearEffects', () => {
    it(`clears 50 effect children within ${BUDGET_MS}ms`, () => {
      for (let i = 0; i < 50; i++) {
        container.appendChild(document.createElement('div'));
      }

      const elapsed = measure(() => clearEffects(container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
      expect(container.children.length).toBe(0);
    });
  });

  describe('overlay dot creation', () => {
    beforeEach(() => {
      document.body.replaceChildren();
      const dotsContainer = document.createElement('div');
      dotsContainer.id = 'progress-dots';
      document.body.appendChild(dotsContainer);
    });

    it(`initializes 12 dots within ${BUDGET_MS}ms`, () => {
      const elapsed = measure(() => initOverlay(12));

      expect(elapsed).toBeLessThan(BUDGET_MS);
      expect(document.querySelectorAll('.progress-dot').length).toBe(12);
    });

    it(`initializes 50 dots within ${BUDGET_MS}ms`, () => {
      const elapsed = measure(() => initOverlay(50));

      expect(elapsed).toBeLessThan(BUDGET_MS);
      expect(document.querySelectorAll('.progress-dot').length).toBe(50);
    });

    it(`updates progress on 50 dots within ${BUDGET_MS}ms`, () => {
      initOverlay(50);

      const elapsed = measure(() => {
        for (let i = 0; i <= 50; i++) {
          updateProgress(i);
        }
      });

      expect(elapsed).toBeLessThan(BUDGET_MS);
    });
  });

  describe('repeated effect cycle', () => {
    it(`runs 10 create-clear cycles within ${BUDGET_MS * 3}ms`, () => {
      const elapsed = measure(() => {
        for (let i = 0; i < 10; i++) {
          runEffect('dust-drift', container);
          clearEffects(container);
        }
      });

      expect(elapsed).toBeLessThan(BUDGET_MS * 3);
      expect(container.children.length).toBe(0);
    });
  });
});
