/**
 * Effects registry. Effect functions are registered in the `effects` map.
 * Currently empty — all scene effect references (dust-drift, heat-pulse,
 * etc.) will no-op with a console warning until implementations are added.
 * The API surface (effectExists, runEffect, clearEffects) is stable;
 * app.js does not change when effects are wired in.
 */

const effects = Object.create(null);

export function effectExists(name) {
  return typeof name === 'string' && Object.hasOwn(effects, name);
}

export function runEffect(name, effectsCanvas, sceneCanvas) {
  const fn = effects[name];
  if (!fn) {
    if (name) console.warn(`Effect "${name}" is not registered.`);
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
