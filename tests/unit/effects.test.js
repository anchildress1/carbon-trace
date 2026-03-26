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

      const dt = 1 / 60;

      // During burst phase — time advances, filter enabled
      result.update(dt);
      expect(result.filter.enabled).toBe(true);
      expect(result.filter.time).toBeGreaterThan(0);
      expect(result.filter.time).toBeLessThan(0.1);

      // Advance past burst into rest phase — filter disabled (no frozen wave)
      for (let i = 0; i < 10; i++) result.update(dt);
      expect(result.filter.enabled).toBe(false);
    });

    it('shockwave trigger() resets cycle to time 0', () => {
      const result = createEffect('shockwave', null, {
        cycleDuration: 1,
        cyclePause: 2,
      });

      // Advance past burst into rest — filter disabled
      for (let i = 0; i < 120; i++) result.update(1 / 60);
      expect(result.filter.enabled).toBe(false);

      // Trigger resets the cycle — filter re-enabled
      result.trigger();
      result.update(1 / 60);
      expect(result.filter.enabled).toBe(true);
      expect(result.filter.time).toBeGreaterThan(0);
      expect(result.filter.time).toBeLessThan(0.1);
    });

    it('shockwave autoRepeat:false idles after one cycle', () => {
      const result = createEffect('shockwave', null, {
        cycleDuration: 0.1,
        cyclePause: 0,
        autoRepeat: false,
      });

      const dt = 1 / 60;

      // Starts idle — filter disabled (no distortion before first beat)
      expect(result.filter.enabled).toBe(false);
      result.update(dt);
      expect(result.filter.enabled).toBe(false);

      // Still idle after many frames — no auto-repeat
      for (let i = 0; i < 120; i++) result.update(dt);
      expect(result.filter.enabled).toBe(false);
    });

    it('shockwave autoRepeat:false plays after trigger()', () => {
      const result = createEffect('shockwave', null, {
        cycleDuration: 0.5,
        cyclePause: 0,
        autoRepeat: false,
      });

      // Starts idle — filter disabled
      expect(result.filter.enabled).toBe(false);

      // Trigger enables filter and fires a new cycle
      result.trigger();
      expect(result.filter.enabled).toBe(true);
      // filter.time must be 0 immediately after trigger so the first
      // rendered frame starts at the beginning of the wave, not at the
      // stale end-of-cycle value left by the previous completed wave.
      expect(result.filter.time).toBe(0);
      result.update(1 / 60);
      expect(result.filter.time).toBeGreaterThan(0);
      expect(result.filter.time).toBeLessThan(0.1);

      // Cycle plays through then idles again — filter disabled
      for (let i = 0; i < 60; i++) result.update(1 / 60);
      expect(result.filter.enabled).toBe(false);
    });

    it('shockwave trigger() is ignored while a wave is still expanding', () => {
      const result = createEffect('shockwave', null, {
        cycleDuration: 1,
        autoRepeat: false,
      });

      result.trigger();
      expect(result.filter.enabled).toBe(true);
      result.update(1 / 60); // mid-expansion

      // A second trigger while the wave is expanding must be a no-op — resetting
      // mid-expansion would freeze the wave near center.
      const timeBeforeSecondTrigger = result.filter.time;
      result.trigger();
      expect(result.filter.time).toBe(timeBeforeSecondTrigger);
      expect(result.filter.enabled).toBe(true);
    });

    it('shockwave autoRepeat:true (default) cycles normally', () => {
      const result = createEffect('shockwave', null, {
        cycleDuration: 0.1,
        cyclePause: 0.1,
      });

      const dt = 1 / 60;

      // First cycle — time advances
      result.update(dt);
      expect(result.filter.time).toBeGreaterThan(0);

      // Advance past first full cycle into second
      for (let i = 0; i < 20; i++) result.update(dt);

      // Should have started cycling again (time goes back below cycleDuration)
      const timeAfterCycle = result.filter.time;
      expect(timeAfterCycle).toBeLessThanOrEqual(0.1);
    });
  });
});
