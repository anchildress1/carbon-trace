/**
 * Effect factory registry. Each effect type is registered with a factory
 * function that creates a filter and an update callback. effects-canvas.js
 * calls createEffect() to instantiate filters.
 *
 * Displacement-based effects (water, heat, dust, fog) use the built-in
 * DisplacementFilter with a noise sprite. Extension effects (glow, shockwave)
 * use filters from pixi-filters and do not require a noise sprite.
 */

import { DisplacementFilter } from 'pixi.js';
import { GlowFilter, GodrayFilter, ShockwaveFilter } from 'pixi-filters';

const factories = Object.create(null);

export function registerEffect(type, factoryFn) {
  if (typeof type !== 'string' || !type) {
    throw new Error('registerEffect requires a non-empty string type');
  }
  if (typeof factoryFn !== 'function') {
    throw new TypeError('registerEffect requires a factory function');
  }
  factories[type] = factoryFn;
}

export function createEffect(type, displacementSprite, params) {
  const fn = factories[type];
  if (!fn) {
    console.warn(`Effect type "${type}" is not registered.`);
    return null;
  }
  return fn(displacementSprite, params);
}

export function hasEffectType(type) {
  return typeof type === 'string' && Object.hasOwn(factories, type);
}

/** Effect types that don't need a displacement noise sprite. */
export const noiseFreeTypes = new Set(['glow', 'godray', 'shockwave']);

/**
 * Overlay effect types render the mask as content (not a clipping mask).
 * GlowFilter needs alpha edges to produce visible halos — a full-screen
 * opaque scene sprite has no alpha edges, so the glow would be invisible
 * behind a clipping mask. Instead, the mask texture (shape with transparent
 * background) becomes the sprite content, giving GlowFilter the alpha
 * transitions it needs to radiate outward.
 */
export const overlayTypes = new Set(['glow']);

// --- Displacement-based effect factories ---
// Each receives a PixiJS Sprite (noise texture) and region params.
// Returns { filter, update(): void }.

registerEffect('water', (sprite, params = {}) => {
  const { direction = 90, speed = 0.6, intensity = 20, scale = 0.15 } = params;
  const rad = (direction * Math.PI) / 180;
  const dx = Math.cos(rad) * speed;
  const dy = Math.sin(rad) * speed;

  sprite.texture.source.style.addressMode = 'repeat';
  sprite.scale.set(scale);

  const filter = new DisplacementFilter({ sprite, scale: intensity });

  return {
    filter,
    update() {
      sprite.x += dx;
      sprite.y += dy;
    },
  };
});

registerEffect('heat', (sprite, params = {}) => {
  const { speed = 0.8, intensity = 15, scale = 0.15 } = params;

  sprite.texture.source.style.addressMode = 'repeat';
  sprite.scale.set(scale);

  const filter = new DisplacementFilter({ sprite, scale: intensity });

  return {
    filter,
    update() {
      sprite.y -= speed;
    },
  };
});

registerEffect('dust', (sprite, params = {}) => {
  const { speed = 0.3, intensity = 4, scale = 0.15 } = params;

  sprite.texture.source.style.addressMode = 'repeat';
  sprite.scale.set(scale);

  const filter = new DisplacementFilter({ sprite, scale: intensity });

  let t = 0;
  return {
    filter,
    update() {
      t += 0.01;
      sprite.x += Math.sin(t) * speed;
      sprite.y += Math.cos(t * 0.7) * speed * 0.5;
    },
  };
});

// --- Extension filter factories (pixi-filters) ---
// These do NOT use a displacement noise sprite.

/**
 * Glow: luminous outer glow that pulses in intensity. Creates a warm,
 * breathing light effect around bright regions of the scene.
 */
registerEffect('glow', (_sprite, params = {}) => {
  const {
    color = 0xffcc66,
    distance = 25,
    outerStrength = 6,
    innerStrength = 1,
    pulseSpeed = 0.03,
    pulseDepth = 0.5,
    glowAlpha = 1,
  } = params;

  const filter = new GlowFilter({
    color,
    distance,
    outerStrength,
    innerStrength,
    quality: 0.5,
    knockout: true,
    alpha: glowAlpha,
  });

  let t = 0;
  return {
    filter,
    update() {
      t += pulseSpeed;
      const pulse = 1 + Math.sin(t) * pulseDepth;
      filter.outerStrength = outerStrength * pulse;
    },
  };
});

/**
 * Godray: volumetric light rays that shimmer over time. Creates ethereal
 * beams of light across the masked scene region.
 */
registerEffect('godray', (_sprite, params = {}) => {
  const {
    angle = 30,
    gain = 0.5,
    lacunarity = 2.5,
    parallel = true,
    centerX = 0.5,
    centerY = 0.3,
    speed = 0.008,
    alpha = 1,
  } = params;

  const filter = new GodrayFilter({
    angle,
    gain,
    lacunarity,
    parallel,
    center: { x: centerX, y: centerY },
    alpha,
  });
  filter.time = 0;

  return {
    filter,
    update() {
      filter.time += speed;
    },
  };
});

/**
 * Shockwave: radial ripple that expands outward from center and resets.
 * Uses the ShockwaveFilter for a real distortion wave effect.
 */
registerEffect('shockwave', (_sprite, params = {}) => {
  const {
    centerX = 0.5,
    centerY = 0.5,
    amplitude = 15,
    wavelength = 80,
    speed = 300,
    radius = -1,
    cyclePause = 2,
    cycleDuration = 1.5,
  } = params;

  const filter = new ShockwaveFilter({
    center: { x: centerX, y: centerY },
    amplitude,
    wavelength,
    speed,
    radius,
  });
  filter.time = cycleDuration;

  const totalCycle = cycleDuration + cyclePause;
  let elapsed = 0;

  return {
    filter,
    update() {
      elapsed += 1 / 60;
      const cycle = elapsed % totalCycle;

      if (cycle < cycleDuration) {
        filter.time = cycle;
      } else {
        filter.time = cycleDuration;
      }
    },
  };
});
