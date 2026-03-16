import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initCaptions,
  setCaptionsEnabled,
  areCaptionsEnabled,
  showCaptions,
  clearCaptions,
  pauseCaptions,
  resumeCaptions,
} from '../../src/captions.js';

describe('captions.js', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    localStorage.clear();
    clearCaptions();
    initCaptions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initCaptions', () => {
    it('returns false when localStorage has no value', () => {
      expect(initCaptions()).toBe(false);
    });

    it('returns true when localStorage has "true"', () => {
      localStorage.setItem('carbon-trace-captions-enabled', 'true');
      expect(initCaptions()).toBe(true);
    });

    it('returns false when localStorage has "false"', () => {
      localStorage.setItem('carbon-trace-captions-enabled', 'false');
      expect(initCaptions()).toBe(false);
    });

    it('returns false for any non-"true" value', () => {
      localStorage.setItem('carbon-trace-captions-enabled', '1');
      expect(initCaptions()).toBe(false);
    });

    it('returns false when localStorage throws', () => {
      const orig = localStorage.getItem;
      localStorage.getItem = () => {
        throw new Error('quota exceeded');
      };
      expect(initCaptions()).toBe(false);
      localStorage.getItem = orig;
    });
  });

  describe('setCaptionsEnabled', () => {
    it('persists true to localStorage', () => {
      setCaptionsEnabled(true);
      expect(localStorage.getItem('carbon-trace-captions-enabled')).toBe('true');
    });

    it('persists false to localStorage', () => {
      setCaptionsEnabled(false);
      expect(localStorage.getItem('carbon-trace-captions-enabled')).toBe('false');
    });

    it('updates areCaptionsEnabled', () => {
      setCaptionsEnabled(true);
      expect(areCaptionsEnabled()).toBe(true);
      setCaptionsEnabled(false);
      expect(areCaptionsEnabled()).toBe(false);
    });

    it('does not throw when localStorage is unavailable', () => {
      const orig = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('quota exceeded');
      };
      expect(() => setCaptionsEnabled(true)).not.toThrow();
      localStorage.setItem = orig;
    });
  });

  describe('areCaptionsEnabled', () => {
    it('returns current enabled state', () => {
      expect(areCaptionsEnabled()).toBe(false);
      setCaptionsEnabled(true);
      expect(areCaptionsEnabled()).toBe(true);
    });
  });

  describe('showCaptions', () => {
    it('creates caption elements at scheduled times', () => {
      const captions = [
        { text: 'Hello', start: 0, end: 2000 },
        { text: 'World', start: 1000, end: 3000 },
      ];

      showCaptions(captions, container);

      // First caption appears immediately (start=0)
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Hello');

      vi.advanceTimersByTime(1000);
      expect(container.children.length).toBe(2);
      expect(container.children[1].textContent).toBe('World');
    });

    it('removes caption elements at scheduled end times', () => {
      const captions = [{ text: 'Short', start: 0, end: 1000 }];

      showCaptions(captions, container);
      expect(container.children.length).toBe(1);

      vi.advanceTimersByTime(1000);
      expect(container.children.length).toBe(0);
    });

    it('uses textContent not innerHTML', () => {
      const captions = [{ text: '<b>bold</b>', start: 0, end: 1000 }];

      showCaptions(captions, container);

      expect(container.children[0].textContent).toBe('<b>bold</b>');
      expect(container.children[0].children.length).toBe(0);
    });

    it('applies caption-text class', () => {
      const captions = [{ text: 'Styled', start: 0, end: 1000 }];

      showCaptions(captions, container);

      expect(container.children[0].className).toBe('caption-text');
    });

    it('handles empty captions array', () => {
      showCaptions([], container);
      expect(container.children.length).toBe(0);
    });

    it('handles null captions', () => {
      expect(() => showCaptions(null, container)).not.toThrow();
    });

    it('handles null container', () => {
      expect(() => showCaptions([{ text: 'X', start: 0, end: 1000 }], null)).not.toThrow();
    });

    it('clears previous captions before showing new ones', () => {
      showCaptions([{ text: 'First', start: 0, end: 5000 }], container);
      expect(container.children.length).toBe(1);

      showCaptions([{ text: 'Second', start: 0, end: 5000 }], container);
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Second');
    });

    it('starts from offset when offsetMs is provided', () => {
      const captions = [
        { text: 'Early', start: 0, end: 2000 },
        { text: 'Mid', start: 3000, end: 6000 },
        { text: 'Late', start: 8000, end: 10000 },
      ];

      // Start from 4 seconds in — "Early" is past, "Mid" is active, "Late" is future
      showCaptions(captions, container, 4000);

      // "Mid" should be immediately visible (start 3000 < offset 4000 < end 6000)
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Mid');

      // "Mid" hides at 6000 - 4000 = 2000ms from now
      vi.advanceTimersByTime(2000);
      expect(container.children.length).toBe(0);

      // "Late" should appear at 8000 - 4000 = 4000ms from now
      vi.advanceTimersByTime(2000);
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Late');
    });

    it('skips captions that have already ended before offset', () => {
      const captions = [
        { text: 'Past', start: 0, end: 1000 },
        { text: 'Future', start: 5000, end: 8000 },
      ];

      showCaptions(captions, container, 2000);

      // "Past" ended at 1000 < offset 2000, should not appear
      expect(container.children.length).toBe(0);

      // "Future" at 5000 - 2000 = 3000ms
      vi.advanceTimersByTime(3000);
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Future');
    });

    it('correctly tracks elapsed time after offset for pause/resume', () => {
      const captions = [{ text: 'Timed', start: 5000, end: 10000 }];

      showCaptions(captions, container, 3000);

      // Caption scheduled at 5000 - 3000 = 2000ms
      vi.advanceTimersByTime(1000);
      pauseCaptions();
      vi.advanceTimersByTime(5000); // Should not fire during pause
      expect(container.children.length).toBe(0);

      resumeCaptions();
      vi.advanceTimersByTime(1000); // Remaining 1000ms
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Timed');
    });
  });

  describe('clearCaptions', () => {
    it('removes all caption elements', () => {
      showCaptions(
        [
          { text: 'A', start: 0, end: 5000 },
          { text: 'B', start: 0, end: 5000 },
        ],
        container,
      );

      clearCaptions();
      expect(container.children.length).toBe(0);
    });

    it('cancels pending timers', () => {
      showCaptions([{ text: 'Delayed', start: 2000, end: 5000 }], container);

      clearCaptions();
      vi.advanceTimersByTime(3000);

      expect(container.children.length).toBe(0);
    });

    it('handles no active captions', () => {
      expect(() => clearCaptions()).not.toThrow();
    });
  });

  describe('pauseCaptions / resumeCaptions', () => {
    it('pauses and resumes caption timers', () => {
      showCaptions([{ text: 'Pause me', start: 2000, end: 5000 }], container);

      vi.advanceTimersByTime(1000);
      expect(container.children.length).toBe(0);

      pauseCaptions();
      vi.advanceTimersByTime(5000);
      expect(container.children.length).toBe(0);

      resumeCaptions();
      vi.advanceTimersByTime(1000);
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Pause me');
    });

    it('handles pause when no captions are active', () => {
      expect(() => pauseCaptions()).not.toThrow();
    });

    it('handles resume when no captions were paused', () => {
      expect(() => resumeCaptions()).not.toThrow();
    });

    it('preserves already-visible captions through pause cycle', () => {
      showCaptions(
        [
          { text: 'Visible', start: 0, end: 10000 },
          { text: 'Later', start: 5000, end: 10000 },
        ],
        container,
      );

      vi.advanceTimersByTime(1000);
      expect(container.children.length).toBe(1);

      pauseCaptions();
      resumeCaptions();

      // Visible caption should be re-shown (it's still within its time window)
      expect(container.children.length).toBe(1);
    });
  });
});
