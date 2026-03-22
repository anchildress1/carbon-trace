import { gsap } from 'gsap';
import scenesData from './scenes.json';
import {
  scheduleAudioCues,
  cancelAudioCues,
  pauseAudioCues,
  resumeAudioCues,
  cancelCue,
  restartNarrationCue,
  reCueCue,
  setMuted,
  onNarrationBufferChange,
  preloadNarrationAhead,
  clearNarrationCache,
} from './audio.js';
import { PausableTimer } from './pausable-timer.js';
import { buildNarrationTimeline, clearNarrationLayer } from './text.js';
import {
  init as initEffectsCanvas,
  loadScene as loadEffectsScene,
  clearAll as clearEffects,
  pause as pauseEffects,
  resume as resumeEffects,
} from './effects-canvas.js';
import { initOverlay, updateProgress, showControls } from './overlay.js';
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

function clearAutoAdvance(app) {
  app.autoAdvanceTimer?.cancel();
  app.autoAdvanceTimer = null;
}

function scheduleAutoAdvance(app, delay) {
  clearAutoAdvance(app);
  app.autoAdvanceTimer = new PausableTimer(() => {
    app.autoAdvanceTimer = null;
    if (app.paused || app.state === State.TRANSITIONING) return;
    advance(app);
  }, delay);
}

function shouldAutoAdvance(app) {
  return app.currentIndex < app.frames.length - 1;
}

function setupAutoAdvance(app) {
  clearAutoAdvance(app);
  const frame = app.frames[app.currentIndex];
  if (!shouldAutoAdvance(app)) return;

  const holdAfterNarration =
    frame.holdAfterNarration ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;

  // For scenes without narration audio, schedule immediately on landing
  const hasNarrationAudio = frame.audioCues?.some((c) => c.type === 'narration');
  if (!hasNarrationAudio) {
    scheduleAutoAdvance(app, holdAfterNarration);
  }
  // For scenes with narration audio, the onNarrationEnd callback in
  // scheduleAudioCues triggers scheduleAutoAdvance
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

function makeNarrationEndCallback(app, frame, holdAfterNarration) {
  const gen = app.generation;
  return () => {
    if (gen !== app.generation) return;
    if (shouldAutoAdvance(app)) {
      scheduleAutoAdvance(app, holdAfterNarration);
    }
  };
}

function scheduleFrameAudio(app, frame) {
  const holdAfterNarration =
    frame.holdAfterNarration ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;
  const onNarrationEnd = makeNarrationEndCallback(app, frame, holdAfterNarration);
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

function scheduleReplayNarration(app, frame, narrationCue) {
  if (!narrationCue) return;

  const holdAfterNarration =
    frame.holdAfterNarration ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;
  const onNarrationEnd = makeNarrationEndCallback(app, frame, holdAfterNarration);
  const maxNarrationDurationMs = getMaxNarrationDuration(
    frame,
    app.audioDurations,
    app.projectMaxCaptionMs,
  );

  scheduleAudioCues([narrationCue], {
    onNarrationEnd,
    maxNarrationDurationMs,
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

function resumeReplayPendingAudio(app) {
  app.replayPending = false;
  const frame = app.frames[app.currentIndex];
  const narrationCue = getNarrationCueFromFrame(frame);

  if (resumeDeferredFrameAudio(app, { cancelExisting: true })) {
    return;
  }

  if (narrationCue) {
    cancelCue('narration');
  }
  resumeAudioCues();
  scheduleReplayNarration(app, frame, narrationCue);
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
  const narrationCue = getNarrationCueFromFrame(frame);
  const captionDelay = typeof narrationCue?.enter === 'number' ? narrationCue.enter : 0;

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
  clearNarrationCache();
  const nextFrame = app.frames[index + 1];
  if (nextFrame?.image && !app.imageCache.has(nextFrame.image)) {
    loadImage(nextFrame.image).then((img) => {
      if (img) app.imageCache.set(nextFrame.image, img);
    });
  }
  // Only preload narration via Howler after user interaction — Howler's
  // HTML5 Audio pool is empty until the browser unlocks audio on first
  // gesture, so early Howl creation triggers "pool exhausted" warnings.
  if (app.userHasInteracted) {
    const nextNarrationCue = getNarrationCueFromFrame(nextFrame || {});
    if (nextNarrationCue?.src) {
      preloadNarrationAhead(nextNarrationCue.src);
    }
  }
}

function showFrame(app, index) {
  const frame = app.frames[index];
  app.els.sceneStage.setAttribute('aria-label', frame.description || '');
  renderSceneImage(app, frame);
  app.els.traceOverlay.style.opacity = frame.traceOverlay?.opacity ?? 0;

  clearNarrationLayer(app.els.narrationLayer);

  if (frame.effects?.regions?.length) {
    loadEffectsScene(frame.effects, frame.image);
  } else {
    clearEffects();
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

  if (isBuffering) {
    if (!app.paused) {
      if (app.textTimeline) app.textTimeline.pause();
    }
    app.els.sceneStage.classList.add('buffering');
  } else {
    if (!app.paused) {
      if (app.textTimeline) app.textTimeline.resume();
    }
    app.els.sceneStage.classList.remove('buffering');
  }
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

function cleanupCurrentScene(app) {
  app.generation++;
  clearAutoAdvance(app);
  cancelAudioCues();

  clearCaptionElements(app.captionEntries);
  try {
    app.textTimeline?.kill();
  } catch (err) {
    console.error('Failed to kill text timeline:', err);
  }
  app.textTimeline = null;
  app.captionEntries = [];

  app.deferFrameAudioUntilResume = false;
  app.replayPending = false;
}

function transition(app, toIndex) {
  if (app.state === State.TRANSITIONING) {
    app.pendingNavIndex = toIndex;
    return;
  }

  app.pendingNavIndex = null;
  const wasPaused = app.paused;

  if (app.paused) {
    clearPauseState(app);
  }

  app.state = State.TRANSITIONING;
  app.buffering = false;
  app.els.sceneStage.classList.remove('buffering');
  app.els.playGate.hidden = true;

  cleanupCurrentScene(app);

  const toFrame = app.frames[toIndex];

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
      if (app.textTimeline) app.textTimeline.play(0);
      setupAutoAdvance(app);
    }
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
      const fadeIn = () => {
        try {
          if (!proceedWithFrame()) {
            gsap.set(app.els.sceneStage, { opacity: 1 });
            completePendingNav(app);
            return;
          }

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

  if (app.replayPending) {
    resumeReplayPendingAudio(app);
    // Clear caption DOM created as side effect of tl.pause(0) in
    // replayNarration — play(0) will recreate them cleanly.
    clearCaptionElements(app.captionEntries);
    if (app.textTimeline && !app.buffering) {
      app.textTimeline.play(0);
    }
    setupAutoAdvance(app);
  } else {
    if (!resumeDeferredFrameAudio(app)) {
      resumeAudioCues();
    }
    if (app.textTimeline && !app.buffering) {
      app.textTimeline.resume();
    }
  }

  resumeEffects();

  app.autoAdvanceTimer?.resume();

  if (firstPlay) {
    app.els.playGate.hidden = true;
    // Clear stranded 'cued' entries from showFrame's cueAudioCues call —
    // handleFirstPlay will schedule audio fresh via scheduleFrameAudio.
    cancelAudioCues();
    handleFirstPlay(app);
  }

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

  // Invalidate stale onend callbacks from prior narration play.
  // Without this, a queued onend could pass the generation guard
  // and schedule a spurious auto-advance.
  app.generation++;

  app.buffering = false;
  app.els.sceneStage.classList.remove('buffering');

  clearAutoAdvance(app);

  const frame = app.frames[app.currentIndex];
  const narrationCue = getNarrationCueFromFrame(frame);

  if (app.paused) {
    // Replay while paused: cue narration audio, reset text, stay paused.
    // Set replayPending so doResume knows to schedule narration with onend
    // instead of just resuming a paused Howl.
    if (narrationCue) {
      cancelCue('narration');
      reCueCue('narration', narrationCue);
    }
    buildNarration(app, frame);
    app.replayPending = true;
    if (app.textTimeline) {
      app.textTimeline.pause(0);
    }
  } else {
    buildNarration(app, frame);
    if (narrationCue) {
      const holdAfterNarration =
        frame.holdAfterNarration ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;
      const narrationOpts = {
        onNarrationEnd: makeNarrationEndCallback(app, frame, holdAfterNarration),
        maxNarrationDurationMs: getMaxNarrationDuration(
          frame,
          app.audioDurations,
          app.projectMaxCaptionMs,
        ),
        audioDurations: app.audioDurations,
      };
      // Reuse existing Howl to avoid HTML5 Audio pool exhaustion on rapid replays.
      // Falls back to cancel + fresh schedule if no Howl exists yet.
      if (!restartNarrationCue(narrationCue, narrationOpts)) {
        cancelCue('narration');
        scheduleAudioCues([narrationCue], narrationOpts);
      }
    }
    if (app.textTimeline) app.textTimeline.play(0);
    setupAutoAdvance(app);
  }
}

function handleKeydown(app, e) {
  if (e.key === ' ') {
    if (e.target.closest('#overlay-controls')) return;
    e.preventDefault();
    app.userHasInteracted = true;
    togglePause(app);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    app.userHasInteracted = true;
    retreat(app);
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (e.target.closest('#overlay-controls')) return;
    e.preventDefault();
    app.userHasInteracted = true;
    advance(app);
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
  initEffectsCanvas(app.els.effectsCanvas);

  preloadFirstFrameAudio(app.frames, (result) => registerAudio(app, result));
  onNarrationBufferChange((isBuffering) => handleBufferChange(app, isBuffering));

  preloadFirstFrameImage(app)
    .then(() => {
      app.els.sceneStage.hidden = false;
      showControls();

      // Fade out loading screen to reveal the scene stage underneath
      const hideLoading = () => {
        app.els.loadingScreen.hidden = true;
      };
      if (prefersReducedMotion()) {
        hideLoading();
      } else {
        app.els.loadingScreen.classList.add('fade-out');
        app.els.loadingScreen.addEventListener('transitionend', hideLoading, { once: true });
        setTimeout(hideLoading, 900);
      }

      if (app.availableAudio.size > 0) {
        app.els.btnMute.removeAttribute('aria-disabled');
      }

      const captionsEnabled = initCaptions();
      app.els.btnCaptions.setAttribute('aria-pressed', String(captionsEnabled));

      showFrame(app, 0);
      app.els.playGate.hidden = false;

      // Start paused — everything waits for the user to press play.
      // Set SCENE_ACTIVE first so doPause stores the correct resume state.
      // The play-gate label text serves as the LCP element for Lighthouse.
      // On play, doResume → handleFirstPlay sets up narration and auto-advance.
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

      const markInteracted = () => {
        app.userHasInteracted = true;
      };

      document.addEventListener('keydown', (e) => {
        markInteracted();
        handleKeydown(app, e);
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
      app.els.playGate.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePause(app);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize:', err);
      app.els.loadingScreen.textContent = 'Something went wrong. Please refresh.';
    });
}

export function createApp() {
  const requiredIds = [
    'loading-screen',
    'scene-stage',
    'scene-canvas',
    'trace-overlay',
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
    'play-gate',
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
    pendingNavIndex: null,
    generation: 0,
    deferFrameAudioUntilResume: false,
    replayPending: false,
    pendingPause: false,
    buffering: false,
    availableAudio: new Set(),
    audioDurations: new Map(),
    projectMaxCaptionMs: computeProjectMaxCaptionMs(frames),
    imageCache: new Map(),
    els: {
      loadingScreen: document.getElementById('loading-screen'),
      sceneStage: document.getElementById('scene-stage'),
      sceneCanvas: document.getElementById('scene-canvas'),
      traceOverlay: document.getElementById('trace-overlay'),
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
      playGate: document.getElementById('play-gate'),
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
