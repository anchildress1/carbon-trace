/**
 * Effects registry — no-op skeleton.
 *
 * Effect implementations will be added as Canvas 2D pixel effects
 * in subsequent commits. The API surface (effectExists, runEffect,
 * clearEffects) stays stable so app.js doesn't change when effects
 * are wired in.
 */

const effects = {};

export function effectExists(name) {
  return name in effects;
}

export function runEffect(name, effectsCanvas, sceneCanvas) {
  const fn = effects[name];
  if (!fn) {
    if (name) console.warn(`Unknown effect: "${name}"`);
    return;
  }
  try {
    fn({ canvas: effectsCanvas, scene: sceneCanvas });
  } catch (err) {
    console.error(`Effect "${name}" threw during execution:`, err);
  }
}

export function clearEffects() {
  // No-op until canvas effects are implemented.
}
