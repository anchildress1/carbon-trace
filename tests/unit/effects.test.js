import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEffect, clearEffects, effectExists } from '../../src/effects.js';

describe('effects.js — no-op skeleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('effectExists', () => {
    it('returns false for any name (no effects registered)', () => {
      expect(effectExists('dust-drift')).toBe(false);
      expect(effectExists('heat-pulse')).toBe(false);
      expect(effectExists('water-run')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(effectExists('')).toBe(false);
    });

    it.each([
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
    ])('returns false for $label', ({ value }) => {
      expect(effectExists(value)).toBe(false);
    });
  });

  describe('runEffect', () => {
    it('does not throw for unknown effect name', () => {
      const canvas = document.createElement('canvas');
      const scene = document.createElement('img');
      expect(() => runEffect('nonexistent', canvas, scene)).not.toThrow();
    });

    it('does not throw when called with no arguments', () => {
      expect(() => runEffect()).not.toThrow();
    });
  });

  describe('clearEffects', () => {
    it('does not throw', () => {
      expect(() => clearEffects()).not.toThrow();
    });

    it('accepts no arguments', () => {
      expect(clearEffects()).toBeUndefined();
    });
  });
});
