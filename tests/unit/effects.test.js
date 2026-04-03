import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pixi.js', () => ({
  DisplacementFilter: vi.fn(function ({ sprite, scale }) {
    this.sprite = sprite;
    this.scale = {
      x: scale,
      y: scale,
      set: vi.fn((x, y = x) => {
        this.scale.x = x;
        this.scale.y = y;
      }),
    };
    this.enabled = true;
  }),
}));

vi.mock('pixi-filters', () => ({
  GlowFilter: vi.fn(function ({ color, distance, outerStrength, innerStrength, quality, knockout, alpha }) {
    this.color = color;
    this.distance = distance;
    this.outerStrength = outerStrength;
    this.innerStrength = innerStrength;
    this.quality = quality;
    this.knockout = knockout;
    this.alpha = alpha;
    this.enabled = true;
  }),
  ShockwaveFilter: vi.fn(function ({ center, amplitude, wavelength, speed, radius }) {
    this.center = center;
    this.amplitude = amplitude;
    this.wavelength = wavelength;
    this.speed = speed;
    this.radius = radius;
    this.enabled = true;
    this.time = 0;
  }),
}));

function mockSprite() {
  return {
    x: 0,
    y: 0,
    scale: { set: vi.fn() },
    texture: { source: { style: {} } },
  };
}

describe('effects.js — factory registry', () => {
  let registerEffect;
  let createEffect;
  let noiseFreeTypes;
  let overlayTypes;
  let DisplacementFilter;
  let GlowFilter;
  let ShockwaveFilter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    ({ DisplacementFilter } = await import('pixi.js'));
    ({ GlowFilter, ShockwaveFilter } = await import('pixi-filters'));
    ({
      registerEffect,
      createEffect,
      noiseFreeTypes,
      overlayTypes,
    } = await import('../../src/effects.js'));
  });

  describe('registerEffect', () => {
    it.each([
      { label: 'empty string', value: '' },
      { label: 'number', value: 123 },
      { label: 'boolean', value: false },
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
    ])('throws for invalid type: $label', ({ value }) => {
      expect(() => registerEffect(value, vi.fn())).toThrow(
        'registerEffect requires a non-empty string type',
      );
    });

    it('throws for non-function factory', () => {
      expect(() => registerEffect('test-type', 'not-a-function')).toThrow(
        'registerEffect requires a factory function',
      );
    });

    it('overwrites existing factory when type is re-registered', () => {
      const firstFactory = vi.fn(() => ({ filter: { id: 'first' }, update: vi.fn() }));
      const secondFactory = vi.fn(() => ({ filter: { id: 'second' }, update: vi.fn() }));

      registerEffect('custom', firstFactory);
      registerEffect('custom', secondFactory);

      const effect = createEffect('custom', mockSprite(), {});
      expect(effect.filter.id).toBe('second');
      expect(firstFactory).not.toHaveBeenCalled();
      expect(secondFactory).toHaveBeenCalledOnce();
    });
  });

  describe('type sets', () => {
    it('exports noiseFreeTypes and overlayTypes', () => {
      expect(noiseFreeTypes.has('glow')).toBe(true);
      expect(noiseFreeTypes.has('shockwave')).toBe(true);
      expect(overlayTypes.has('glow')).toBe(true);
      expect(overlayTypes.has('shockwave')).toBe(false);
    });
  });

  describe('createEffect', () => {
    it('returns null and warns for unregistered type', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = createEffect('nonexistent', mockSprite(), {});

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('Effect type "nonexistent" is not registered.');
      warnSpy.mockRestore();
    });

    it('propagates errors thrown by factory functions', () => {
      registerEffect('throws', () => {
        throw new Error('boom');
      });

      expect(() => createEffect('throws', mockSprite(), {})).toThrow('boom');
    });

    it('water effect wires displacement filter and respects explicit params', () => {
      const sprite = mockSprite();
      const effect = createEffect('water', sprite, {
        direction: 180,
        speed: 0.6,
        intensity: 8,
        scale: 0.02,
      });

      expect(effect).not.toBeNull();
      expect(DisplacementFilter).toHaveBeenLastCalledWith({ sprite, scale: 8 });
      expect(sprite.scale.set).toHaveBeenCalledWith(0.02);
      expect(sprite.texture.source.style.addressMode).toBe('repeat');
    });

    it('water defaults to direction 90 and speed 0.6', () => {
      const sprite = mockSprite();
      const effect = createEffect('water', sprite);

      expect(DisplacementFilter).toHaveBeenLastCalledWith({ sprite, scale: 20 });
      expect(sprite.scale.set).toHaveBeenCalledWith(0.15);

      effect.update();
      expect(sprite.x).toBeCloseTo(0, 10);
      expect(sprite.y).toBeCloseTo(0.6, 10);
    });

    it('water direction=90 moves in Y only', () => {
      const sprite = mockSprite();
      const effect = createEffect('water', sprite, {
        direction: 90,
        speed: 1,
      });

      effect.update();
      expect(sprite.x).toBeCloseTo(0, 10);
      expect(sprite.y).toBeCloseTo(1, 10);
    });

    it('heat effect uses default params and moves upward', () => {
      const sprite = mockSprite();
      const effect = createEffect('heat', sprite);

      expect(DisplacementFilter).toHaveBeenLastCalledWith({ sprite, scale: 15 });
      expect(sprite.scale.set).toHaveBeenCalledWith(0.15);

      const startY = sprite.y;
      effect.update();
      expect(sprite.y).toBeCloseTo(startY - 0.8, 10);
    });

    it('dust effect uses default params and oscillates over time', () => {
      const sprite = mockSprite();
      const effect = createEffect('dust', sprite);

      expect(DisplacementFilter).toHaveBeenLastCalledWith({ sprite, scale: 4 });
      expect(sprite.scale.set).toHaveBeenCalledWith(0.15);

      const xs = [];
      for (let i = 0; i < 50; i++) {
        effect.update();
        xs.push(sprite.x);
      }

      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      expect(maxX).toBeGreaterThan(minX);
    });

    it('accepts negative displacement params without crashing', () => {
      const sprite = mockSprite();
      const effect = createEffect('water', sprite, {
        speed: -1,
        intensity: -5,
      });

      expect(DisplacementFilter).toHaveBeenLastCalledWith({ sprite, scale: -5 });
      expect(() => effect.update()).not.toThrow();
    });

    it('glow effect passes constructor params including knockout and alpha', () => {
      const effect = createEffect('glow', null, {
        color: 0xabcdef,
        distance: 10,
        outerStrength: 3,
        innerStrength: 2,
        glowAlpha: 0.4,
      });

      expect(GlowFilter).toHaveBeenCalledWith({
        color: 0xabcdef,
        distance: 10,
        outerStrength: 3,
        innerStrength: 2,
        quality: 0.5,
        knockout: true,
        alpha: 0.4,
      });
      expect(effect.filter.knockout).toBe(true);
      expect(effect.filter.alpha).toBe(0.4);
    });

    it('glow effect defaults match expected values', () => {
      const effect = createEffect('glow', null);

      expect(GlowFilter).toHaveBeenCalledWith({
        color: 0xffcc66,
        distance: 25,
        outerStrength: 6,
        innerStrength: 1,
        quality: 0.5,
        knockout: true,
        alpha: 1,
      });

      const initial = effect.filter.outerStrength;
      effect.update();
      expect(effect.filter.outerStrength).not.toBe(initial);
    });

    it('shockwave effect passes constructor params and initializes time to cycleDuration', () => {
      const effect = createEffect('shockwave', null, {
        centerX: 0.25,
        centerY: 0.75,
        amplitude: 15,
        wavelength: 80,
        speed: 300,
        radius: -1,
        cycleDuration: 0.3,
      });

      expect(ShockwaveFilter).toHaveBeenCalledWith({
        center: { x: 0.25, y: 0.75 },
        amplitude: 15,
        wavelength: 80,
        speed: 300,
        radius: -1,
      });
      expect(effect.filter.time).toBe(0.3);
    });

    it('shockwave autoRepeat:false starts disabled and can be triggered', () => {
      const effect = createEffect('shockwave', null, {
        cycleDuration: 0.5,
        cyclePause: 0,
        autoRepeat: false,
      });

      expect(effect.filter.enabled).toBe(false);
      effect.trigger();
      expect(effect.filter.enabled).toBe(true);
      expect(effect.filter.time).toBe(0);
    });

    it('shockwave cycleDuration=0 handles update without division errors', () => {
      const effect = createEffect('shockwave', null, {
        cycleDuration: 0,
        cyclePause: 0,
      });

      expect(() => effect.update(1 / 60)).not.toThrow();
    });
  });
});
