import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initCaptions,
  setCaptionsEnabled,
  areCaptionsEnabled,
  syncCaptionsToTime,
  clearCaptionElements,
} from '../../src/captions.js';

describe('captions.js', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    localStorage.clear();
    initCaptions();
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

  describe('syncCaptionsToTime', () => {
    it('shows captions active at the given time', () => {
      const entries = [
        { text: 'Early', startSec: 0, endSec: 2, el: null },
        { text: 'Mid', startSec: 1.5, endSec: 4, el: null },
        { text: 'Late', startSec: 5, endSec: 8, el: null },
      ];

      syncCaptionsToTime(entries, 1.8, container);

      expect(container.children.length).toBe(2);
      expect(container.children[0].textContent).toBe('Early');
      expect(container.children[1].textContent).toBe('Mid');
      expect(entries[0].el).not.toBeNull();
      expect(entries[1].el).not.toBeNull();
      expect(entries[2].el).toBeNull();
    });

    it('shows no captions when time is before all entries', () => {
      const entries = [{ text: 'Future', startSec: 5, endSec: 8, el: null }];

      syncCaptionsToTime(entries, 0, container);

      expect(container.children.length).toBe(0);
    });

    it('shows no captions when time is past all entries', () => {
      const entries = [{ text: 'Past', startSec: 0, endSec: 2, el: null }];

      syncCaptionsToTime(entries, 3, container);

      expect(container.children.length).toBe(0);
    });

    it('clears existing caption elements before syncing', () => {
      const el = document.createElement('p');
      container.appendChild(el);
      const entries = [{ text: 'Active', startSec: 0, endSec: 5, el }];

      syncCaptionsToTime(entries, 1, container);

      // Old element removed, new one created
      expect(container.children.length).toBe(1);
      expect(container.children[0].textContent).toBe('Active');
      expect(entries[0].el).toBe(container.children[0]);
    });

    it('handles null captionEntries', () => {
      expect(() => syncCaptionsToTime(null, 0, container)).not.toThrow();
    });

    it('handles null container', () => {
      const entries = [{ text: 'X', startSec: 0, endSec: 1, el: null }];
      expect(() => syncCaptionsToTime(entries, 0, null)).not.toThrow();
    });

    it('applies caption-text class to created elements', () => {
      const entries = [{ text: 'Styled', startSec: 0, endSec: 5, el: null }];

      syncCaptionsToTime(entries, 1, container);

      expect(container.children[0].className).toBe('caption-text');
    });

    it('uses textContent not innerHTML', () => {
      const entries = [{ text: '<b>bold</b>', startSec: 0, endSec: 5, el: null }];

      syncCaptionsToTime(entries, 1, container);

      expect(container.children[0].textContent).toBe('<b>bold</b>');
      expect(container.children[0].children.length).toBe(0);
    });

    it('includes caption at exact startSec boundary', () => {
      const entries = [{ text: 'Boundary', startSec: 2, endSec: 5, el: null }];

      syncCaptionsToTime(entries, 2, container);

      expect(container.children.length).toBe(1);
    });

    it('excludes caption at exact endSec boundary', () => {
      const entries = [{ text: 'Boundary', startSec: 0, endSec: 2, el: null }];

      syncCaptionsToTime(entries, 2, container);

      expect(container.children.length).toBe(0);
    });
  });

  describe('clearCaptionElements', () => {
    it('removes all caption DOM elements', () => {
      const el1 = document.createElement('p');
      const el2 = document.createElement('p');
      container.appendChild(el1);
      container.appendChild(el2);

      const entries = [
        { text: 'A', el: el1 },
        { text: 'B', el: el2 },
      ];

      clearCaptionElements(entries);

      expect(container.children.length).toBe(0);
      expect(entries[0].el).toBeNull();
      expect(entries[1].el).toBeNull();
    });

    it('handles entries with no active element', () => {
      const entries = [{ text: 'Inactive', el: null }];

      expect(() => clearCaptionElements(entries)).not.toThrow();
      expect(entries[0].el).toBeNull();
    });

    it('handles null captionEntries', () => {
      expect(() => clearCaptionElements(null)).not.toThrow();
    });

    it('handles empty array', () => {
      expect(() => clearCaptionElements([])).not.toThrow();
    });
  });
});
