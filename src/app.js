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

// Lazy-load pixi.js effects to keep it off the critical rendering path.
// The dynamic import starts immediately but doesn't block initial paint,
// reducing Total Blocking Time on slower CI runners.
const effectsLoaded = import('./effects-canvas.js');
let effectsMod = null;
async function initEffectsCanvas(el) {
  effectsMod ??= await effectsLoaded;
  return effectsMod.init(el);
}
async function loadEffectsScene(...args) {
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

const DEFAULT_MAX_NARRATION_MS = 60000;

function applyFrameDefaults(scenesJson) {
  const defaults = scenesJson.meta.frameDefaults || {};
  return scenesJson.frames.map((frame) => ({ ...defaults, ...frame }));
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
  const img = await loadImage(firstFrame.image);
  if (img) app.imageCache.set(firstFrame.image, img);
}

async function preloadBackgroundImages(app) {
  for (const frame of app.frames.slice(1)) {
    if (frame.image && !app.imageCache.has(frame.image)) {
      const img = await loadImage(frame.image);
      if (img) app.imageCache.set(frame.image, img);
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
  scheduleFrameAudio(app, app.frames[app.currentIndex]);
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
    loadImage(nextFrame.image).then((img) => {
      if (img) app.imageCache.set(nextFrame.image, img);
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
        // Wire audio-reactive bridge after effects are loaded (ADR-008).
        // setAnalyser must run after loadScene so it isn't cleared by clearAll().
        if (frame.effects.regions.some((r) => r.audioReactive)) {
          const analyser = getAnalyserNode();
          if (analyser) {
            setEffectsAnalyser(analyser);
            wireAnalysisAudio(app, frame, analyser);
          }
        }
      })
      .catch((err) => console.error('Effects load failed:', err.message));
  } else {
    cancelPendingLoad();
    clearEffects();
    app.effectsReady = null;
  }

  const sceneIdx = app.sceneMap.byFrame.get(index);
  if (sceneIdx !== undefined) {
    updateProgress(sceneIdx);
  }

  updateNavButtons(app);

  buildNarration(app, frame);

  if (!app.deferFrameAudioUntilResume) {
    if (app.userHasInteracted) {
      scheduleFrameAudio(app, frame);
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

function waitForEffectsReady(app, timeoutMs = 800) {
  if (!app.effectsReady) return Promise.resolve();

  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });

  return Promise.race([app.effectsReady.finally(() => clearTimeout(timeoutId)), timeout]);
}

function waitForImage(app, src) {
  return new Promise((resolve) => {
    const spinnerTimer = setTimeout(() => {
      app.els.transitionLoader.hidden = false;
    }, 300);

    loadImage(src)
      .then((img) => {
        if (img) app.imageCache.set(src, img);
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
    // Pointer/dot-click nav: move focus to active dot.
    // Keyboard nav: leave focus where it is so arrow keys
    // continue to navigate scenes (not roving-tabindex dots).
    focusActiveDot();
  }
  app.lastNavSource = null;
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
  if (wasPaused) {
    const doHardJump = () => {
      const prevIndex = app.currentIndex;
      const prevFrame = app.frames[prevIndex];
      app.currentIndex = toIndex;
      app.deferFrameAudioUntilResume = true;
      try {
        showFrame(app, toIndex);
        app.state = STATE_BY_FRAME_TYPE[toFrame.frameType] || State.SCENE_ACTIVE;
      } catch (err) {
        console.error('Error during scene transition:', err);
        app.currentIndex = prevIndex;
        app.state = STATE_BY_FRAME_TYPE[prevFrame.frameType] || State.SCENE_ACTIVE;
      }
      doPause(app);
      manageFocusAfterTransition(app);
      completePendingNav(app);
    };

    if (toFrame.image && !app.imageCache.has(toFrame.image)) {
      waitForImage(app, toFrame.image).then(doHardJump);
    } else {
      doHardJump();
    }
    return;
  }

  // Animated transition: fade out → swap frame → fade in → land playing.
  // On showFrame failure, revert both the frame index and the state to the
  // previous frame's values to keep the state machine consistent.
  const prevFrame = app.frames[app.currentIndex];
  const proceedWithFrame = () => {
    const prevIndex = app.currentIndex;
    app.currentIndex = toIndex;
    try {
      showFrame(app, toIndex);
    } catch (err) {
      console.error('Error during scene transition:', err);
      app.currentIndex = prevIndex;
      app.state = STATE_BY_FRAME_TYPE[prevFrame.frameType] || State.SCENE_ACTIVE;
      return false;
    }
    return true;
  };

  const landOnFrame = () => {
    app.state = STATE_BY_FRAME_TYPE[toFrame.frameType] || State.SCENE_ACTIVE;
    if (app.pendingPause) {
      app.pendingPause = false;
      doPause(app);
    } else {
      if (app.textTimeline) {
        app.textTimeline.play(0);
      }
      setupAutoAdvance(app);
    }
    manageFocusAfterTransition(app);
    completePendingNav(app);
  };

  if (prefersReducedMotion()) {
    const readyThen = () => {
      if (!proceedWithFrame()) return;
      landOnFrame();
    };

    // Re-check at execution time — image may have been cached by preload-ahead
    if (toFrame.image && !app.imageCache.has(toFrame.image)) {
      waitForImage(app, toFrame.image).then(readyThen);
    } else {
      readyThen();
    }
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
          if (!proceedWithFrame()) {
            gsap.set(app.els.sceneStage, { opacity: 1 });
            completePendingNav(app);
            return;
          }

          // Wait for effects textures to finish loading so they are
          // visible when the stage fades back in. The timeout prevents
          // the screen from staying at opacity 0 on very slow loads.
          await waitForEffectsReady(app);

          gsap.to(app.els.sceneStage, {
            opacity: 1,
            duration: halfDuration,
            ease: 'power2.inOut',
            onComplete: landOnFrame,
          });
        } catch (err) {
          console.error('Unhandled error in transition onComplete:', err);
          gsap.set(app.els.sceneStage, { opacity: 1 });
          landOnFrame();
        }
      };

      // Re-check — image may have been cached by preload-ahead during fade-out
      if (toFrame.image && !app.imageCache.has(toFrame.image)) {
        waitForImage(app, toFrame.image).then(fadeIn);
      } else {
        fadeIn();
      }
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

  if (app.autoAdvanceTimer) {
    app.autoAdvanceTimer.resume();
  } else {
    setupAutoAdvance(app);
  }

  app.analysisStartTimer?.resume();

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

  app.autoAdvanceTimer?.pause();
  app.analysisStartTimer?.pause();

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

  if (app.paused) {
    app.deferFrameAudioUntilResume = true;
    showFrame(app, app.currentIndex);
    const frame = app.frames[app.currentIndex];
    app.state = STATE_BY_FRAME_TYPE[frame.frameType] || State.SCENE_ACTIVE;
    doPause(app);
  } else {
    showFrame(app, app.currentIndex);
    if (app.textTimeline) app.textTimeline.play(0);
    setupAutoAdvance(app);
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
  initEffectsCanvas(app.els.effectsCanvas).catch((err) =>
    console.error('Effects canvas init failed:', err.message),
  );

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

      showFrame(app, 0);

      // Loading screen stays visible as the interactive start gate.
      // Show the "click to begin" prompt and mark it ready for interaction.
      // The prompt text serves as the LCP element for Lighthouse.
      app.els.loadingPrompt.hidden = false;
      app.els.loadingPrompt.classList.add('visible');
      app.els.loadingScreen.classList.add('ready');

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

      app.cleanupKeyboard = initKeyboard((action) => {
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
        retreat(app);
      });
      app.els.btnNext.addEventListener('click', (e) => {
        e.stopPropagation();
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
  ];

  for (const id of requiredIds) {
    if (!document.getElementById(id)) {
      throw new Error(`Required element #${id} not found in DOM`);
    }
  }

  const frames = applyFrameDefaults(scenesData);

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
    autoAdvancing: false,
    pendingNavIndex: null,
    generation: 0,
    deferFrameAudioUntilResume: false,
    pendingPause: false,
    buffering: false,
    effectsReady: null,
    availableAudio: new Set(),
    audioDurations: new Map(),
    projectMaxCaptionMs: computeProjectMaxCaptionMs(frames),
    imageCache: new Map(),
    els: {
      loadingScreen: document.getElementById('loading-screen'),
      sceneStage: document.getElementById('scene-stage'),
      sceneCanvas: document.getElementById('scene-canvas'),
      effectsCanvas: document.getElementById('effects-canvas'),
      narrationLayer: document.getElementById('narration-layer'),
      captionLayer: document.getElementById('caption-layer'),
      accessibleNarration: document.getElementById('accessible-narration'),
      controls: document.getElementById('overlay-controls'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnReplay: document.getElementById('btn-replay'),
      btnMute: document.getElementById('btn-mute'),
      btnPause: document.getElementById('btn-pause'),
      btnCaptions: document.getElementById('btn-captions'),
      loadingPrompt: document.getElementById('loading-prompt'),
      transitionLoader: document.getElementById('transition-loader'),
    },
  };

  initOverlay(app.sceneMap.byFrame.size, (sceneIndex) => {
    const frameIndex = app.sceneMap.byScene.get(sceneIndex);
    if (frameIndex !== undefined && frameIndex !== app.currentIndex) {
      app.userHasInteracted = true;
      transition(app, frameIndex);
    }
  });

  initApp(app);

  return {
    advance: () => advance(app),
    toggleMute: () => toggleMute(app),
    togglePause: () => togglePause(app),
    getState: () => app.state,
  };
}
