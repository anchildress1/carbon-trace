/**
 * Effect factory registry. Each effect type (water, heat, dust, glow) is
 * registered with a factory function that creates PixiJS filters from region
 * parameters. effects-canvas.js calls createEffect() to instantiate filters
 * per region.
 */

import { DisplacementFilter } from 'pixi.js';

const factories = Object.create(null);

export function registerEffect(type, factoryFn) {
  if (typeof type !== 'string' || !type) {
    throw new Error('registerEffect requires a non-empty string type');
  }
  if (typeof factoryFn !== 'function') {
    throw new Error('registerEffect requires a factory function');
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
export const noiseFreeTypes = new Set();

// --- Built-in effect factories ---
// Each receives a PixiJS Sprite (noise texture, may be null for non-displacement
// effects) and region params. Returns { filter, update(), needsNoise? }.

registerEffect('water', (sprite, params = {}) => {
  const { direction = 180, speed = 0.6, intensity = 8, scale = 0.02 } = params;
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
  const { speed = 0.8, intensity = 4, scale = 0.15 } = params;

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
  const { speed = 0.3, intensity = 3, scale = 0.08 } = params;

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

/**
 * Fog: slow, large-scale displacement drift — scene appears to shift
 * through moving atmospheric haze. Multi-directional for rolling feel.
 */
registerEffect('fog', (sprite, params = {}) => {
  const { speed = 0.15, intensity = 5, scale = 0.2 } = params;

  sprite.texture.source.style.addressMode = 'repeat';
  sprite.scale.set(scale);

  const filter = new DisplacementFilter({ sprite, scale: intensity });

  let t = 0;
  return {
    filter,
    update() {
      t += 0.005;
      sprite.x += Math.sin(t) * speed;
      sprite.y += Math.cos(t * 0.6) * speed * 0.3;
    },
  };
});

/**
 * Glow: subtle pulsing displacement that creates an organic shimmer —
 * the scene appears to breathe with warm light. Intensity oscillates.
 */
registerEffect('glow', (sprite, params = {}) => {
  const { speed = 0.1, intensity = 3, scale = 0.15, pulseSpeed = 0.02 } = params;

  sprite.texture.source.style.addressMode = 'repeat';
  sprite.scale.set(scale);

  const filter = new DisplacementFilter({ sprite, scale: intensity });

  let t = 0;
  return {
    filter,
    update() {
      t += pulseSpeed;
      filter.scale = intensity + Math.sin(t) * (intensity * 0.4);
      sprite.x += Math.sin(t * 1.3) * speed * 0.3;
      sprite.y += Math.cos(t * 0.9) * speed * 0.2;
    },
  };
});

/**
 * Shockwave: radial displacement burst that expands outward and resets.
 * Noise sprite scales up rapidly from center, displacement fades as it expands.
 */
registerEffect('shockwave', (sprite, params = {}) => {
  const {
    speed = 0.015,
    intensity = 12,
    restScale = 0.01,
    burstScale = 0.25,
    cyclePause = 3,
  } = params;

  sprite.texture.source.style.addressMode = 'repeat';
  sprite.scale.set(restScale);

  const filter = new DisplacementFilter({ sprite, scale: 0 });

  let t = 0;
  return {
    filter,
    update() {
      t += speed;
      const cycle = t % (1 + cyclePause);

      if (cycle < 1) {
        const progress = cycle;
        const ease = 1 - (1 - progress) * (1 - progress);
        sprite.scale.set(restScale + (burstScale - restScale) * ease);
        filter.scale = intensity * (1 - ease);
      } else {
        sprite.scale.set(restScale);
        filter.scale = 0;
      }
    },
  };
});
