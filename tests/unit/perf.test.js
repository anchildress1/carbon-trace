import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('gsap', () => {
  const timelineMock = {
    fromTo: vi.fn().mockReturnThis(),
    to: vi.fn().mockReturnThis(),
    call: vi.fn().mockReturnThis(),
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

import { buildNarrationTimeline, clearNarrationLayer } from '../../src/text.js';
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

      const elapsed = measure(() => buildNarrationTimeline(lines, container));

      expect(elapsed).toBeLessThan(BUDGET_MS);
    });

    it(`builds a 100-line timeline within ${BUDGET_MS}ms`, () => {
      const lines = Array.from({ length: 100 }, (_, i) => ({
        text: `Extended line ${i + 1}`,
        enter: i * 500,
        exit: (i + 1) * 500,
      }));

      const elapsed = measure(() => buildNarrationTimeline(lines, container));

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
});
