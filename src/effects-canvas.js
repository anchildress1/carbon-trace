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

// Must run before any pixi.js import — patches shader compilation to
// use CSP-safe alternatives, required by script-src 'self' policy.
import 'pixi.js/unsafe-eval';
import { Application, Container, Sprite, Texture } from 'pixi.js';
import { createEffect, noiseFreeTypes, overlayTypes } from './effects.js';

let pixiApp = null;
let canvasEl = null;
let observer = null;
let motionQuery = null;
let webglAvailable = true;
let needsReinit = false;
let activeEffects = [];
let screenSizedSprites = [];
let disposableTextures = [];
let loadGeneration = 0;
let isPaused = false;
let initPromise = null;
let centeredEffects = []; // effects with normalized center → pixel conversion

// Audio-reactive modulation state (ADR-008)
let arAnalyser = null;
let fftData = null;
let audioReactiveState = [];

// Dedicated analysis audio element (ADR-008 approach B)
let analysisElement = null;
let analysisSource = null;
let analysisSilentGain = null;
let analysisAnalyserRef = null; // tracks which analyserNode is wired into the analysis graph for cleanup

function reducedMotion() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function handleMotionChange(e) {
  if (!pixiApp) return;
  if (e.matches) {
    pixiApp.ticker.stop();
  } else if (!isPaused && activeEffects.length > 0) {
    pixiApp.ticker.start();
  }
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

// --- Audio-reactive FFT band extraction (ADR-008) ---

function avgBins(data, start, end) {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i];
  return sum / ((end - start) * 255);
}

function extractBands(data, sampleRate) {
  const fftSize = data.length * 2;
  const binWidth = sampleRate / fftSize;
  const bassStart = Math.max(1, Math.round(20 / binWidth));
  const bassEnd = Math.round(250 / binWidth);
  const midEnd = Math.round(2000 / binWidth);
  const highEnd = Math.min(Math.round(16000 / binWidth), data.length - 1);

  return {
    bass: avgBins(data, bassStart, bassEnd),
    mid: avgBins(data, bassEnd, midEnd),
    high: avgBins(data, midEnd, highEnd),
  };
}

function buildAudioReactiveState() {
  audioReactiveState = [];
  for (let i = 0; i < activeEffects.length; i++) {
    const ar = activeEffects[i].audioReactive;
    if (ar) {
      const state = {
        effectIndex: i,
        band: ar.band,
        target: ar.target,
        range: ar.range,
        smoothing: ar.smoothing ?? 0.8,
        smoothedValue: 0,
      };
      // Onset trigger fields — spectral flux detection (ADR-008)
      if (ar.trigger) {
        state.trigger = true;
        state.threshold = ar.trigger.threshold ?? 3;
        state.cooldown = ar.trigger.cooldown ?? 0.1;
        state.minEnergy = ar.trigger.minEnergy ?? 0;
        state.prevEnergy = 0;
        state.fluxAvg = 0;
        state.timeSinceLastTrigger = 0;
      }
      audioReactiveState.push(state);
    }
  }
}

function applyModulation(state, energy) {
  state.smoothedValue = state.smoothedValue * state.smoothing + energy * (1 - state.smoothing);
  const value = state.range[0] + state.smoothedValue * (state.range[1] - state.range[0]);
  activeEffects[state.effectIndex].filter[state.target] = value;
}

function applyTrigger(state, energy, dt) {
  // Spectral flux: positive energy change only (onsets, not decays)
  const flux = Math.max(0, energy - state.prevEnergy);
  state.prevEnergy = energy;
  state.fluxAvg = state.fluxAvg * 0.95 + flux * 0.05;
  state.timeSinceLastTrigger += dt;

  // Gate triggers until energy reaches the configured minimum level.
  // Prevents false triggers during audio fade-in when the analysis
  // element is at full volume but the audible Howler cue is still quiet.
  if (energy < state.minEnergy) return;

  if (flux > state.fluxAvg * state.threshold && state.timeSinceLastTrigger > state.cooldown) {
    activeEffects[state.effectIndex].trigger?.();
    state.timeSinceLastTrigger = 0;
  }
}

/**
 * Audio-reactive modulation (ADR-008) — runs AFTER effect updates
 * so audioReactive overrides pulse on the same parameter.
 */
function processAudioReactive(dt) {
  if (!arAnalyser || audioReactiveState.length === 0 || reducedMotion()) return;
  try {
    arAnalyser.getByteFrequencyData(fftData);
    const bands = extractBands(fftData, arAnalyser.context.sampleRate);
    for (const state of audioReactiveState) {
      const energy = bands[state.band];
      if (state.target && state.range) applyModulation(state, energy);
      if (state.trigger) applyTrigger(state, energy, dt);
    }
  } catch (err) {
    console.error('Audio-reactive modulation failed:', err);
  }
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
  processAudioReactive(dt);
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
    if (gen !== loadGeneration) {
      noiseTexture.destroy(false);
      return null;
    }
    disposableTextures.push(noiseTexture);
    noiseSprite = new Sprite(noiseTexture);
    noiseSprite.renderable = false;
    pixiApp.stage.addChild(noiseSprite);
  }

  const effect = createEffect(region.type, noiseSprite, region);
  if (!effect) {
    if (noiseSprite) {
      noiseSprite.removeFromParent();
    }
    return null;
  }

  // ShockwaveFilter center is in pixel coordinates (shader divides by
  // uInputSize). Config stores normalized 0–1 values for responsiveness.
  // Convert here and track for resize updates.
  if (region.centerX !== undefined && region.centerY !== undefined) {
    effect.filter.center = {
      x: region.centerX * pixiApp.screen.width,
      y: region.centerY * pixiApp.screen.height,
    };
    centeredEffects.push({
      filter: effect.filter,
      nx: region.centerX,
      ny: region.centerY,
    });
  }

  const maskTexture = await loadLuminanceMask(region.mask);
  if (gen !== loadGeneration) {
    maskTexture.destroy(false);
    return null;
  }
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
  let app = null;
  try {
    app = new Application();
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

    motionQuery = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', handleMotionChange);

    observer = new ResizeObserver(() => {
      if (pixiApp?.renderer) {
        pixiApp.renderer.resize(canvasEl.clientWidth, canvasEl.clientHeight);
        const w = pixiApp.screen.width;
        const h = pixiApp.screen.height;
        for (const sprite of screenSizedSprites) {
          sprite.width = w;
          sprite.height = h;
        }
        for (const ce of centeredEffects) {
          ce.filter.center = { x: ce.nx * w, y: ce.ny * h };
        }
      }
    });
    observer.observe(el);
  } catch (err) {
    console.error('WebGL unavailable — effects disabled:', err.message);
    webglAvailable = false;
    pixiApp = null;
    if (app) {
      try {
        app.destroy(true, { children: true });
      } catch {
        /* destroy may fail if init was incomplete */
      }
    }
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
      if (effect) {
        if (region.audioReactive) effect.audioReactive = region.audioReactive;
        activeEffects.push(effect);
      }
    } catch (err) {
      console.warn(`Skipping effect region "${region.type}":`, err.message);
    }
  }
  return true;
}

/**
 * Start the animation loop or paint a single frame. When the ticker can
 * run (not paused, no reduced-motion), start it for continuous updates.
 * Otherwise render one frame so effects are visible immediately — e.g.
 * hard-jump navigation pauses before the ticker ever ticks.
 */
function startOrRenderOnce() {
  if (!reducedMotion() && !isPaused) {
    pixiApp.ticker.start();
  } else {
    pixiApp.render();
  }
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
  if (!webglAvailable) return false;

  // Wait for init() to complete if it is still in progress. This
  // prevents the first loadScene call from racing ahead of PixiJS
  // Application.init() and silently returning due to pixiApp === null.
  if (initPromise) {
    await initPromise;
    if (!webglAvailable) return false;
  }

  const gen = ++loadGeneration;

  if (needsReinit) {
    try {
      await reinit();
    } catch {
      webglAvailable = false;
      return false;
    }
  }

  if (!pixiApp || gen !== loadGeneration) return false;

  clearAll();

  try {
    const sceneTexture = await loadTexture(sceneImageUrl);
    if (gen !== loadGeneration) {
      sceneTexture.destroy(false);
      return false;
    }
    disposableTextures.push(sceneTexture);

    const completed = await loadRegionEffects(effectsConfig.regions, sceneTexture, gen);
    if (!completed) return false;

    buildAudioReactiveState();
    startOrRenderOnce();
    return true;
  } catch (err) {
    console.error('Failed to load scene effects:', err.message);
    if (gen === loadGeneration) clearAll();
    return false;
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
  // Always clear audio-reactive and analysis audio state, even if WebGL
  // is unavailable. This avoids hidden analysis streams persisting in
  // fallback mode where pixiApp is null.
  activeEffects = [];
  screenSizedSprites = [];
  centeredEffects = [];
  audioReactiveState = [];
  arAnalyser = null;
  fftData = null;
  cleanupAnalysisElement();

  if (!webglAvailable || !pixiApp) return;

  // Stop the ticker first to prevent update callbacks from running
  // against partially-destroyed state during cleanup below.
  pixiApp.ticker.stop();

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

/**
 * Invalidate any in-flight loadScene() call so its async continuations
 * bail out at the next generation check. Called by app.js when navigating
 * to a frame with no effects — clearAll() alone is not sufficient because
 * it does not advance loadGeneration (it is also called internally by
 * loadScene, where advancing the counter would break the caller's own gen).
 */
export function cancelPendingLoad() {
  loadGeneration++;
}

/**
 * Set the AnalyserNode for audio-reactive modulation (ADR-008).
 * The ticker reads FFT data each frame and modulates effect parameters.
 * Cleared on clearAll(). No-op when node is null.
 */
export function setAnalyser(node) {
  arAnalyser = node;
  if (node) {
    if (!fftData || fftData.length !== node.frequencyBinCount) {
      fftData = new Uint8Array(node.frequencyBinCount);
    }
  } else {
    fftData = null;
  }
}

function cleanupAnalysisElement() {
  if (analysisSilentGain) {
    // Disconnect analyserNode → gain before dropping the gain reference.
    // Without this, the analyserNode accumulates orphaned output connections
    // to dead-end gain nodes across scene transitions (memory leak).
    if (analysisAnalyserRef) {
      try {
        analysisAnalyserRef.disconnect(analysisSilentGain);
      } catch {
        /* already disconnected */
      }
    }
    try {
      analysisSilentGain.disconnect();
    } catch {
      /* already disconnected */
    }
    analysisSilentGain = null;
  }
  analysisAnalyserRef = null;
  if (analysisSource) {
    try {
      analysisSource.disconnect();
    } catch {
      /* already disconnected */
    }
    analysisSource = null;
  }
  if (analysisElement) {
    analysisElement.pause();
    analysisElement.removeAttribute('src');
    analysisElement.load();
    analysisElement = null;
  }
}

/**
 * Create a dedicated <audio> element for FFT analysis (ADR-008 approach B).
 * The element streams the same audio file as the playback cue but is completely
 * independent of Howler. createMediaElementSource() routes its output through
 * the AnalyserNode for FFT reads.
 *
 * Signal chain: MediaElementSource → AnalyserNode → GainNode(0) → destination.
 * Chrome does not process audio through an AnalyserNode unless the graph
 * reaches ctx.destination — a dead-end analyser returns all-zero FFT data.
 * The GainNode is set to 0 so no duplicate audio is audible.
 */
export function connectAnalysisAudio(audioSrc, analyserNode) {
  cleanupAnalysisElement();

  if (!analyserNode) return;

  const ctx = analyserNode.context;
  if (!ctx) return;

  const el = document.createElement('audio');
  el.preload = 'auto';
  el.src = audioSrc;

  try {
    const source = ctx.createMediaElementSource(el);
    source.connect(analyserNode);

    // Route analyser → silent gain → destination so Chrome processes FFT.
    const gain = ctx.createGain();
    gain.gain.value = 0;
    analyserNode.connect(gain);
    gain.connect(ctx.destination);

    analysisElement = el;
    analysisSource = source;
    analysisSilentGain = gain;
    analysisAnalyserRef = analyserNode;

    arAnalyser = analyserNode;
    if (!fftData || fftData.length !== analyserNode.frequencyBinCount) {
      fftData = new Uint8Array(analyserNode.frequencyBinCount);
    }
  } catch (err) {
    console.warn('Failed to create analysis audio source:', err.message);
    el.removeAttribute('src');
  }
}

/**
 * Start playback on the analysis element. Called by app.js when the
 * matching audio cue begins playing, so FFT data tracks the same
 * point in the audio. No-op if no analysis element exists.
 */
export function startAnalysisPlayback() {
  if (!analysisElement) return;
  analysisElement.play().catch((err) => {
    console.warn('Analysis audio play failed:', err.message);
  });
}

export function pause() {
  isPaused = true;
  if (analysisElement) analysisElement.pause();
  if (!webglAvailable || !pixiApp) return;
  pixiApp.ticker.stop();
}

export function resume() {
  isPaused = false;
  if (analysisElement && !reducedMotion()) {
    analysisElement.play().catch(() => {});
  }
  if (!webglAvailable || !pixiApp || reducedMotion()) return;
  if (activeEffects.length > 0) {
    pixiApp.ticker.start();
  }
}

export function destroy() {
  pause();
  cleanupAnalysisElement();

  if (canvasEl) {
    canvasEl.removeEventListener('webglcontextlost', handleContextLost);
    canvasEl.removeEventListener('webglcontextrestored', handleContextRestored);
  }

  if (motionQuery) {
    motionQuery.removeEventListener('change', handleMotionChange);
    motionQuery = null;
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
  centeredEffects = [];
  disposableTextures = [];
  needsReinit = false;
  isPaused = false;
  initPromise = null;
}

export function isRunning() {
  return pixiApp?.ticker?.started ?? false;
}
