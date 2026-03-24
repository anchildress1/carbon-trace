/**
 * PixiJS WebGL lifecycle for the transparent effects overlay canvas.
 * The stage contains ONLY masked Containers — no full-screen geometry.
 * Canvas 2D renders the static scene image underneath; this layer
 * overlays animated effect regions via per-region sprite clones inside
 * masked Containers with displacement/glow/shockwave filters.
 *
 * Textures are loaded via new Image() + Texture.from() to preserve
 * connect-src 'none' CSP (PixiJS Assets.load() may use fetch internally).
 *
 * Respects prefers-reduced-motion: ticker is paused, effects are static.
 * Graceful WebGL fallback: if init fails or context is lost, all subsequent
 * calls become no-ops and the app continues without effects.
 */

import { Application, Container, Sprite, Texture } from 'pixi.js';
import { createEffect, noiseFreeTypes, overlayTypes } from './effects.js';

let pixiApp = null;
let canvasEl = null;
let observer = null;
let webglAvailable = true;
let needsReinit = false;
let activeEffects = [];
let screenSizedSprites = [];
let disposableTextures = [];
let loadGeneration = 0;
let initPromise = null;

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

/**
 * Load a grayscale mask PNG and convert its luminance to alpha.
 * Masks are authored as white-on-black: white = effect visible, black = hidden.
 * PixiJS alpha masking reads the alpha channel, so we map luminance → alpha.
 *
 * Uses createImageBitmap to produce an ImageBitmap that PixiJS v8 wraps in
 * an ImageSource. CanvasSource textures and data-URL round-trips both cause
 * BindGroup.getResource to return null inside AlphaMaskPipe on subsequent
 * scene loads. ImageBitmap provides a GPU-ready resource that uploads
 * reliably across scene transitions.
 */
async function loadLuminanceMask(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`Failed to load mask: ${url}`));
    img.src = url;
  });

  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error(`Mask image has zero dimensions: ${url}`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`Failed to create 2D context for mask processing: ${url}`);
  }
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = data[i];
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = luminance;
  }
  ctx.putImageData(imageData, 0, 0);

  const bitmap = await createImageBitmap(canvas, { premultiplyAlpha: 'none' });
  return Texture.from(bitmap);
}

function handleContextLost(e) {
  e.preventDefault();
  console.error('WebGL context lost — effects paused');
  clearAll();
  needsReinit = true;
}

function handleContextRestored() {
  console.warn('WebGL context restored');
}

function tickerUpdate(ticker) {
  const dt = ticker.deltaMS / 1000;
  for (const effect of activeEffects) {
    try {
      effect.update(dt);
    } catch (err) {
      console.error('Effect update failed:', err);
    }
  }
}

/**
 * Set up a single region's effect: load noise sprite (if needed), create
 * the effect filter, and wire it into the stage.
 *
 * Two rendering modes:
 * - Displacement (water/heat/dust/shockwave): scene texture clipped by mask.
 * - Overlay (glow): mask texture IS the content sprite. GlowFilter needs
 *   alpha edges to radiate outward — a full-screen opaque sprite has none.
 *   The mask shape's own transparency provides those edges.
 *
 * Every region must have a mask (ADR-007 addendum).
 * Returns the effect object, or null if the factory declined.
 */
async function applyRegionEffect(region, sceneTexture, gen) {
  if (!region.mask) {
    console.warn(`Skipping region "${region.type}": mask is required`);
    return null;
  }

  let noiseSprite = null;
  if (!noiseFreeTypes.has(region.type)) {
    const noiseTexture = await loadTexture(region.noise || 'assets/masks/noise-256.png');
    if (gen !== loadGeneration) return null;
    disposableTextures.push(noiseTexture);
    noiseSprite = new Sprite(noiseTexture);
    pixiApp.stage.addChild(noiseSprite);
  }

  const effect = createEffect(region.type, noiseSprite, region);
  if (!effect) {
    if (noiseSprite) {
      pixiApp.stage.removeChild(noiseSprite);
    }
    return null;
  }

  const maskTexture = await loadLuminanceMask(region.mask);
  if (gen !== loadGeneration) return null;
  disposableTextures.push(maskTexture);

  if (overlayTypes.has(region.type)) {
    return applyOverlayEffect(effect, maskTexture, region);
  }
  return applyMaskedEffect(effect, maskTexture, sceneTexture);
}

/**
 * Overlay rendering: mask texture becomes the visible sprite content.
 * The shape's alpha edges let GlowFilter radiate outward. Tinted with
 * the effect color; GlowFilter's knockout:true ensures only the glow
 * halo renders, not the solid fill.
 */
function applyOverlayEffect(effect, maskTexture, region) {
  const effectSprite = new Sprite(maskTexture);
  effectSprite.width = pixiApp.screen.width;
  effectSprite.height = pixiApp.screen.height;
  effectSprite.tint = region.color ?? 0xffcc66;
  effectSprite.filters = [effect.filter];

  screenSizedSprites.push(effectSprite);
  pixiApp.stage.addChild(effectSprite);

  return effect;
}

/**
 * Masked rendering: scene texture clipped by mask shape. Used for
 * displacement effects (water, heat, dust) and shockwave.
 */
function applyMaskedEffect(effect, maskTexture, sceneTexture) {
  const maskSprite = new Sprite(maskTexture);
  maskSprite.width = pixiApp.screen.width;
  maskSprite.height = pixiApp.screen.height;

  const effectSprite = new Sprite(sceneTexture);
  effectSprite.width = pixiApp.screen.width;
  effectSprite.height = pixiApp.screen.height;
  effectSprite.filters = [effect.filter];

  screenSizedSprites.push(maskSprite, effectSprite);

  const container = new Container();
  container.addChild(effectSprite);
  // PixiJS v8 requires masks to be in the display list for world
  // transform computation. The mask sprite is not rendered visually
  // — PixiJS automatically excludes objects used as masks.
  pixiApp.stage.addChild(maskSprite);
  container.setMask({ mask: maskSprite });
  pixiApp.stage.addChild(container);

  return effect;
}

/**
 * Create the PixiJS Application on the effects canvas. Called during app
 * initialization. If WebGL is unavailable, sets webglAvailable = false.
 * Stores a promise so loadScene() can wait for init to complete.
 */
export function init(el) {
  if (!el || !(el instanceof HTMLCanvasElement)) {
    throw new Error('init requires a <canvas> element');
  }

  if (canvasEl && pixiApp) destroy();

  canvasEl = el;
  webglAvailable = true;

  initPromise = doInit(el);
  return initPromise;
}

async function doInit(el) {
  try {
    const app = new Application();
    await app.init({
      canvas: el,
      backgroundAlpha: 0,
      autoStart: false,
    });

    app.ticker.add(tickerUpdate);
    app.ticker.stop();

    // Only assign after successful init — prevents race conditions
    // where pause()/clearAll() access a half-initialized Application.
    pixiApp = app;

    el.addEventListener('webglcontextlost', handleContextLost);
    el.addEventListener('webglcontextrestored', handleContextRestored);

    observer = new ResizeObserver(() => {
      if (pixiApp?.renderer) {
        pixiApp.renderer.resize(canvasEl.clientWidth, canvasEl.clientHeight);
        const w = pixiApp.screen.width;
        const h = pixiApp.screen.height;
        for (const sprite of screenSizedSprites) {
          sprite.width = w;
          sprite.height = h;
        }
      }
    });
    observer.observe(el);
  } catch (err) {
    console.error('WebGL unavailable — effects disabled:', err.message);
    webglAvailable = false;
    pixiApp = null;
  } finally {
    initPromise = null;
  }
}

/**
 * Iterate regions, create effects, and bail early if a newer loadScene()
 * call has superseded this one (stale generation).
 * Returns true if all regions were processed, false if superseded.
 */
async function loadRegionEffects(regions, sceneTexture, gen) {
  for (const region of regions) {
    try {
      const effect = await applyRegionEffect(region, sceneTexture, gen);
      if (gen !== loadGeneration) return false;
      if (effect) activeEffects.push(effect);
    } catch (err) {
      console.warn(`Skipping effect region "${region.type}":`, err.message);
    }
  }
  return true;
}

/**
 * Load a scene's effects: load the scene image as a shared texture (not
 * added to stage), then create per-region masked Containers with filters.
 * The stage is transparent except where masked regions render — Canvas 2D
 * scene image shows through everywhere else (ADR-007 addendum).
 *
 * Uses a generation counter to discard stale results when the user
 * navigates to a new scene while textures are still loading.
 */
export async function loadScene(effectsConfig, sceneImageUrl) {
  if (!webglAvailable) return;

  // Wait for init() to complete if it is still in progress. This
  // prevents the first loadScene call from racing ahead of PixiJS
  // Application.init() and silently returning due to pixiApp === null.
  if (initPromise) {
    await initPromise;
    if (!webglAvailable) return;
  }

  const gen = ++loadGeneration;

  if (needsReinit) {
    try {
      await reinit();
    } catch {
      webglAvailable = false;
      return;
    }
  }

  if (!pixiApp || gen !== loadGeneration) return;

  clearAll();

  try {
    const sceneTexture = await loadTexture(sceneImageUrl);
    if (gen !== loadGeneration) return;
    disposableTextures.push(sceneTexture);

    const completed = await loadRegionEffects(effectsConfig.regions, sceneTexture, gen);
    if (!completed) return;

    if (!reducedMotion()) {
      pixiApp.ticker.start();
    }
  } catch (err) {
    console.error('Failed to load scene effects:', err.message);
    if (gen === loadGeneration) clearAll();
  }
}

async function reinit() {
  const el = canvasEl;
  destroy();
  needsReinit = false;
  await init(el);
}

/**
 * Destroy all scene content (sprites, filters, texture wrappers). Leaves
 * TextureSources alive for deferred GC reclamation (see tex.destroy(false)
 * rationale below). The ticker stops but the Application stays alive for reuse.
 */
export function clearAll() {
  if (!webglAvailable || !pixiApp) return;

  // Stop the ticker first to prevent update callbacks from running
  // against partially-destroyed state during cleanup below.
  pixiApp.ticker.stop();

  activeEffects = [];
  screenSizedSprites = [];

  // Wrap destroy calls in try/catch — a lost WebGL context can cause throws.
  try {
    const children = pixiApp.stage.removeChildren();
    for (const child of children) {
      try {
        // Use the mask property setter (not setMask) to properly unregister
        // the mask effect. setMask({ mask: null }) is a no-op in PixiJS v8
        // because the guard `if (options.mask)` is falsy for null, so the
        // mask effect is never removed from the container's effects list.
        if (child.mask) {
          child.mask = null;
        }
        child.destroy({ children: true, texture: false });
      } catch {
        // Context lost — destroy may throw, continue cleanup
      }
    }
  } catch {
    // Stage access failed — context lost
  }

  // Destroy textures WITHOUT destroying the underlying TextureSource.
  // tex.destroy(true) destroys the TextureSource, which triggers
  // unload → "change" event. This corrupts pooled AlphaMaskEffect
  // objects from BigPool, causing crashes during the next scene's
  // render. Passing false leaves the TextureSource alive for PixiJS's
  // GCSystem to reclaim once the resource exceeds maxUnusedTime.
  for (const tex of disposableTextures) {
    try {
      tex.destroy(false);
    } catch {
      // Context lost
    }
  }
  disposableTextures = [];

  // Render the now-empty stage to flush stale glow pixels from the canvas.
  // Without this, the WebGL canvas retains its last-drawn frame because the
  // ticker is stopped and no re-render occurs before the next scene fades in.
  try {
    pixiApp.render();
  } catch {
    // Context lost
  }
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
  screenSizedSprites = [];
  disposableTextures = [];
  loadGeneration = 0;
  needsReinit = false;
  initPromise = null;
}

export function isRunning() {
  return pixiApp?.ticker?.started ?? false;
}
