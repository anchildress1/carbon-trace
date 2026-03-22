import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pixi.js before importing effects.js
vi.mock('pixi.js', () => ({
  DisplacementFilter: vi.fn(function ({ sprite, scale }) {
    this.sprite = sprite;
    this.scale = { x: scale, y: scale, set: vi.fn((v) => { this.scale.x = v; this.scale.y = v; }) };
    this.enabled = true;
  }),
}));

vi.mock('pixi-filters', () => ({
  GlowFilter: vi.fn(function ({ color, distance, outerStrength, innerStrength, quality }) {
    this.color = color;
    this.distance = distance;
    this.outerStrength = outerStrength;
    this.innerStrength = innerStrength;
    this.quality = quality;
  }),
  ShockwaveFilter: vi.fn(function ({ center, amplitude, wavelength, speed, radius }) {
    this.center = center;
    this.amplitude = amplitude;
    this.wavelength = wavelength;
    this.speed = speed;
    this.radius = radius;
    this.time = 0;
  }),
}));

import {
  registerEffect,
  createEffect,
  hasEffectType,
  noiseFreeTypes,
  overlayTypes,
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

  describe('type sets', () => {
    it('noiseFreeTypes contains glow and shockwave', () => {
      expect(noiseFreeTypes.has('glow')).toBe(true);
      expect(noiseFreeTypes.has('shockwave')).toBe(true);
      expect(noiseFreeTypes.has('water')).toBe(false);
    });

    it('overlayTypes contains glow', () => {
      expect(overlayTypes.has('glow')).toBe(true);
      expect(overlayTypes.has('shockwave')).toBe(false);
      expect(overlayTypes.has('water')).toBe(false);
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

    it('creates a glow effect with filter and update function', () => {
      const result = createEffect('glow', null, { outerStrength: 3 });

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
      expect(typeof result.update).toBe('function');
    });

    it('glow effect pulses outerStrength', () => {
      const result = createEffect('glow', null, {
        outerStrength: 3,
        pulseSpeed: 0.5,
      });

      const initial = result.filter.outerStrength;
      result.update();
      expect(result.filter.outerStrength).not.toBe(initial);
    });

    it('glow effect uses default params when none provided', () => {
      const result = createEffect('glow', null);

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
    });

    it('creates a shockwave effect with filter and update function', () => {
      const result = createEffect('shockwave', null, {
        speed: 300,
        amplitude: 15,
      });

      expect(result).not.toBeNull();
      expect(result.filter).toBeDefined();
      expect(typeof result.update).toBe('function');
    });

    it('shockwave cycles between burst and rest', () => {
      const result = createEffect('shockwave', null, {
        cycleDuration: 0.1,
        cyclePause: 1,
      });

      // During burst phase — time advances
      result.update();
      expect(result.filter.time).toBeGreaterThan(0);
      expect(result.filter.time).toBeLessThan(0.1);

      // Advance past burst into rest phase (need elapsed > 0.1s = 6+ ticks)
      for (let i = 0; i < 10; i++) result.update();
      expect(result.filter.time).toBe(0.1);
    });
  });
});
