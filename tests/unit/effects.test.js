import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pixi.js before importing effects.js
vi.mock('pixi.js', () => ({
  DisplacementFilter: vi.fn(function ({ sprite, scale }) {
    this.sprite = sprite;
    this.scale = scale;
    this.enabled = true;
  }),
}));

import {
  registerEffect,
  createEffect,
  hasEffectType,
} from '../../src/effects.js';

function mockSprite() {
  return {
    x: 0,
    y: 0,
    scale: { set: vi.fn() },
    texture: { source: { style: {} } },
  };
}

describe('effects.js — factory registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasEffectType', () => {
    it('returns true for built-in types', () => {
      expect(hasEffectType('water')).toBe(true);
      expect(hasEffectType('heat')).toBe(true);
      expect(hasEffectType('dust')).toBe(true);
      expect(hasEffectType('glow')).toBe(true);
      expect(hasEffectType('fog')).toBe(true);
      expect(hasEffectType('shockwave')).toBe(true);
    });

    it('returns false for unregistered types', () => {
      expect(hasEffectType('nonexistent')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasEffectType('')).toBe(false);
    });

    it.each([
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
    ])('returns false for $label', ({ value }) => {
      expect(hasEffectType(value)).toBe(false);
    });
  });

  describe('registerEffect', () => {
    it('throws for empty string type', () => {
      expect(() => registerEffect('', vi.fn())).toThrow(
        'registerEffect requires a non-empty string type',
      );
    });

    it('throws for non-function factory', () => {
      expect(() => registerEffect('test-type', 'not-a-function')).toThrow(
        'registerEffect requires a factory function',
      );
    });

    it('registers a custom effect type', () => {
      registerEffect('custom', vi.fn(() => ({ filter: {}, update: vi.fn() })));
      expect(hasEffectType('custom')).toBe(true);
    });
  });

  describe('createEffect', () => {
    it('returns null and warns for unregistered type', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = createEffect('nonexistent', mockSprite(), {});

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'Effect type "nonexistent" is not registered.',
      );
      warnSpy.mockRestore();
    });

    it('creates a water effect with filter and update function', () => {
      const sprite = mockSprite();
      const result = createEffect('water', sprite, {
        direction: 180,
        speed: 0.6,
        intensity: 8,
        scale: 0.02,
      });

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
      expect(typeof result.update).toBe('function');
      expect(sprite.texture.source.style.addressMode).toBe('repeat');
    });

    it('creates a heat effect with upward direction', () => {
      const sprite = mockSprite();
      const result = createEffect('heat', sprite, {
        speed: 0.8,
        intensity: 4,
        scale: 0.15,
      });

      expect(result).not.toBeNull();
      expect(typeof result.update).toBe('function');

      const startY = sprite.y;
      result.update();
      expect(sprite.y).toBeLessThan(startY);
    });

    it('creates a dust effect with oscillating movement', () => {
      const sprite = mockSprite();
      const result = createEffect('dust', sprite, {
        speed: 0.3,
        intensity: 3,
        scale: 0.08,
      });

      expect(result).not.toBeNull();
      expect(typeof result.update).toBe('function');

      result.update();
      expect(sprite.x !== 0 || sprite.y !== 0).toBe(true);
    });

    it('water effect uses default params when none provided', () => {
      const sprite = mockSprite();
      const result = createEffect('water', sprite, {});

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
    });

    it('heat effect uses default params when none provided', () => {
      const sprite = mockSprite();
      const result = createEffect('heat', sprite);

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
    });

    it('dust effect uses default params when none provided', () => {
      const sprite = mockSprite();
      const result = createEffect('dust', sprite);

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
    });

    it('water update scrolls sprite in configured direction', () => {
      const sprite = mockSprite();
      const result = createEffect('water', sprite, {
        direction: 0,
        speed: 1,
      });

      const startX = sprite.x;
      result.update();
      expect(sprite.x).toBeGreaterThan(startX);
    });

    it('creates a glow effect with pulsing displacement', () => {
      const sprite = mockSprite();
      const result = createEffect('glow', sprite, { intensity: 3 });

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
      expect(typeof result.update).toBe('function');
    });

    it('glow effect pulses displacement scale', () => {
      const sprite = mockSprite();
      const result = createEffect('glow', sprite, {
        intensity: 5,
        pulseSpeed: 0.5,
      });

      const initial = result.filter.scale;
      result.update();
      expect(result.filter.scale).not.toBe(initial);
    });

    it('glow effect uses default params when none provided', () => {
      const sprite = mockSprite();
      const result = createEffect('glow', sprite);

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
    });

    it('creates a fog effect with displacement', () => {
      const sprite = mockSprite();
      const result = createEffect('fog', sprite, { speed: 0.15, intensity: 5 });

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
      expect(typeof result.update).toBe('function');
    });

    it('creates a shockwave effect with displacement', () => {
      const sprite = mockSprite();
      const result = createEffect('shockwave', sprite, {
        speed: 0.015,
        intensity: 12,
      });

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
      expect(typeof result.update).toBe('function');
    });

    it('shockwave cycles between burst and rest', () => {
      const sprite = mockSprite();
      const result = createEffect('shockwave', sprite, {
        speed: 0.5,
        intensity: 12,
        cyclePause: 1,
      });

      // During burst phase
      result.update();
      const burstScale = result.filter.scale;

      // Advance past burst into rest phase
      for (let i = 0; i < 10; i++) result.update();
      expect(result.filter.scale).toBe(0);
    });
  });
});
