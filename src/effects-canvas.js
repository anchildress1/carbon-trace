/**
 * PixiJS WebGL lifecycle for the effects overlay canvas. Manages a PixiJS
 * Application, loads scene images as sprites, applies masked displacement
 * filters per region, and runs the PixiJS ticker for 60fps GPU animation.
 *
 * Textures are loaded via new Image() + Texture.from() to preserve
 * connect-src 'none' CSP (PixiJS Assets.load() may use fetch internally).
 *
 * Respects prefers-reduced-motion: ticker is paused, effects are static.
 * Graceful WebGL fallback: if init fails or context is lost, all subsequent
 * calls become no-ops and the app continues without effects.
 */

import { Application, Sprite, Texture } from 'pixi.js';
import { createEffect } from './effects.js';

let pixiApp = null;
let canvasEl = null;
let observer = null;
let webglAvailable = true;
let needsReinit = false;
let activeEffects = [];
let sceneSprite = null;

function reducedMotion() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Load an image URL as a PixiJS Texture via new Image() (img-src, not fetch).
 */
function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(Texture.from(img));
    img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
    img.src = url;
  });
}

function handleContextLost(e) {
  e.preventDefault();
  console.warn('WebGL context lost — effects paused');
  clearAll();
  needsReinit = true;
}

function handleContextRestored() {
  console.warn('WebGL context restored');
}

function tickerUpdate() {
  for (const effect of activeEffects) {
    effect.update();
  }
}

/**
 * Create the PixiJS Application on the effects canvas. Called lazily during
 * first loadScene(). If WebGL is unavailable, sets webglAvailable = false.
 */
export async function init(el) {
  if (!el || !(el instanceof HTMLCanvasElement)) {
    throw new Error('init requires a <canvas> element');
  }

  if (canvasEl && pixiApp) destroy();

  canvasEl = el;

  try {
    pixiApp = new Application();
    await pixiApp.init({
      canvas: canvasEl,
      backgroundAlpha: 0,
      resizeTo: canvasEl.parentElement,
      autoStart: false,
    });

    pixiApp.ticker.add(tickerUpdate);
    pixiApp.ticker.stop();

    canvasEl.addEventListener('webglcontextlost', handleContextLost);
    canvasEl.addEventListener('webglcontextrestored', handleContextRestored);

    observer = new ResizeObserver(() => {
      if (pixiApp?.renderer) {
        pixiApp.renderer.resize(canvasEl.clientWidth, canvasEl.clientHeight);
      }
    });
    observer.observe(canvasEl);
  } catch (err) {
    console.warn('WebGL unavailable — effects disabled:', err.message);
    webglAvailable = false;
    pixiApp = null;
  }
}

/**
 * Load a scene's effects: create scene sprite, load masks and noise textures,
 * configure displacement filters per region.
 */
export async function loadScene(effectsConfig, sceneImageUrl) {
  if (!webglAvailable) return;

  if (needsReinit) {
    try {
      await reinit();
    } catch {
      webglAvailable = false;
      return;
    }
  }

  if (!pixiApp) return;

  clearAll();

  try {
    const sceneTexture = await loadTexture(sceneImageUrl);
    sceneSprite = new Sprite(sceneTexture);
    sceneSprite.width = pixiApp.screen.width;
    sceneSprite.height = pixiApp.screen.height;
    pixiApp.stage.addChild(sceneSprite);

    const filters = [];

    for (const region of effectsConfig.regions) {
      try {
        const noiseTexture = await loadTexture(region.noise || 'assets/masks/noise-256.png');
        const noiseSprite = new Sprite(noiseTexture);
        pixiApp.stage.addChild(noiseSprite);

        const effect = createEffect(region.type, noiseSprite, region);
        if (!effect) continue;

        if (region.mask) {
          const maskTexture = await loadTexture(region.mask);
          const maskSprite = new Sprite(maskTexture);
          maskSprite.width = pixiApp.screen.width;
          maskSprite.height = pixiApp.screen.height;
          pixiApp.stage.addChild(maskSprite);
          sceneSprite.mask = maskSprite;
        }

        filters.push(effect.filter);
        activeEffects.push(effect);
      } catch (err) {
        console.warn(`Skipping effect region "${region.type}":`, err.message);
      }
    }

    if (filters.length > 0) {
      sceneSprite.filters = filters;
    }

    if (!reducedMotion()) {
      pixiApp.ticker.start();
    }
  } catch (err) {
    console.warn('Failed to load scene effects:', err.message);
    clearAll();
  }
}

async function reinit() {
  const el = canvasEl;
  destroy();
  needsReinit = false;
  await init(el);
}

/**
 * Destroy all scene content (sprites, filters, textures). Frees GPU memory.
 * The ticker stops but the Application stays alive for reuse.
 */
export function clearAll() {
  if (!webglAvailable || !pixiApp) return;

  activeEffects = [];

  if (pixiApp.ticker) {
    pixiApp.ticker.stop();
  }

  // Wrap destroy calls in try/catch — a lost WebGL context can cause throws.
  try {
    if (sceneSprite) {
      sceneSprite.filters = [];
      sceneSprite.mask = null;
    }
    while (pixiApp.stage.children.length > 0) {
      const child = pixiApp.stage.children[0];
      pixiApp.stage.removeChild(child);
      try {
        child.destroy({ children: true, texture: true, textureSource: true });
      } catch {
        // Context lost — destroy may throw, continue cleanup
      }
    }
  } catch {
    // Stage access failed — context lost
  }

  sceneSprite = null;
}

export function pause() {
  if (!webglAvailable || !pixiApp) return;
  pixiApp.ticker.stop();
}

export function resume() {
  if (!webglAvailable || !pixiApp || reducedMotion()) return;
  if (activeEffects.length > 0) {
    pixiApp.ticker.start();
  }
}

export function destroy() {
  pause();

  if (canvasEl) {
    canvasEl.removeEventListener('webglcontextlost', handleContextLost);
    canvasEl.removeEventListener('webglcontextrestored', handleContextRestored);
  }

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  try {
    if (pixiApp) {
      pixiApp.destroy(false, { children: true, texture: true, textureSource: true });
    }
  } catch {
    // Context already lost
  }

  pixiApp = null;
  canvasEl = null;
  activeEffects = [];
  sceneSprite = null;
  needsReinit = false;
}

export function isRunning() {
  return pixiApp?.ticker?.started ?? false;
}
