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
      const effectsCanvas = document.createElement('canvas');
      const sceneCanvas = document.createElement('canvas');
      expect(() => runEffect('nonexistent', effectsCanvas, sceneCanvas)).not.toThrow();
    });

    it('does not throw when called with no arguments', () => {
      expect(() => runEffect()).not.toThrow();
    });

    it('does not warn for empty string name', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      runEffect('', document.createElement('canvas'));

      // Empty string is falsy, so no warning
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('warns for non-empty unknown effect name', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      runEffect('nonexistent', document.createElement('canvas'));

      expect(warnSpy).toHaveBeenCalledWith('Effect "nonexistent" is not registered.');
      warnSpy.mockRestore();
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
