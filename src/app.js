import { gsap } from 'gsap';
import scenesData from './scenes.json';
import {
  playAmbient,
  crossfadeAmbient,
  playNarration,
  stopNarration,
  pauseNarration,
  resumeNarration,
  pauseAmbient,
  resumeAmbient,
  setMuted,
} from './audio.js';
import { buildTextTimeline, clearNarrationLayer } from './text.js';
import { runEffect, clearEffects, effectExists } from './effects.js';
import { initOverlay, updateProgress, showControls } from './overlay.js';
import {
  initCaptions,
  setCaptionsEnabled,
  showCaptions,
  clearCaptions,
  pauseCaptions,
  resumeCaptions,
  areCaptionsEnabled,
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
  for (const frame of frames) {
    for (const key of ['idle', 'entry']) {
      const name = frame.effects?.[key];
      if (name && !effectExists(name)) {
        console.error(`Frame "${frame.id}" references unknown effect "${name}"`);
      }
    }
  }
}

function applyFrameDefaults(scenesJson) {
  const defaults = scenesJson.meta.frameDefaults || {};
  return scenesJson.frames.map((frame) => ({ ...defaults, ...frame }));
}

function prefersReducedMotion() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = () => {
      console.warn(`Failed to load image: ${src}`);
      resolve();
    };
    img.src = src;
  });
}

function preloadAudio(src) {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'auto';

    const timeout = setTimeout(() => {
      console.warn(`Audio preload timed out: ${src}`);
      resolve(null);
    }, 5000);

    audio.oncanplaythrough = () => {
      clearTimeout(timeout);
      resolve(src);
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      console.warn(`Failed to preload audio: ${src}`);
      resolve(null);
    };
    audio.src = src;
  });
}

function audioSrcsFromEntry(entry) {
  return [entry.ambient?.src, entry.narration?.audio].filter(Boolean);
}

function collectAudioSrcs(frames) {
  const srcs = new Set();
  const entries = frames.flatMap((f) => [f, ...(f.phases || [])]);
  for (const entry of entries) {
    for (const src of audioSrcsFromEntry(entry)) {
      srcs.add(src);
    }
  }
  return srcs;
}

function preloadAudioInBackground(app) {
  const audioSrcs = [...collectAudioSrcs(app.frames)];
  for (const src of audioSrcs) {
    preloadAudio(src).then((loaded) => {
      if (loaded) {
        app.availableAudio.add(loaded);
        if (app.availableAudio.size === 1) {
          app.els.btnMute.removeAttribute('aria-disabled');
        }
      }
    });
  }
}

function preloadRemainingImages(app) {
  app.frames
    .slice(1)
    .filter((frame) => frame.image)
    .forEach((frame) => preloadImage(frame.image));
}

function preloadAssets(app) {
  const firstFrame = app.frames[0];
  return firstFrame?.image ? preloadImage(firstFrame.image) : Promise.resolve();
}

function scheduleNarrationAudio(app, narration) {
  if (!app.userHasInteracted) return;

  const delay = narration.delay || 0;
  if (delay > 0) {
    app.narrationTimerStart = Date.now();
    app.narrationTimerDelay = delay;
    app.narrationTimer = setTimeout(() => {
      app.narrationTimer = null;
      app.narrationTimerStart = null;
      app.narrationTimerDelay = null;
      playNarration(narration.audio);
    }, delay);
  } else {
    playNarration(narration.audio);
  }
}

function applyNarration(app, frame) {
  if (app.narrationTimer) {
    clearTimeout(app.narrationTimer);
    app.narrationTimer = null;
    app.narrationTimerStart = null;
    app.narrationTimerDelay = null;
  }

  clearCaptions();

  if (!frame.narration) {
    app.els.accessibleNarration.textContent = '';
    app.els.btnReplay.disabled = true;
    app.textTimeline = null;
    return;
  }

  const hasLines = Array.isArray(frame.narration.lines) && frame.narration.lines.length > 0;
  const hasCaptions =
    Array.isArray(frame.narration.captions) && frame.narration.captions.length > 0;
  const hasAudioRef = Boolean(frame.narration.audio);
  const audioReady = hasAudioRef && app.availableAudio.has(frame.narration.audio);

  if (hasLines) {
    app.textTimeline = buildTextTimeline(
      frame.narration.lines,
      app.els.narrationLayer,
      prefersReducedMotion(),
    );
  } else {
    app.textTimeline = null;
  }

  if (hasCaptions) {
    app.els.accessibleNarration.textContent = frame.narration.captions.map((c) => c.text).join(' ');
    if (areCaptionsEnabled()) {
      showCaptions(frame.narration.captions, app.els.captionLayer);
    }
  } else {
    app.els.accessibleNarration.textContent = '';
  }

  app.els.btnReplay.disabled = !(hasLines || hasAudioRef);

  if (audioReady) {
    scheduleNarrationAudio(app, frame.narration);
  }
}

function applyAmbient(app, frame) {
  if (!frame.ambient) return;

  if (app.currentIndex === 0) {
    playAmbient(frame.ambient.src, frame.ambient.volume, frame.ambient.loop);
  } else {
    crossfadeAmbient(frame.ambient.src, frame.ambient.volume, 800);
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
  app.els.sceneImage.alt = frame.description || '';
  if (frame.image) {
    app.els.sceneImage.src = frame.image;
  } else {
    app.els.sceneImage.removeAttribute('src');
  }
  app.els.traceOverlay.style.opacity = frame.traceOverlay?.opacity ?? 0;

  clearEffects(app.els.effectsLayer);
  clearNarrationLayer(app.els.narrationLayer);

  if (frame.effects?.idle) {
    runEffect(frame.effects.idle, app.els.effectsLayer);
  }

  const sceneIdx = app.sceneMap.byFrame.get(index);
  if (sceneIdx !== undefined) {
    updateProgress(sceneIdx);
  }

  updateNavButtons(app);
  applyNarration(app, frame);
  applyAmbient(app, frame);

  if (frame.phases) {
    startPhase(app, frame, 0);
  }
}

function startPhase(app, frame, pi) {
  const phase = frame.phases[pi];
  if (!phase) return;

  clearNarrationLayer(app.els.narrationLayer);

  if (phase.narration?.lines?.length > 0) {
    app.textTimeline = buildTextTimeline(
      phase.narration.lines,
      app.els.narrationLayer,
      prefersReducedMotion(),
    );
    app.els.accessibleNarration.textContent = phase.narration.lines.map((l) => l.text).join(' ');

    if (phase.narration.audio && app.availableAudio.has(phase.narration.audio)) {
      playNarration(phase.narration.audio);
    }
  }

  if (phase.ambient) {
    crossfadeAmbient(phase.ambient.src, phase.ambient.volume, 600);
  }

  if (phase.duration && pi < frame.phases.length - 1) {
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

function transition(app, toIndex) {
  if (app.state === State.TRANSITIONING) return;

  if (app.paused) {
    clearPauseState(app);
    resumeNarration();
    resumeAmbient();
  }

  app.state = State.TRANSITIONING;

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

  clearCaptions();
  app.textTimeline = null;

  const toFrame = app.frames[toIndex];
  const hasNarrationAudio = Boolean(toFrame.narration?.audio);
  if (!hasNarrationAudio) {
    stopNarration();
  }

  if (prefersReducedMotion()) {
    try {
      app.currentIndex = toIndex;
      showFrame(app, toIndex);
    } catch (err) {
      console.error('Error during scene transition:', err);
    }
    app.state = STATE_BY_FRAME_TYPE[toFrame.frameType] || State.SCENE_ACTIVE;
    return;
  }

  const transitionConfig = toFrame.transition || scenesData.meta.defaultTransition;
  const halfDuration = transitionConfig.duration / 2000;

  gsap.to(app.els.sceneStage, {
    opacity: 0,
    duration: halfDuration,
    ease: 'power2.inOut',
    onComplete: () => {
      try {
        app.currentIndex = toIndex;
        showFrame(app, toIndex);
      } catch (err) {
        console.error('Error during scene transition:', err);
        gsap.set(app.els.sceneStage, { opacity: 1 });
        app.state = STATE_BY_FRAME_TYPE[toFrame.frameType] || State.SCENE_ACTIVE;
        return;
      }

      gsap.to(app.els.sceneStage, {
        opacity: 1,
        duration: halfDuration,
        ease: 'power2.inOut',
        onComplete: () => {
          app.state = STATE_BY_FRAME_TYPE[toFrame.frameType] || State.SCENE_ACTIVE;
        },
      });
    },
  });
}

function advance(app) {
  if (app.state === State.TRANSITIONING || app.state === State.CREDITS) return;
  if (app.currentIndex >= app.frames.length - 1) return;

  app.userHasInteracted = true;
  transition(app, app.currentIndex + 1);
}

function retreat(app) {
  if (app.state === State.TRANSITIONING) return;
  if (app.currentIndex <= 0) return;

  app.userHasInteracted = true;
  transition(app, app.currentIndex - 1);
}

function triggerEffect(app) {
  if (prefersReducedMotion()) return;
  if (app.state === State.TRANSITIONING || app.state === State.CREDITS) return;
  const frame = app.frames[app.currentIndex];
  if (!frame.effects?.idle) return;
  clearEffects(app.els.effectsLayer);
  if (frame.effects.entry) runEffect(frame.effects.entry, app.els.effectsLayer);
  runEffect(frame.effects.idle, app.els.effectsLayer);
}

function updateNavButtons(app) {
  const frame = app.frames[app.currentIndex];
  app.els.btnPrev.disabled = app.currentIndex === 0;
  app.els.btnNext.disabled =
    app.currentIndex >= app.frames.length - 1 || frame.advanceMode === 'disabled';
}

function togglePause(app) {
  if (app.state === State.TRANSITIONING || app.state === State.LOADING) return;

  if (app.paused) {
    const firstPlay = !app.userHasInteracted;
    if (firstPlay) {
      app.userHasInteracted = true;
    }

    app.paused = false;
    app.state = app.pausedFromState;
    app.pausedFromState = null;

    resumeNarration();
    resumeAmbient();

    if (app.textTimeline) {
      app.textTimeline.resume();
    }

    const effectsTweens = gsap.getTweensOf(app.els.effectsLayer);
    const childTweens = gsap.getTweensOf(app.els.effectsLayer.children);
    [...effectsTweens, ...childTweens].forEach((tw) => tw.resume());

    resumeCaptions();

    if (app.narrationTimerRemaining > 0) {
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

    if (app.phaseTimerRemaining > 0) {
      const frame = app.frames[app.currentIndex];
      const pi = app.pausedPhaseIndex;
      app.phaseTimer = setTimeout(() => startPhase(app, frame, pi + 1), app.phaseTimerRemaining);
      app.phaseTimerRemaining = null;
      app.pausedPhaseIndex = null;
    }

    if (firstPlay) {
      const frame = app.frames[app.currentIndex];
      if (app.textTimeline) {
        app.textTimeline.restart();
      }
      if (frame.narration?.audio && app.availableAudio.has(frame.narration.audio)) {
        scheduleNarrationAudio(app, frame.narration);
      }
      if (areCaptionsEnabled() && frame.narration?.captions?.length > 0) {
        showCaptions(frame.narration.captions, app.els.captionLayer);
      }
    }

    app.els.btnPause.setAttribute('aria-pressed', 'false');
    app.els.btnPause.classList.remove('paused');
  } else {
    app.paused = true;
    app.pausedFromState = app.state;
    app.state = State.PAUSED;

    pauseNarration();
    pauseAmbient();

    if (app.textTimeline) {
      app.textTimeline.pause();
    }

    const effectsTweens = gsap.getTweensOf(app.els.effectsLayer);
    const childTweens = gsap.getTweensOf(app.els.effectsLayer.children);
    [...effectsTweens, ...childTweens].forEach((tw) => tw.pause());

    pauseCaptions();

    if (app.narrationTimer) {
      const elapsed = Date.now() - app.narrationTimerStart;
      app.narrationTimerRemaining = Math.max(0, app.narrationTimerDelay - elapsed);
      clearTimeout(app.narrationTimer);
      app.narrationTimer = null;
      app.narrationTimerStart = null;
      app.narrationTimerDelay = null;
    }

    if (app.phaseTimer) {
      clearTimeout(app.phaseTimer);
      app.phaseTimer = null;
    }

    app.els.btnPause.setAttribute('aria-pressed', 'true');
    app.els.btnPause.classList.add('paused');
  }
}

function replayNarration(app) {
  if (app.state === State.TRANSITIONING || app.state === State.LOADING) return;

  app.userHasInteracted = true;

  if (app.paused) {
    clearPauseState(app);
    resumeNarration();
    resumeAmbient();
    app.state = app.pausedFromState || State.SCENE_ACTIVE;
  }

  const frame = app.frames[app.currentIndex];

  if (app.narrationTimer) {
    clearTimeout(app.narrationTimer);
    app.narrationTimer = null;
    app.narrationTimerStart = null;
    app.narrationTimerDelay = null;
  }
  app.narrationTimerRemaining = null;

  clearNarrationLayer(app.els.narrationLayer);
  clearCaptions();

  if (!frame.narration) return;

  const hasLines = Array.isArray(frame.narration.lines) && frame.narration.lines.length > 0;
  const hasCaptions =
    Array.isArray(frame.narration.captions) && frame.narration.captions.length > 0;
  const hasAudioRef = Boolean(frame.narration.audio);
  const audioReady = hasAudioRef && app.availableAudio.has(frame.narration.audio);

  if (hasLines) {
    app.textTimeline = buildTextTimeline(
      frame.narration.lines,
      app.els.narrationLayer,
      prefersReducedMotion(),
    );
  }

  if (hasCaptions && areCaptionsEnabled()) {
    showCaptions(frame.narration.captions, app.els.captionLayer);
  }

  if (audioReady) {
    playNarration(frame.narration.audio);
  }

  if (frame.effects?.entry) {
    runEffect(frame.effects.entry, app.els.effectsLayer);
  }
}

function handleKeydown(app, e) {
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    app.userHasInteracted = true;
    retreat(app);
  } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
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

  if (!app.userHasInteracted) return;

  if (enabled) {
    const frame = app.frames[app.currentIndex];
    const hasCaptions =
      Array.isArray(frame.narration?.captions) && frame.narration.captions.length > 0;
    if (hasCaptions) {
      showCaptions(frame.narration.captions, app.els.captionLayer);
    }
  } else {
    clearCaptions();
  }
}

function initApp(app) {
  app.els.sceneImage.addEventListener('error', () => {
    app.els.sceneImage.removeAttribute('src');
  });

  preloadAssets(app)
    .then(() => {
      app.els.loadingScreen.hidden = true;
      app.els.sceneStage.hidden = false;
      showControls();

      if (app.availableAudio.size > 0) {
        app.els.btnMute.removeAttribute('aria-disabled');
      }

      const captionsEnabled = initCaptions(app.els.captionLayer);
      app.els.btnCaptions.setAttribute('aria-pressed', String(captionsEnabled));

      showFrame(app, 0);

      // Start awaiting first play — text animates silently as a visual hook,
      // but audio and captions are gated until user presses play.
      app.paused = true;
      app.pausedFromState = State.SCENE_ACTIVE;
      app.state = State.PAUSED;
      clearCaptions();
      app.els.btnPause.setAttribute('aria-pressed', 'true');
      app.els.btnPause.classList.add('paused');

      // Defer background preloads to avoid network contention during initial render.
      // Ensures GSAP text animation and LCP complete before loading remaining assets.
      setTimeout(() => {
        preloadRemainingImages(app);
        preloadAudioInBackground(app);
      }, 4000);

      const markInteracted = () => {
        app.userHasInteracted = true;
      };

      document.addEventListener('click', (e) => {
        markInteracted();
        if (e.target.closest('#overlay-controls')) return;
        triggerEffect(app);
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
    'scene-image',
    'trace-overlay',
    'effects-layer',
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
    phaseTimerRemaining: null,
    pausedPhaseIndex: null,
    narrationTimer: null,
    narrationTimerStart: null,
    narrationTimerDelay: null,
    narrationTimerRemaining: null,
    availableAudio: new Set(),
    els: {
      loadingScreen: document.getElementById('loading-screen'),
      sceneStage: document.getElementById('scene-stage'),
      sceneImage: document.getElementById('scene-image'),
      traceOverlay: document.getElementById('trace-overlay'),
      effectsLayer: document.getElementById('effects-layer'),
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
