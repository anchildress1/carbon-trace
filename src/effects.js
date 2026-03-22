/**
 * Effect factory registry. Each effect type (water, heat, dust, glow) is
 * registered with a factory function that creates PixiJS filters from region
 * parameters. effects-canvas.js calls createEffect() to instantiate filters
 * per region.
 */

import { BlurFilter, DisplacementFilter } from 'pixi.js';

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
export const noiseFreeTypes = new Set(['fog', 'glow']);

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
 * Fog: soft static haze via blur. No displacement sprite needed.
 * Gentle pulse gives subtle atmospheric drift.
 */
registerEffect('fog', (_sprite, params = {}) => {
  const { strength = 4, quality = 4, pulseSpeed = 0.008, pulseRange = 1 } = params;

  const filter = new BlurFilter({ strength, quality });

  let t = 0;
  return {
    filter,
    needsNoise: false,
    update() {
      t += pulseSpeed;
      filter.strength = strength + Math.sin(t) * pulseRange;
    },
  };
});

/**
 * Glow: soft bloom effect via animated blur. No displacement sprite needed.
 * Pulses blur strength gently for an organic warm haze.
 */
registerEffect('glow', (_sprite, params = {}) => {
  const { strength = 8, quality = 4, pulseSpeed = 0.02, pulseRange = 2 } = params;

  const filter = new BlurFilter({ strength, quality });
  filter.blendMode = 'add';

  let t = 0;
  return {
    filter,
    needsNoise: false,
    update() {
      t += pulseSpeed;
      filter.strength = strength + Math.sin(t) * pulseRange;
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
