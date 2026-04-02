import { gsap } from 'gsap';
import scenesData from './scenes.json';
import {
  scheduleAudioCues,
  cancelAudioCues,
  pauseAudioCues,
  resumeAudioCues,
  setMuted,
  onNarrationBufferChange,
  preloadNarrationAhead,
  trimNarrationCache,
  wrapOnNarrationEndWithBoost,
  getAnalyserNode,
  disconnectAnalyserSource,
  resolveCueEnters,
} from './audio.js';
import { PausableTimer } from './pausable-timer.js';
import { buildNarrationTimeline, clearNarrationLayer } from './text.js';
import { initOverlay, updateProgress, showControls, focusActiveDot } from './overlay.js';
import {
  initSceneCanvas,
  drawImage as drawSceneImage,
  clearScene,
  drawFallback,
  loadImage,
} from './canvas.js';
import { preloadFirstFrameAudio, preloadBackgroundAudio } from './loader.js';
import {
  initCaptions,
  setCaptionsEnabled,
  areCaptionsEnabled,
  syncCaptionsToTime,
  clearCaptionElements,
} from './captions.js';
import { initKeyboard } from './keyboard.js';
import {
  init as initShimmer,
  loadScene as loadShimmerScene,
  pause as pauseShimmer,
  resume as resumeShimmer,
} from './shimmer.js';
import {
  revealCreditsPanel,
  pauseCreditsScroll,
  resumeCreditsScroll,
  cleanupCredits,
} from './credits.js';

// Lazy-load pixi.js effects — the dynamic import is deferred until after
// the loading prompt is visible (post-LCP) so ~330 KB of PixiJS JS never
// lands on the critical path. The import starts while the user reads the
// prompt and is typically ready before they click "begin experience".
let effectsLoaded = null;
let effectsMod = null;
function startEffectsLoad() {
  if (!effectsLoaded) {
    effectsLoaded = import('./effects-canvas.js').catch((err) => {
      effectsLoaded = null;
      throw err;
    });
  }
}
async function initEffectsCanvas(el) {
  startEffectsLoad();
  effectsMod ??= await effectsLoaded;
  return effectsMod.init(el);
}
async function loadEffectsScene(...args) {
  startEffectsLoad();
  effectsMod ??= await effectsLoaded;
  return effectsMod.loadScene(...args);
}
function clearEffects() {
  effectsMod?.clearAll();
}
function cancelPendingLoad() {
  effectsMod?.cancelPendingLoad();
}
function pauseEffects() {
  effectsMod?.pause();
}
function resumeEffects() {
  effectsMod?.resume();
}
function setEffectsAnalyser(node) {
  effectsMod?.setAnalyser(node);
}
function connectEffectsAnalysisAudio(src, analyser, loop) {
  effectsMod?.connectAnalysisAudio(src, analyser, loop);
}
function startEffectsAnalysisPlayback() {
  effectsMod?.startAnalysisPlayback();
}

const State = Object.freeze({
  LOADING: 'LOADING',
  SCENE_ACTIVE: 'SCENE_ACTIVE',
  TRANSITIONING: 'TRANSITIONING',
  PAUSED: 'PAUSED',
  CREDITS: 'CREDITS',
});

const STATE_BY_FRAME_TYPE = {
  credits: State.CREDITS,
};

function frameState(frame) {
  return STATE_BY_FRAME_TYPE[frame.frameType] || State.SCENE_ACTIVE;
}

const DEFAULT_MAX_NARRATION_MS = 60000;

function applyFrameDefaults(scenesJson) {
  return scenesJson.frames.map((frame) => ({ ...frame }));
}

function failScenesConfig(path, expected, value) {
  let actualType = typeof value;
  if (value === null) actualType = 'null';
  else if (Array.isArray(value)) actualType = 'array';
  throw new Error(`Invalid scenes config at ${path}: expected ${expected}, received ${actualType}`);
}

function assertFiniteNumber(value, path) {
  if (!Number.isFinite(value)) {
    failScenesConfig(path, 'finite number', value);
  }
}

function validateScenesConfig(frames) {
  if (!Array.isArray(frames)) {
    failScenesConfig('frames', 'array', frames);
  }

  frames.forEach((frame, frameIndex) => {
    const lines = frame.narration?.lines;
    if (lines === null || lines === undefined) return;

    if (!Array.isArray(lines)) {
      failScenesConfig(`frames[${frameIndex}].narration.lines`, 'array', lines);
    }

    lines.forEach((line, lineIndex) => {
      const linePath = `frames[${frameIndex}].narration.lines[${lineIndex}]`;
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        failScenesConfig(linePath, 'object', line);
      }

      if (typeof line.text !== 'string') {
        failScenesConfig(`${linePath}.text`, 'string', line.text);
      }
      assertFiniteNumber(line.enter, `${linePath}.enter`);
      assertFiniteNumber(line.exit, `${linePath}.exit`);
      assertFiniteNumber(line.x, `${linePath}.x`);
      assertFiniteNumber(line.y, `${linePath}.y`);
    });
  });
}

function prefersReducedMotion() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function dismissLoadingScreen(el) {
  const hide = () => {
    el.hidden = true;
  };
  if (prefersReducedMotion()) {
    hide();
  } else {
    el.classList.add('fade-out');
    el.addEventListener('transitionend', hide, { once: true });
    setTimeout(hide, 900);
  }
}

function computeProjectMaxCaptionMs(frames) {
  let max = 0;
  for (const frame of frames) {
    if (frame.narration?.captions?.length > 0) {
      for (const c of frame.narration.captions) {
        if (c.end > max) max = c.end;
      }
    }
  }
  return max;
}

function registerAudio(app, result) {
  if (result?.src) {
    app.availableAudio.add(result.src);
    if (result.duration > 0) {
      app.audioDurations.set(result.src, result.duration);
    }
    if (app.availableAudio.size === 1) {
      app.els.btnMute.removeAttribute('aria-disabled');
    }
  }
}

async function preloadFirstFrameImage(app) {
  const firstFrame = app.frames[0];
  if (!firstFrame?.image) return;
  try {
    const img = await loadImage(firstFrame.image);
    app.imageCache.set(firstFrame.image, img);
  } catch (err) {
    console.warn('First frame image preload failed:', err.message);
  }
}

async function preloadBackgroundImages(app) {
  for (const frame of app.frames.slice(1)) {
    if (frame.image && !app.imageCache.has(frame.image)) {
      try {
        const img = await loadImage(frame.image);
        app.imageCache.set(frame.image, img);
      } catch (err) {
        console.warn(`Background image preload failed for ${frame.image}:`, err.message);
      }
    }
  }
}

function getHoldAfterNarration(frame) {
  return frame.holdAfterNarration ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;
}

function clearAutoAdvance(app) {
  app.autoAdvanceTimer?.cancel();
  app.autoAdvanceTimer = null;
}

function scheduleAutoAdvance(app, delay) {
  clearAutoAdvance(app);
  app.autoAdvanceTimer = new PausableTimer(() => {
    app.autoAdvanceTimer = null;
    if (app.paused || app.state === State.TRANSITIONING) return;
    app.autoAdvancing = true;
    advance(app);
  }, delay);
}

function shouldAutoAdvance(app) {
  return app.currentIndex < app.frames.length - 1;
}

function setupAutoAdvance(app) {
  const frame = app.frames[app.currentIndex];
  if (!shouldAutoAdvance(app)) {
    clearAutoAdvance(app);
    return;
  }

  const holdAfterNarration = getHoldAfterNarration(frame);

  const hasNarrationAudio = frame.audioCues?.some((c) => c.type === 'narration');
  if (hasNarrationAudio) {
    // Full scene timer: narration enter delay + max duration + hold.
    // onNarrationEnd shortens this when narration ends normally (ADR-009).
    const maxMs = getMaxNarrationDuration(frame, app.audioDurations, app.projectMaxCaptionMs);
    const enterDelay = getNarrationEnterDelay(frame, app.audioDurations, maxMs);
    scheduleAutoAdvance(app, enterDelay + maxMs + holdAfterNarration);
  } else {
    scheduleAutoAdvance(app, holdAfterNarration);
  }
}

function getNarrationCueFromFrame(frame) {
  return frame.audioCues?.find((c) => c.type === 'narration') ?? null;
}

function getMaxNarrationDuration(frame, audioDurations, projectMaxCaptionMs) {
  const narrationCue = getNarrationCueFromFrame(frame);

  // Tier 1: metadata duration from loader.js preload
  if (narrationCue) {
    const metaDuration = audioDurations?.get(narrationCue.src);
    if (metaDuration > 0) return metaDuration * 1000;
  }

  // Tier 2: frame caption max
  if (frame.narration?.captions?.length > 0) {
    return Math.max(...frame.narration.captions.map((c) => c.end));
  }

  // Tier 3: project-wide caption max
  if (projectMaxCaptionMs > 0) return projectMaxCaptionMs;

  // Tier 4: absolute floor
  return DEFAULT_MAX_NARRATION_MS;
}

function getNarrationEnterDelay(frame, audioDurations, maxNarrationDurationMs) {
  const narrationCue = getNarrationCueFromFrame(frame);
  if (!narrationCue) return 0;
  const resolvedEnters = resolveCueEnters(frame.audioCues || [], {
    audioDurations,
    maxNarrationDurationMs,
  });
  return resolvedEnters.find((cue) => cue.id === narrationCue.id)?.resolvedEnter ?? 0;
}

function makeNarrationEndCallback(app, frame, holdAfterNarration) {
  const gen = app.generation;
  return () => {
    if (gen !== app.generation) return;
    if (shouldAutoAdvance(app)) {
      scheduleAutoAdvance(app, holdAfterNarration);
    } else if (frame.credits && !app.creditsRevealTimer) {
      app.creditsRevealTimer = new PausableTimer(() => {
        if (gen !== app.generation) return;
        app.creditsRevealTimer = null;
        revealCreditsPanel(app.els.creditsPanel, app.els.creditsScrollContent, frame.credits, {
          reducedMotion: prefersReducedMotion(),
        });
      }, holdAfterNarration);
    }
  };
}

function resolveAnalyserCueEnter(frame, cue, audioDurations) {
  if (typeof cue.enter === 'number') return cue.enter;
  if (cue.enter?.ref) {
    const refCue = frame.audioCues?.find((c) => c.id === cue.enter.ref);
    if (!refCue) return null;
    if (typeof refCue.enter !== 'number') {
      // Multi-hop anchor refs are not supported — only single-level numeric refs are resolved.
      // If refCue also uses a ref-based enter, fall back to 0 and warn so the issue is visible.
      console.warn(
        `[effects] analyserCueEnter: ref "${cue.enter.ref}" has non-numeric enter — falling back to 0`,
      );
    }
    const refEnter = typeof refCue.enter === 'number' ? refCue.enter : 0;

    // Tier 1: metadata duration from preloader (coerce undefined → 0)
    let refDuration = audioDurations?.get(refCue.src) ?? 0;

    // Tier 2: caption-derived duration (fallback when preload hasn't finished)
    if (refDuration <= 0 && frame.narration?.captions?.length) {
      refDuration = Math.max(...frame.narration.captions.map((c) => c.end)) / 1000;
    }

    if (refDuration > 0) {
      return refEnter + refDuration * 1000 + (cue.enter.offset || 0);
    }
    return null; // anchor unresolvable — don't guess
  }
  return 0;
}

function scheduleFrameAudio(app, frame) {
  const holdAfterNarration = getHoldAfterNarration(frame);
  const onNarrationEnd = wrapOnNarrationEndWithBoost(
    frame.audioCues,
    makeNarrationEndCallback(app, frame, holdAfterNarration),
  );
  const maxNarrationDurationMs = getMaxNarrationDuration(
    frame,
    app.audioDurations,
    app.projectMaxCaptionMs,
  );

  scheduleAudioCues(frame.audioCues, {
    onNarrationEnd,
    maxNarrationDurationMs,
    crossfadeDurationMs: 800,
    audioDurations: app.audioDurations,
  });
}

function resumeDeferredFrameAudio(app, { cancelExisting = false } = {}) {
  if (!app.deferFrameAudioUntilResume) return false;

  app.deferFrameAudioUntilResume = false;
  if (cancelExisting) {
    cancelAudioCues();
  }
  const frame = app.frames[app.currentIndex];
  scheduleFrameAudio(app, frame);
  if (frame.effects?.analyserCueId) {
    const analyser = getAnalyserNode();
    if (analyser) wireAnalysisAudio(app, frame, analyser);
  }
  return true;
}

function buildNarration(app, frame) {
  try {
    app.textTimeline?.kill();
  } catch (err) {
    console.error('Failed to kill text timeline:', err);
  }
  app.textTimeline = null;
  clearNarrationLayer(app.els.narrationLayer);
  clearCaptionElements(app.captionEntries);

  if (!frame.narration) {
    app.els.accessibleNarration.textContent = '';
    app.els.btnReplay.disabled = true;
    app.textTimeline = null;
    app.captionEntries = [];
    return;
  }

  const hasLines = Array.isArray(frame.narration.lines) && frame.narration.lines.length > 0;
  const hasCaptions =
    Array.isArray(frame.narration.captions) && frame.narration.captions.length > 0;
  const captionDelay = getNarrationEnterDelay(
    frame,
    app.audioDurations,
    getMaxNarrationDuration(frame, app.audioDurations, app.projectMaxCaptionMs),
  );

  if (hasLines) {
    const result = buildNarrationTimeline(frame.narration.lines, app.els.narrationLayer, {
      reducedMotion: prefersReducedMotion(),
      captions: hasCaptions ? frame.narration.captions : undefined,
      captionContainer: app.els.captionLayer,
      captionDelay,
      isCaptionEnabled: areCaptionsEnabled,
    });
    app.textTimeline = result.timeline;
    app.captionEntries = result.captionEntries;
  } else {
    app.textTimeline = null;
    app.captionEntries = [];
  }

  if (hasCaptions) {
    app.els.accessibleNarration.textContent = frame.narration.captions.map((c) => c.text).join(' ');
  } else if (hasLines) {
    app.els.accessibleNarration.textContent = frame.narration.lines.map((l) => l.text).join(' ');
  } else {
    app.els.accessibleNarration.textContent = '';
  }

  const narrationCue = getNarrationCueFromFrame(frame);
  app.els.btnReplay.disabled = !(hasLines || narrationCue);
}

function buildSceneIndexMap(frames) {
  const byFrame = new Map();
  const byScene = new Map();
  let count = 0;
  frames.forEach((frame, i) => {
    if (
      frame.frameType === 'title' ||
      frame.frameType === 'scene' ||
      frame.frameType === 'credits'
    ) {
      const sceneIdx = ++count;
      byFrame.set(i, sceneIdx);
      byScene.set(sceneIdx, i);
    }
  });
  return { byFrame, byScene };
}

function renderSceneImage(app, frame) {
  if (frame.image && app.imageCache.has(frame.image)) {
    const img = app.imageCache.get(frame.image);
    if (img) drawSceneImage(img);
    else drawFallback();
  } else if (frame.image) {
    drawFallback();
  } else {
    clearScene();
  }
}

/**
 * Schedule a late redraw for frames whose image wasn't cached at render time.
 * When the image arrives asynchronously, redraw the scene canvas — but only if
 * the user is still on the same frame (stale guard via generation + currentIndex).
 * Deduplicates with in-flight requests: canvas.js loadImage returns the existing promise.
 */
function scheduleImageArrival(app, frame, index) {
  if (!frame.image || app.imageCache.has(frame.image)) return;
  const arrivalGeneration = app.generation;
  loadImage(frame.image)
    .then((img) => {
      app.imageCache.set(frame.image, img);
      if (app.generation !== arrivalGeneration || app.currentIndex !== index) return;
      drawSceneImage(img);
    })
    .catch((err) => {
      console.warn(`Late image arrival failed for frame ${index}:`, err.message);
    });
}

function prebufferNextScene(app, index) {
  const currentFrame = app.frames[index];
  const nextFrame = app.frames[index + 1];
  const currentNarrationCue = getNarrationCueFromFrame(currentFrame || {});
  const nextNarrationCue = getNarrationCueFromFrame(nextFrame || {});

  // Keep only the current and next narration buffers warm across navigation.
  // This avoids evicting a paused scene's ready-to-play narration while still
  // bounding cache growth during long sessions.
  trimNarrationCache([currentNarrationCue?.src, nextNarrationCue?.src]);

  if (nextFrame?.image && !app.imageCache.has(nextFrame.image)) {
    loadImage(nextFrame.image)
      .then((img) => {
        app.imageCache.set(nextFrame.image, img);
      })
      .catch((err) => {
        console.warn(`Next-scene image prebuffer failed for ${nextFrame.image}:`, err.message);
      });
  }
  // Only preload narration via Howler after user interaction — Howler's
  // HTML5 Audio pool is empty until the browser unlocks audio on first
  // gesture, so early Howl creation triggers "pool exhausted" warnings.
  if (app.userHasInteracted) {
    if (nextNarrationCue?.src) {
      preloadNarrationAhead(nextNarrationCue.src);
    }
  }
}

function wireAnalysisAudio(app, frame, analyser) {
  if (!frame.effects.analyserCueId) return;
  const cue = frame.audioCues?.find((c) => c.id === frame.effects.analyserCueId);
  if (!cue?.src) {
    console.warn(
      `[effects] analyserCueId "${frame.effects.analyserCueId}" not found in frame audioCues — analysis audio inactive`,
    );
    return;
  }

  const enterDelay = resolveAnalyserCueEnter(frame, cue, app.audioDurations);
  if (enterDelay === null) return; // anchor unresolvable — analysis stays inert

  connectEffectsAnalysisAudio(cue.src, analyser, !!cue.loop);

  const wireGeneration = app.generation;
  const wireIndex = app.currentIndex;
  const startAnalysisIfCurrent = () => {
    // Ignore stale timers from superseded showFrame calls.
    if (wireGeneration !== app.generation || wireIndex !== app.currentIndex) return;
    app.analysisStartTimer = null;
    startEffectsAnalysisPlayback();
  };

  // When paused, never start analysis playback immediately. Queue it on a
  // timer and pause that timer so resume() controls when playback starts.
  const shouldDeferStart = enterDelay > 0 || app.paused;
  if (shouldDeferStart) {
    app.analysisStartTimer = new PausableTimer(startAnalysisIfCurrent, Math.max(0, enterDelay));
    if (app.paused) app.analysisStartTimer.pause();
  } else {
    startAnalysisIfCurrent();
  }
}

function showFrame(app, index) {
  const frame = app.frames[index];
  app.els.sceneStage.setAttribute('aria-label', frame.description || '');
  renderSceneImage(app, frame);
  scheduleImageArrival(app, frame, index);
  clearNarrationLayer(app.els.narrationLayer);

  if (frame.effects?.regions?.length) {
    const showGeneration = app.generation;
    const showIndex = index;
    app.effectsReady = loadEffectsScene(frame.effects, frame.image)
      .then((loaded) => {
        // loadScene can resolve false when superseded, unavailable, or failed.
        if (!loaded) return;
        // Ignore stale completions from old showFrame calls.
        if (showGeneration !== app.generation || showIndex !== app.currentIndex) return;
        // setAnalyser must run after loadScene — buildAudioReactiveState() inside
        // loadScene populates the state that setAnalyser reads. clearAll() would
        // wipe it if called before this resolves.
        if (frame.effects.regions.some((r) => r.audioReactive)) {
          const analyser = getAnalyserNode();
          if (analyser) setEffectsAnalyser(analyser);
        }
      })
      .catch((err) => console.error('Effects load failed:', err));
  } else {
    cancelPendingLoad();
    clearEffects();
    app.effectsReady = null;
  }

  // Shimmer trace overlay — load circuit mask if one exists for this scene.
  // Pass the full traceOverlay config (mask, opacity, color, dotCount).
  app.shimmerReady = frame.traceOverlay
    ? loadShimmerScene(frame.traceOverlay).catch((err) => {
        console.error('Shimmer load failed:', err);
      })
    : loadShimmerScene(null);

  const sceneIdx = app.sceneMap.byFrame.get(index);
  if (sceneIdx !== undefined) {
    updateProgress(sceneIdx);
  }

  updateNavButtons(app);

  buildNarration(app, frame);

  if (!app.deferFrameAudioUntilResume) {
    if (app.userHasInteracted) {
      scheduleFrameAudio(app, frame);
      if (frame.effects?.analyserCueId) {
        const analyser = getAnalyserNode();
        if (analyser) wireAnalysisAudio(app, frame, analyser);
      }
    } else {
      app.els.btnReplay.disabled = true;
    }
  }

  prebufferNextScene(app, index);
}

function clearPauseState(app) {
  app.paused = false;
  app.pausedFromState = null;
  if (app.els.btnPause) {
    app.els.btnPause.setAttribute('aria-pressed', 'false');
    app.els.btnPause.classList.remove('paused');
  }
}

function handleBufferChange(app, isBuffering) {
  app.buffering = isBuffering;
  app.els.sceneStage.classList.toggle('buffering', isBuffering);

  // Guard: do not touch the text timeline during transitions —
  // landOnFrame will start it once the fade-in completes.
  if (app.state === State.TRANSITIONING) return;

  if (!app.paused && app.textTimeline) {
    if (isBuffering) app.textTimeline.pause();
    else app.textTimeline.resume();
  }
}

function waitForOverlaysReady(app, timeoutMs = 800) {
  const pending = [app.effectsReady, app.shimmerReady].filter(Boolean);
  if (pending.length === 0) return Promise.resolve();

  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });

  return Promise.race([Promise.all(pending).finally(() => clearTimeout(timeoutId)), timeout]);
}

function waitForImage(app, src) {
  return new Promise((resolve) => {
    const spinnerTimer = setTimeout(() => {
      app.els.transitionLoader.hidden = false;
    }, 300);

    loadImage(src)
      .then((img) => {
        app.imageCache.set(src, img);
      })
      .catch((err) => {
        console.warn(`Image load failed during transition: ${src}`, err.message);
      })
      .finally(() => {
        clearTimeout(spinnerTimer);
        app.els.transitionLoader.hidden = true;
        resolve();
      });
  });
}

function completePendingNav(app) {
  if (app.pendingNavIndex !== null && app.pendingNavIndex !== app.currentIndex) {
    const pending = app.pendingNavIndex;
    app.pendingNavIndex = null;
    queueMicrotask(() => transition(app, pending));
  }
}

function cleanupCurrentScene(app, opts = {}) {
  const preserveAmbient = opts.preserveAmbient === true;
  app.generation++;
  clearAutoAdvance(app);
  cancelPendingLoad();
  disconnectAnalyserSource();
  cancelAudioCues({ preserveAmbient });

  if (app.analysisStartTimer) {
    app.analysisStartTimer.cancel();
    app.analysisStartTimer = null;
  }

  app.creditsRevealTimer?.cancel();
  app.creditsRevealTimer = null;
  cleanupCredits(app.els.creditsPanel);

  clearCaptionElements(app.captionEntries);
  try {
    app.textTimeline?.kill();
  } catch (err) {
    console.error('Failed to kill text timeline:', err);
  }
  app.textTimeline = null;
  app.captionEntries = [];

  app.deferFrameAudioUntilResume = false;
}

function manageFocusAfterTransition(app) {
  if (app.autoAdvancing) {
    app.autoAdvancing = false;
    if (document.activeElement?.closest('.progress-dots')) {
      focusActiveDot();
    } else if (document.activeElement?.closest('.control-buttons')) {
      document.activeElement.blur();
    }
  } else if (app.lastNavSource !== 'keyboard') {
    // Pointer/dot-click nav: focus btn-pause so Space immediately toggles pause
    // via native button activation (allowOnButton: false defers Space to the
    // focused button — btn-pause natively activates togglePause).
    app.els.btnPause.focus();
  }
  app.lastNavSource = null;
}

function doHardJump(app, toIndex, toFrame) {
  const prevIndex = app.currentIndex;
  const prevFrame = app.frames[prevIndex];
  app.currentIndex = toIndex;
  app.deferFrameAudioUntilResume = true;
  try {
    showFrame(app, toIndex);
    app.state = frameState(toFrame);
  } catch (err) {
    console.error('Error during scene transition:', err);
    app.currentIndex = prevIndex;
    app.state = frameState(prevFrame);
  }
  doPause(app);
  manageFocusAfterTransition(app);
  completePendingNav(app);
}

function doClickJump(app, toIndex, toFrame, prevFrame) {
  const prevIndex = app.currentIndex;
  app.currentIndex = toIndex;
  try {
    showFrame(app, toIndex);
    app.state = frameState(toFrame);
  } catch (err) {
    console.error('Error during scene transition:', err);
    app.currentIndex = prevIndex;
    app.state = frameState(prevFrame);
    return;
  }
  if (app.pendingPause) {
    app.pendingPause = false;
    doPause(app);
  } else {
    app.textTimeline?.play(0);
    setupAutoAdvance(app);
  }
  manageFocusAfterTransition(app);
  completePendingNav(app);
}

// Calls fn() immediately if the frame's image is cached, otherwise waits for it.
function whenImageReady(app, frame, fn) {
  if (frame.image && !app.imageCache.has(frame.image)) {
    waitForImage(app, frame.image).then(fn);
  } else {
    fn();
  }
}

// Advances currentIndex to toIndex, renders the frame, and returns true on success.
// On showFrame failure, reverts currentIndex and state to preserve consistency.
function proceedWithFrame(app, toIndex) {
  const prevIndex = app.currentIndex;
  app.currentIndex = toIndex;
  try {
    showFrame(app, toIndex);
  } catch (err) {
    console.error('Error during scene transition:', err);
    app.currentIndex = prevIndex;
    app.state = frameState(app.frames[prevIndex]);
    return false;
  }
  return true;
}

// Completes landing on toFrame after a successful proceedWithFrame.
function landOnFrame(app, toFrame) {
  app.state = frameState(toFrame);
  if (app.pendingPause) {
    app.pendingPause = false;
    doPause(app);
  } else {
    app.textTimeline?.play(0);
    setupAutoAdvance(app);
  }
  manageFocusAfterTransition(app);
  completePendingNav(app);
}

function transition(app, toIndex) {
  if (app.state === State.TRANSITIONING) {
    app.pendingNavIndex = toIndex;
    return;
  }

  app.pendingNavIndex = null;
  const wasPaused = app.paused;
  const toFrame = app.frames[toIndex];
  const targetHasAmbientCue = toFrame.audioCues?.some((cue) => cue.type === 'ambient');

  if (app.paused) {
    clearPauseState(app);
  }

  app.state = State.TRANSITIONING;
  app.buffering = false;
  app.els.sceneStage.classList.remove('buffering');
  app.els.loadingScreen.hidden = true;

  cleanupCurrentScene(app, {
    preserveAmbient: !wasPaused && targetHasAmbientCue,
  });

  // Hard jump: instant cut when navigating while paused.
  // No fade animation — swap frame and re-pause immediately.
  // Image is not awaited — showFrame renders fallback if uncached,
  // and scheduleImageArrival redraws when the image arrives.
  if (wasPaused) {
    doHardJump(app, toIndex, toFrame);
    return;
  }

  // Hard jump for explicit click navigation: instant cut, no fade animation.
  // Keyboard nav and auto-advance still use the animated path for cinematic feel.
  if (app.lastNavSource === 'click') {
    const prevFrame = app.frames[app.currentIndex];
    doClickJump(app, toIndex, toFrame, prevFrame);
    return;
  }

  if (prefersReducedMotion()) {
    // Re-check at execution time — image may have been cached by preload-ahead
    whenImageReady(app, toFrame, () => {
      if (!proceedWithFrame(app, toIndex)) return;
      landOnFrame(app, toFrame);
    });
    return;
  }

  const transitionConfig = toFrame.transition || scenesData.meta.defaultTransition;
  const halfDuration = transitionConfig.duration / 2000;

  gsap.to(app.els.sceneStage, {
    opacity: 0,
    duration: halfDuration,
    ease: 'power2.inOut',
    onComplete: () => {
      const fadeIn = async () => {
        try {
          if (!proceedWithFrame(app, toIndex)) {
            gsap.set(app.els.sceneStage, { opacity: 1 });
            completePendingNav(app);
            return;
          }

          // Wait for effects textures and shimmer mask to finish loading
          // so they are visible when the stage fades back in. The timeout
          // prevents the screen from staying at opacity 0 on very slow loads.
          await waitForOverlaysReady(app);

          gsap.to(app.els.sceneStage, {
            opacity: 1,
            duration: halfDuration,
            ease: 'power2.inOut',
            onComplete: landOnFrame.bind(null, app, toFrame),
          });
        } catch (err) {
          console.error('Unhandled error in transition onComplete:', err);
          gsap.set(app.els.sceneStage, { opacity: 1 });
          landOnFrame(app, toFrame);
        }
      };

      // Re-check — image may have been cached by preload-ahead during fade-out
      whenImageReady(app, toFrame, fadeIn);
    },
  });
}

function advance(app) {
  if (app.state === State.CREDITS) return;
  if (app.currentIndex >= app.frames.length - 1) return;

  app.userHasInteracted = true;
  transition(app, app.currentIndex + 1);
}

function retreat(app) {
  if (app.currentIndex <= 0) return;

  app.userHasInteracted = true;
  transition(app, app.currentIndex - 1);
}

function updateNavButtons(app) {
  app.els.btnPrev.disabled = app.currentIndex === 0;
  app.els.btnNext.disabled = app.currentIndex >= app.frames.length - 1;
}

function handleFirstPlay(app) {
  app.firstPlayCompleted = true;
  const frame = app.frames[app.currentIndex];
  app.els.btnReplay.disabled = !(
    (Array.isArray(frame.narration?.lines) && frame.narration.lines.length > 0) ||
    getNarrationCueFromFrame(frame)
  );
  scheduleFrameAudio(app, frame);
  if (app.textTimeline) {
    app.textTimeline.play(0);
  }
  setupAutoAdvance(app);
}

function doResume(app) {
  const firstPlay = !app.firstPlayCompleted;

  app.paused = false;
  app.state = app.pausedFromState ?? State.SCENE_ACTIVE;
  app.pausedFromState = null;

  if (firstPlay) {
    dismissLoadingScreen(app.els.loadingScreen);
    // Move focus to the pause button so a pending Space keyup doesn't
    // activate an unintended control (e.g., btn-next) after the loading
    // screen loses focus.
    app.els.btnPause.focus();
    // Clear stranded audio entries from showFrame's scheduleFrameAudio call —
    // handleFirstPlay will schedule audio fresh via scheduleFrameAudio.
    cancelAudioCues();
    handleFirstPlay(app);
  } else {
    if (!resumeDeferredFrameAudio(app)) {
      resumeAudioCues();
    }
    if (app.textTimeline && !app.buffering) {
      app.textTimeline.resume();
    }
  }

  resumeEffects();
  resumeShimmer();

  if (app.autoAdvanceTimer) {
    app.autoAdvanceTimer.resume();
  } else {
    setupAutoAdvance(app);
  }

  app.analysisStartTimer?.resume();
  app.creditsRevealTimer?.resume();
  resumeCreditsScroll();

  app.els.btnPause.setAttribute('aria-pressed', 'false');
  app.els.btnPause.classList.remove('paused');
}

function doPause(app) {
  app.paused = true;
  app.pausedFromState = app.state;
  app.state = State.PAUSED;

  pauseAudioCues();

  if (app.textTimeline) {
    app.textTimeline.pause();
  }

  pauseEffects();
  pauseShimmer();

  app.autoAdvanceTimer?.pause();
  app.analysisStartTimer?.pause();
  app.creditsRevealTimer?.pause();
  pauseCreditsScroll();

  app.els.btnPause.setAttribute('aria-pressed', 'true');
  app.els.btnPause.classList.add('paused');
}

function togglePause(app) {
  if (app.state === State.LOADING) return;

  // Queue pause intent during transitions — applied when transition completes
  if (app.state === State.TRANSITIONING) {
    app.pendingPause = !app.pendingPause;
    return;
  }

  if (app.paused) {
    doResume(app);
  } else {
    doPause(app);
  }
}

function replayNarration(app) {
  if (app.state === State.TRANSITIONING || app.state === State.LOADING) return;

  app.userHasInteracted = true;

  // Full scene reset — identical to hard-jump navigation (ADR-004 addendum).
  // cleanupCurrentScene kills all audio, effects, text, captions, analyser.
  // showFrame reloads effects, rebuilds text, and schedules all audio fresh.
  cleanupCurrentScene(app);

  const prevFrame = app.frames[app.currentIndex];
  try {
    if (app.paused) {
      app.deferFrameAudioUntilResume = true;
      showFrame(app, app.currentIndex);
      app.state = frameState(prevFrame);
      doPause(app);
    } else {
      showFrame(app, app.currentIndex);
      if (app.textTimeline) app.textTimeline.play(0);
      setupAutoAdvance(app);
    }
  } catch (err) {
    console.error('Error during replay:', err);
    app.state = frameState(prevFrame);
  }
}

function toggleMute(app) {
  app.muted = !app.muted;
  setMuted(app.muted);
  app.els.btnMute.classList.toggle('muted', app.muted);
  app.els.btnMute.setAttribute('aria-label', app.muted ? 'Unmute audio' : 'Mute audio');
}

function toggleCaptions(app) {
  const enabled = !areCaptionsEnabled();
  setCaptionsEnabled(enabled);
  app.els.btnCaptions.setAttribute('aria-pressed', String(enabled));
  app.els.btnCaptions.classList.toggle('cc-on', enabled);

  if (enabled) {
    if (app.captionEntries?.length > 0 && app.textTimeline) {
      syncCaptionsToTime(app.captionEntries, app.textTimeline.time(), app.els.captionLayer);
    }
  } else {
    clearCaptionElements(app.captionEntries);
  }
}

function initApp(app) {
  initSceneCanvas(app.els.sceneCanvas);

  preloadFirstFrameAudio(app.frames, (result) => registerAudio(app, result));
  onNarrationBufferChange((isBuffering) => handleBufferChange(app, isBuffering));

  preloadFirstFrameImage(app)
    .then(() => {
      app.els.sceneStage.hidden = false;
      showControls();

      if (app.availableAudio.size > 0) {
        app.els.btnMute.removeAttribute('aria-disabled');
      }

      const captionsEnabled = initCaptions();
      app.els.btnCaptions.setAttribute('aria-pressed', String(captionsEnabled));
      app.els.btnCaptions.classList.toggle('cc-on', captionsEnabled);

      // Performance invariant: overlay init is deferred until after LCP
      // (ADR-012 §3, optimization #6). This requires frame 0 to have no
      // effects or shimmer — otherwise showFrame(app, 0) would trigger
      // overlay loads before the systems are initialized. If frame 0 ever
      // needs overlays, the init sequence must be restructured.
      const frame0 = app.frames[0];
      if (frame0.effects?.regions?.length || frame0.traceOverlay) {
        throw new Error(
          'Frame 0 declares effects or traceOverlay, but overlay init is deferred ' +
            'until after LCP. Restructure initApp() to init overlays before showFrame() ' +
            'for frame 0, or remove overlays from frame 0. See ADR-012 §3, optimization #6.',
        );
      }

      showFrame(app, 0);

      // Loading screen stays visible as the interactive start gate.
      // Show the "click to begin" prompt and mark it ready for interaction.
      // The prompt text serves as the LCP element for Lighthouse.
      app.els.loadingPrompt.hidden = false;
      app.els.loadingPrompt.classList.add('visible');
      app.els.loadingScreen.classList.add('ready');

      // Deferred overlay init — post-LCP. Frame 0 is validated above to
      // have no overlays, so starting these now (while the user reads the
      // prompt) avoids TBT on the critical path while ensuring they are
      // ready before the user advances to frame 1.
      startEffectsLoad();
      initEffectsCanvas(app.els.effectsCanvas).catch((err) =>
        console.error('Effects canvas init failed:', err.message),
      );
      try {
        initShimmer(app.els.traceOverlay);
      } catch (err) {
        console.error('Shimmer init failed:', err.message);
      }

      app.state = State.SCENE_ACTIVE;
      doPause(app);

      // Defer background asset preloads to avoid contention with first-frame
      // rendering. Image and audio streams load in parallel; within each
      // stream, assets load sequentially by scene order.
      setTimeout(() => {
        Promise.all([
          preloadBackgroundImages(app),
          preloadBackgroundAudio(app.frames, (result) => registerAudio(app, result)),
        ]).catch((err) => console.error('Background asset preload failed:', err));
      }, 4000);

      initKeyboard((action) => {
        app.userHasInteracted = true;
        switch (action) {
          case 'togglePause':
            togglePause(app);
            break;
          case 'pause':
            if (!app.paused) doPause(app);
            break;
          case 'advance':
            app.lastNavSource = 'keyboard';
            advance(app);
            break;
          case 'retreat':
            app.lastNavSource = 'keyboard';
            retreat(app);
            break;
        }
      });
      app.els.btnPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        app.lastNavSource = 'click';
        retreat(app);
      });
      app.els.btnNext.addEventListener('click', (e) => {
        e.stopPropagation();
        app.lastNavSource = 'click';
        advance(app);
      });
      app.els.btnMute.addEventListener('click', (e) => {
        e.stopPropagation();
        if (app.els.btnMute.getAttribute('aria-disabled') === 'true') return;
        toggleMute(app);
      });
      app.els.btnReplay.addEventListener('click', (e) => {
        e.stopPropagation();
        replayNarration(app);
      });
      app.els.btnPause.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePause(app);
      });
      app.els.btnCaptions.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCaptions(app);
      });
      app.els.loadingScreen.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePause(app);
      });
      app.els.sceneStage.addEventListener('click', (e) => {
        if (e.target.closest('#credits-panel')) return;
        app.userHasInteracted = true;
        togglePause(app);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize:', err);
      app.els.loadingScreen.textContent = 'Something went wrong. Please refresh.';
      app.els.loadingScreen.setAttribute('aria-label', 'Something went wrong. Please refresh.');
      app.els.loadingScreen.disabled = true;
    });
}

export function createApp() {
  const requiredIds = [
    'loading-screen',
    'scene-stage',
    'scene-canvas',
    'effects-canvas',
    'trace-overlay',
    'narration-layer',
    'caption-layer',
    'accessible-narration',
    'overlay-controls',
    'progress-dots',
    'btn-prev',
    'btn-next',
    'btn-replay',
    'btn-mute',
    'btn-pause',
    'btn-captions',
    'loading-prompt',
    'transition-loader',
    'credits-panel',
    'credits-scroll-content',
  ];

  for (const id of requiredIds) {
    if (!document.getElementById(id)) {
      throw new Error(`Required element #${id} not found in DOM`);
    }
  }

  const frames = applyFrameDefaults(scenesData);
  validateScenesConfig(frames);

  const app = {
    frames,
    sceneMap: buildSceneIndexMap(frames),
    currentIndex: 0,
    state: State.LOADING,
    muted: false,
    paused: false,
    pausedFromState: null,
    userHasInteracted: false,
    firstPlayCompleted: false,
    textTimeline: null,
    captionEntries: [],
    autoAdvanceTimer: null,
    analysisStartTimer: null,
    creditsRevealTimer: null,
    autoAdvancing: false,
    pendingNavIndex: null,
    generation: 0,
    deferFrameAudioUntilResume: false,
    pendingPause: false,
    lastNavSource: null,
    buffering: false,
    effectsReady: null,
    shimmerReady: null,
    availableAudio: new Set(),
    audioDurations: new Map(),
    projectMaxCaptionMs: computeProjectMaxCaptionMs(frames),
    imageCache: new Map(),
    els: {
      loadingScreen: document.getElementById('loading-screen'),
      sceneStage: document.getElementById('scene-stage'),
      sceneCanvas: document.getElementById('scene-canvas'),
      effectsCanvas: document.getElementById('effects-canvas'),
      traceOverlay: document.getElementById('trace-overlay'),
      narrationLayer: document.getElementById('narration-layer'),
      captionLayer: document.getElementById('caption-layer'),
      accessibleNarration: document.getElementById('accessible-narration'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnReplay: document.getElementById('btn-replay'),
      btnMute: document.getElementById('btn-mute'),
      btnPause: document.getElementById('btn-pause'),
      btnCaptions: document.getElementById('btn-captions'),
      loadingPrompt: document.getElementById('loading-prompt'),
      transitionLoader: document.getElementById('transition-loader'),
      creditsPanel: document.getElementById('credits-panel'),
      creditsScrollContent: document.getElementById('credits-scroll-content'),
    },
  };

  initOverlay(app.sceneMap.byFrame.size, (sceneIndex) => {
    const frameIndex = app.sceneMap.byScene.get(sceneIndex);
    if (frameIndex !== undefined && frameIndex !== app.currentIndex) {
      app.userHasInteracted = true;
      app.lastNavSource = 'click';
      transition(app, frameIndex);
    }
  });

  initApp(app);

  const api = {
    advance: () => advance(app),
    toggleMute: () => toggleMute(app),
    togglePause: () => togglePause(app),
    getState: () => app.state,
  };

  if (import.meta.env.VITE_E2E === '1') {
    /* v8 ignore start -- E2E harness methods: exercised by Playwright, not unit tests */
    Object.assign(api, {
      forceNarrationEndForTesting: () => {
        const frame = app.frames[app.currentIndex];
        if (!frame) return;
        const holdAfterNarration = getHoldAfterNarration(frame);
        makeNarrationEndCallback(app, frame, holdAfterNarration)();
      },
      forceCreditsRevealForTesting: () => {
        const frame = app.frames[app.currentIndex];
        if (!frame?.credits) return;
        if (app.creditsRevealTimer) {
          app.creditsRevealTimer.cancel();
          app.creditsRevealTimer = null;
        }
        // Pause canvas effects and shimmer to free the main thread —
        // on CI runners, rAF loops from PixiJS/shimmer/canvas starve
        // Playwright's CDP communication and cause test timeouts.
        pauseEffects();
        pauseShimmer();
        revealCreditsPanel(app.els.creditsPanel, app.els.creditsScrollContent, frame.credits, {
          reducedMotion: prefersReducedMotion(),
        });
      },
      _debugCreditsState: () => ({
        currentIndex: app.currentIndex,
        frameCount: app.frames.length,
        state: app.state,
        paused: app.paused,
        generation: app.generation,
        hasCreditsTimer: app.creditsRevealTimer !== null,
        creditsTimerActive: app.creditsRevealTimer?.isActive ?? null,
        creditsTimerPaused: app.creditsRevealTimer?.isPaused ?? null,
        panelHidden: app.els.creditsPanel?.hidden,
        frameHasCredits: !!app.frames[app.currentIndex]?.credits,
      }),
      forceBufferStateForTesting: (isBuffering) => {
        handleBufferChange(app, isBuffering);
      },
    });
    /* v8 ignore stop */
  }

  return api;
}
