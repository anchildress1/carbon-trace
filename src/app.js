import { gsap } from 'gsap';
import scenesData from './scenes.json';
import {
  playAmbient,
  crossfadeAmbient,
  playNarration,
  cueNarration,
  stopNarration,
  pauseNarration,
  resumeNarration,
  pauseAmbient,
  resumeAmbient,
  setMuted,
  onNarrationBufferChange,
  preloadNarrationAhead,
  clearNarrationCache,
  playMusic,
  fadeMusic,
  pauseMusic,
  resumeMusic,
  stopMusic,
} from './audio.js';
import { buildNarrationTimeline, clearNarrationLayer } from './text.js';
import { runEffect, clearEffects, effectExists } from './effects.js';
import {
  initCanvas,
  pause as pauseCanvas,
  resume as resumeCanvas,
  clearAll as clearCanvasEffects,
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

function validateEffects(frames) {
  const missing = [];
  for (const frame of frames) {
    for (const key of ['idle', 'entry']) {
      const name = frame.effects?.[key];
      if (name && !effectExists(name)) {
        missing.push(`Frame "${frame.id}" references unknown effect "${name}"`);
      }
    }
  }
  if (missing.length > 0) {
    console.warn(`Unregistered effects (will no-op until implemented):\n  ${missing.join('\n  ')}`);
  }
}

function applyFrameDefaults(scenesJson) {
  const defaults = scenesJson.meta.frameDefaults || {};
  return scenesJson.frames.map((frame) => ({ ...defaults, ...frame }));
}

function prefersReducedMotion() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function registerAudio(app, loaded) {
  if (loaded) {
    app.availableAudio.add(loaded);
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

function clearMusicTimer(app) {
  if (app.musicTimer) {
    clearTimeout(app.musicTimer);
    app.musicTimer = null;
    app.musicTimerStart = null;
    app.musicTimerDelay = null;
  }
}

function clearAutoAdvance(app) {
  if (app.autoAdvanceTimer) {
    clearTimeout(app.autoAdvanceTimer);
    app.autoAdvanceTimer = null;
    app.autoAdvanceTimerStart = null;
    app.autoAdvanceTimerDelay = null;
  }
}

function scheduleAutoAdvance(app, delay) {
  clearAutoAdvance(app);
  app.autoAdvanceTimerStart = Date.now();
  app.autoAdvanceTimerDelay = delay;
  app.autoAdvanceTimer = setTimeout(() => {
    app.autoAdvanceTimer = null;
    app.autoAdvanceTimerStart = null;
    app.autoAdvanceTimerDelay = null;
    if (app.paused || app.state === State.TRANSITIONING) return;
    advance(app);
  }, delay);
}

function shouldAutoAdvance(app, frame) {
  // holdUntilClick: true = wait for click (no auto-advance), false = auto-advance after narration, null = no advance allowed (credits)
  if (frame.holdUntilClick === true || frame.holdUntilClick === null) return false;
  if (app.currentIndex >= app.frames.length - 1) return false;
  return true;
}

function setupAutoAdvance(app) {
  clearAutoAdvance(app);
  const frame = app.frames[app.currentIndex];
  if (!shouldAutoAdvance(app, frame)) return;

  const holdAfterNarration =
    frame.holdAfterNarration ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;

  // For scenes without narration audio, schedule immediately on landing
  if (!frame.narration?.audio) {
    scheduleAutoAdvance(app, holdAfterNarration);
  }
  // For scenes with narration audio, the Howler end callback in
  // scheduleNarrationAudio triggers scheduleAutoAdvance
}

function scheduleMusic(app, music) {
  clearMusicTimer(app);
  stopMusic();

  const enter = music.enter || 0;
  const startPlayback = () => {
    app.musicTimer = null;
    app.musicTimerStart = null;
    app.musicTimerDelay = null;
    playMusic(music.src, music.startVolume);
    fadeMusic(music.fullVolume, music.crescendoMs);

    if (music.exit !== null && music.exit !== undefined) {
      const fadeOutDelay = music.exit - enter;
      if (fadeOutDelay > 0) {
        app.musicExitTimerStart = Date.now();
        app.musicExitTimerDelay = fadeOutDelay;
        app.musicExitTimer = setTimeout(() => {
          app.musicExitTimer = null;
          app.musicExitTimerStart = null;
          app.musicExitTimerDelay = null;
          fadeMusic(0, 2000);
        }, fadeOutDelay);
      }
    }
  };

  if (enter > 0) {
    app.musicTimerStart = Date.now();
    app.musicTimerDelay = enter;
    app.musicTimer = setTimeout(startPlayback, enter);
  } else {
    startPlayback();
  }
}

function scheduleNarrationAudio(app, narration) {
  const frame = app.frames[app.currentIndex];
  const holdAfterNarration =
    frame.holdAfterNarration ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;

  const gen = app.generation;
  const onend = () => {
    if (gen !== app.generation) return;
    if (shouldAutoAdvance(app, frame)) {
      scheduleAutoAdvance(app, holdAfterNarration);
    }
  };

  const delay = narration.delay || 0;
  if (delay > 0) {
    app.narrationTimerStart = Date.now();
    app.narrationTimerDelay = delay;
    app.narrationTimer = setTimeout(() => {
      app.narrationTimer = null;
      app.narrationTimerStart = null;
      app.narrationTimerDelay = null;
      playNarration(narration.audio, onend);
    }, delay);
  } else {
    playNarration(narration.audio, onend);
  }
}

function buildNarration(app, frame) {
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
  const hasAudioRef = Boolean(frame.narration.audio);

  if (hasLines) {
    const result = buildNarrationTimeline(frame.narration.lines, app.els.narrationLayer, {
      reducedMotion: prefersReducedMotion(),
      captions: hasCaptions ? frame.narration.captions : undefined,
      captionContainer: app.els.captionLayer,
      captionDelay: frame.narration.delay || 0,
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
  } else {
    app.els.accessibleNarration.textContent = '';
  }

  app.els.btnReplay.disabled = !(hasLines || hasAudioRef);

  if (hasAudioRef && !app.cueOnly) {
    scheduleNarrationAudio(app, frame.narration);
  } else if (hasAudioRef && app.cueOnly) {
    cueNarration(frame.narration.audio);
  }
}

function applyNarration(app, frame) {
  if (app.narrationTimer) {
    clearTimeout(app.narrationTimer);
    app.narrationTimer = null;
    app.narrationTimerStart = null;
    app.narrationTimerDelay = null;
  }

  buildNarration(app, frame);
}

function applyAmbient(app, frame) {
  if (!frame.ambient) return;

  if (app.currentIndex === 0) {
    playAmbient(frame.ambient.src, frame.ambient.volume, frame.ambient.loop);
  } else {
    crossfadeAmbient(frame.ambient.src, frame.ambient.volume, 800, frame.ambient.loop);
  }
}

function buildSceneIndexMap(frames) {
  const byFrame = new Map();
  const byScene = new Map();
  let count = 0;
  frames.forEach((frame, i) => {
    if (frame.frameType === 'scene' || frame.frameType === 'credits') {
      const sceneIdx = ++count;
      byFrame.set(i, sceneIdx);
      byScene.set(sceneIdx, i);
    }
  });
  return { byFrame, byScene };
}

function showFrame(app, index) {
  if (app.phaseTimer) {
    clearTimeout(app.phaseTimer);
    app.phaseTimer = null;
  }

  const frame = app.frames[index];
  app.els.sceneStage.setAttribute('aria-label', frame.description || '');
  if (frame.image && app.imageCache.has(frame.image)) {
    const img = app.imageCache.get(frame.image);
    if (img) drawSceneImage(img);
    else drawFallback();
  } else if (frame.image) {
    drawFallback();
  } else {
    clearScene();
  }
  app.els.traceOverlay.style.opacity = frame.traceOverlay?.opacity ?? 0;

  clearCanvasEffects();
  clearEffects();
  clearNarrationLayer(app.els.narrationLayer);

  if (frame.effects?.idle) {
    runEffect(frame.effects.idle, app.els.effectsCanvas, app.els.sceneCanvas);
  }

  // Start the effects render loop early so it is already running when the
  // fade-in begins. Without this, effects would appear to 'pop in' after
  // the transition completes.
  resumeCanvas();

  const sceneIdx = app.sceneMap.byFrame.get(index);
  if (sceneIdx !== undefined) {
    updateProgress(sceneIdx);
  }

  updateNavButtons(app);

  if (app.userHasInteracted) {
    applyNarration(app, frame);
  } else {
    app.els.btnReplay.disabled = true;
  }

  applyAmbient(app, frame);

  if (frame.music) {
    scheduleMusic(app, frame.music);
  }

  if (frame.phases) {
    startPhase(app, frame, 0);
  }

  // Pre-buffer next scene's image and narration while current scene plays
  clearNarrationCache();
  const nextFrame = app.frames[index + 1];
  if (nextFrame?.image && !app.imageCache.has(nextFrame.image)) {
    loadImage(nextFrame.image).then((img) => {
      if (img) app.imageCache.set(nextFrame.image, img);
    });
  }
  if (nextFrame?.narration?.audio) {
    preloadNarrationAhead(nextFrame.narration.audio);
  }
}

function startPhase(app, frame, pi) {
  const phase = frame.phases[pi];
  if (!phase) return;

  clearNarrationLayer(app.els.narrationLayer);

  if (phase.narration?.lines?.length > 0) {
    const result = buildNarrationTimeline(phase.narration.lines, app.els.narrationLayer, {
      reducedMotion: prefersReducedMotion(),
      captions: phase.narration.captions,
      captionContainer: app.els.captionLayer,
      captionDelay: phase.narration.delay || 0,
      isCaptionEnabled: areCaptionsEnabled,
    });
    app.textTimeline = result.timeline;
    app.captionEntries = result.captionEntries;
    app.textTimeline.play(0);
    app.els.accessibleNarration.textContent = phase.narration.lines.map((l) => l.text).join(' ');

    if (phase.narration.audio) {
      playNarration(phase.narration.audio);
    }
  }

  if (phase.ambient) {
    crossfadeAmbient(phase.ambient.src, phase.ambient.volume, 600);
  }

  if (phase.duration && pi < frame.phases.length - 1) {
    app.phaseTimerStart = Date.now();
    app.phaseTimerDelay = phase.duration;
    app.pausedPhaseIndex = pi;
    app.phaseTimer = setTimeout(() => startPhase(app, frame, pi + 1), phase.duration);
  }
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
  app.autoAdvanceTimerRemaining = null;

  if (app.phaseTimer) {
    clearTimeout(app.phaseTimer);
    app.phaseTimer = null;
  }

  if (app.narrationTimer) {
    clearTimeout(app.narrationTimer);
    app.narrationTimer = null;
    app.narrationTimerStart = null;
    app.narrationTimerDelay = null;
  }

  clearCaptionElements(app.captionEntries);
  try {
    app.textTimeline?.kill();
  } catch (err) {
    console.error('Failed to kill text timeline:', err);
  }
  app.textTimeline = null;
  app.captionEntries = [];

  clearMusicTimer(app);
  if (app.musicExitTimer) {
    clearTimeout(app.musicExitTimer);
    app.musicExitTimer = null;
    app.musicExitTimerStart = null;
    app.musicExitTimerDelay = null;
  }
  app.musicExitTimerRemaining = null;
  app.musicTimerRemaining = null;
  app.narrationTimerRemaining = null;
  app.phaseTimerRemaining = null;
  stopMusic();
  stopNarration();
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
      app.cueOnly = true;
      try {
        showFrame(app, toIndex);
        app.state = STATE_BY_FRAME_TYPE[toFrame.frameType] || State.SCENE_ACTIVE;
      } catch (err) {
        console.error('Error during scene transition:', err);
        app.currentIndex = prevIndex;
        app.state = STATE_BY_FRAME_TYPE[prevFrame.frameType] || State.SCENE_ACTIVE;
      }
      app.cueOnly = false;
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
  const frame = app.frames[app.currentIndex];
  app.els.btnPrev.disabled = app.currentIndex === 0;
  app.els.btnNext.disabled =
    app.currentIndex >= app.frames.length - 1 || frame.holdUntilClick === null;
}

function resumeDelayedNarration(app) {
  if (!app.narrationTimerRemaining || app.narrationTimerRemaining <= 0) return;
  const frame = app.frames[app.currentIndex];
  app.narrationTimerStart = Date.now();
  app.narrationTimerDelay = app.narrationTimerRemaining;
  app.narrationTimer = setTimeout(() => {
    app.narrationTimer = null;
    app.narrationTimerStart = null;
    app.narrationTimerDelay = null;
    app.narrationTimerRemaining = null;
    if (frame.narration?.audio) {
      playNarration(frame.narration.audio);
    }
  }, app.narrationTimerRemaining);
  app.narrationTimerRemaining = null;
}

function resumeMusicExitTimer(app) {
  if (!app.musicExitTimerRemaining || app.musicExitTimerRemaining <= 0) return;
  app.musicExitTimerStart = Date.now();
  app.musicExitTimerDelay = app.musicExitTimerRemaining;
  app.musicExitTimer = setTimeout(() => {
    app.musicExitTimer = null;
    app.musicExitTimerStart = null;
    app.musicExitTimerDelay = null;
    app.musicExitTimerRemaining = null;
    fadeMusic(0, 2000);
  }, app.musicExitTimerRemaining);
  app.musicExitTimerRemaining = null;
}

function resumeDelayedMusic(app) {
  if (!app.musicTimerRemaining || app.musicTimerRemaining <= 0) return;
  const frame = app.frames[app.currentIndex];
  if (!frame.music) return;
  app.musicTimerStart = Date.now();
  app.musicTimerDelay = app.musicTimerRemaining;
  app.musicTimer = setTimeout(() => {
    app.musicTimer = null;
    app.musicTimerStart = null;
    app.musicTimerDelay = null;
    app.musicTimerRemaining = null;
    playMusic(frame.music.src, frame.music.startVolume);
    fadeMusic(frame.music.fullVolume, frame.music.crescendoMs);

    if (frame.music.exit !== null && frame.music.exit !== undefined) {
      const fadeOutDelay = (frame.music.exit || 0) - (frame.music.enter || 0);
      if (fadeOutDelay > 0) {
        app.musicExitTimerStart = Date.now();
        app.musicExitTimerDelay = fadeOutDelay;
        app.musicExitTimer = setTimeout(() => {
          app.musicExitTimer = null;
          app.musicExitTimerStart = null;
          app.musicExitTimerDelay = null;
          fadeMusic(0, 2000);
        }, fadeOutDelay);
      }
    }
  }, app.musicTimerRemaining);
  app.musicTimerRemaining = null;
}

function resumeDelayedPhase(app) {
  if (!app.phaseTimerRemaining || app.phaseTimerRemaining <= 0) return;
  const frame = app.frames[app.currentIndex];
  const pi = app.pausedPhaseIndex;
  app.phaseTimer = setTimeout(() => startPhase(app, frame, pi + 1), app.phaseTimerRemaining);
  app.phaseTimerRemaining = null;
  app.pausedPhaseIndex = null;
}

function handleFirstPlay(app) {
  const frame = app.frames[app.currentIndex];
  applyNarration(app, frame);
  if (app.textTimeline) {
    app.textTimeline.play(0);
  }
  setupAutoAdvance(app);
}

function doResume(app) {
  const firstPlay = !app.userHasInteracted;
  if (firstPlay) {
    app.userHasInteracted = true;
  }

  app.paused = false;
  app.state = app.pausedFromState;
  app.pausedFromState = null;

  resumeNarration();
  resumeAmbient();
  resumeMusic();

  if (app.textTimeline && !app.buffering) {
    app.textTimeline.resume();
  }

  resumeCanvas();

  resumeDelayedNarration(app);
  resumeDelayedMusic(app);
  resumeDelayedPhase(app);
  resumeMusicExitTimer(app);

  if (app.autoAdvanceTimerRemaining !== null && app.autoAdvanceTimerRemaining > 0) {
    const remaining = app.autoAdvanceTimerRemaining;
    app.autoAdvanceTimerRemaining = null;
    scheduleAutoAdvance(app, remaining);
  }

  if (firstPlay) {
    app.els.playGate.hidden = true;
    handleFirstPlay(app);
  }

  app.els.btnPause.setAttribute('aria-pressed', 'false');
  app.els.btnPause.classList.remove('paused');
}

function saveNarrationTimerRemaining(app) {
  if (!app.narrationTimer) return;
  const elapsed = Date.now() - app.narrationTimerStart;
  app.narrationTimerRemaining = Math.max(0, app.narrationTimerDelay - elapsed);
  clearTimeout(app.narrationTimer);
  app.narrationTimer = null;
  app.narrationTimerStart = null;
  app.narrationTimerDelay = null;
}

function saveMusicTimerRemaining(app) {
  if (!app.musicTimer) return;
  const elapsed = Date.now() - app.musicTimerStart;
  app.musicTimerRemaining = Math.max(0, app.musicTimerDelay - elapsed);
  clearMusicTimer(app);
}

function doPause(app) {
  app.paused = true;
  app.pausedFromState = app.state;
  app.state = State.PAUSED;

  pauseNarration();
  pauseAmbient();
  pauseMusic();

  if (app.textTimeline) {
    app.textTimeline.pause();
  }

  pauseCanvas();

  saveNarrationTimerRemaining(app);
  saveMusicTimerRemaining(app);

  if (app.autoAdvanceTimer) {
    const elapsed = Date.now() - app.autoAdvanceTimerStart;
    app.autoAdvanceTimerRemaining = Math.max(0, app.autoAdvanceTimerDelay - elapsed);
    clearAutoAdvance(app);
  }

  if (app.musicExitTimer) {
    const elapsed = Date.now() - app.musicExitTimerStart;
    app.musicExitTimerRemaining = Math.max(0, app.musicExitTimerDelay - elapsed);
    clearTimeout(app.musicExitTimer);
    app.musicExitTimer = null;
    app.musicExitTimerStart = null;
    app.musicExitTimerDelay = null;
  }

  if (app.phaseTimer) {
    const elapsed = Date.now() - app.phaseTimerStart;
    app.phaseTimerRemaining = Math.max(0, app.phaseTimerDelay - elapsed);
    clearTimeout(app.phaseTimer);
    app.phaseTimer = null;
    app.phaseTimerStart = null;
    app.phaseTimerDelay = null;
  }

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

  if (app.paused) {
    const resumeState = app.pausedFromState || State.SCENE_ACTIVE;
    clearPauseState(app);
    resumeNarration();
    resumeAmbient();
    app.state = resumeState;
  }

  app.buffering = false;
  app.els.sceneStage.classList.remove('buffering');

  clearAutoAdvance(app);
  app.autoAdvanceTimerRemaining = null;

  const frame = app.frames[app.currentIndex];

  if (app.narrationTimer) {
    clearTimeout(app.narrationTimer);
    app.narrationTimer = null;
    app.narrationTimerStart = null;
    app.narrationTimerDelay = null;
  }
  app.narrationTimerRemaining = null;

  buildNarration(app, frame);

  if (app.textTimeline) app.textTimeline.play(0);
  setupAutoAdvance(app);

  if (frame.effects?.entry) {
    runEffect(frame.effects.entry, app.els.effectsCanvas, app.els.sceneCanvas);
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
  initCanvas(app.els.effectsCanvas);

  preloadFirstFrameAudio(app.frames, (loaded) => registerAudio(app, loaded));
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
          preloadBackgroundAudio(app.frames, (loaded) => registerAudio(app, loaded)),
        ]).catch((err) => console.error('Background asset preload failed:', err));
      }, 4000);

      const markInteracted = () => {
        app.userHasInteracted = true;
      };

      // Stage click/tap: skip to next scene (hard cut if paused, animated if playing)
      document.addEventListener('click', (e) => {
        markInteracted();
        if (e.target.closest('#overlay-controls')) return;
        if (e.target.closest('#play-gate')) return;
        advance(app);
      });
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
  validateEffects(frames);

  const app = {
    frames,
    sceneMap: buildSceneIndexMap(frames),
    currentIndex: 0,
    state: State.LOADING,
    muted: false,
    paused: false,
    pausedFromState: null,
    userHasInteracted: false,
    textTimeline: null,
    phaseTimer: null,
    phaseTimerStart: null,
    phaseTimerDelay: null,
    phaseTimerRemaining: null,
    pausedPhaseIndex: null,
    captionEntries: [],
    narrationTimer: null,
    narrationTimerStart: null,
    narrationTimerDelay: null,
    narrationTimerRemaining: null,
    musicTimer: null,
    musicTimerStart: null,
    musicTimerDelay: null,
    musicTimerRemaining: null,
    musicExitTimer: null,
    musicExitTimerStart: null,
    musicExitTimerDelay: null,
    musicExitTimerRemaining: null,
    autoAdvanceTimer: null,
    autoAdvanceTimerStart: null,
    autoAdvanceTimerDelay: null,
    autoAdvanceTimerRemaining: null,
    pendingNavIndex: null,
    generation: 0,
    cueOnly: false,
    pendingPause: false,
    buffering: false,
    availableAudio: new Set(),
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
