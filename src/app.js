import { gsap } from 'gsap';
import scenesData from './scenes.json';
import { playAmbient, crossfadeAmbient, playNarration, setMuted } from './audio.js';
import { buildTextTimeline, clearNarrationLayer } from './text.js';
import { runEffect, clearEffects, effectExists } from './effects.js';
import { initOverlay, updateProgress, showControls } from './overlay.js';

const State = Object.freeze({
  LOADING: 'LOADING',
  SCENE_ACTIVE: 'SCENE_ACTIVE',
  TRANSITIONING: 'TRANSITIONING',
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

function preloadAssets(app) {
  const imagePromises = app.frames
    .filter((frame) => frame.image)
    .map((frame) => preloadImage(frame.image));
  const audioPromises = [...collectAudioSrcs(app.frames)].map((src) =>
    preloadAudio(src).then((loaded) => {
      if (loaded) app.availableAudio.add(loaded);
    }),
  );
  return Promise.all([...imagePromises, ...audioPromises]);
}

function scheduleNarrationAudio(app, narration) {
  const delay = narration.delay || 0;
  if (delay > 0) {
    app.narrationTimer = setTimeout(() => {
      app.narrationTimer = null;
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
  }

  if (!frame.narration) {
    app.els.accessibleNarration.textContent = '';
    app.els.btnReplay.disabled = true;
    return;
  }

  const hasLines = Array.isArray(frame.narration.lines) && frame.narration.lines.length > 0;
  const hasAudioRef = Boolean(frame.narration.audio);
  const audioReady = hasAudioRef && app.availableAudio.has(frame.narration.audio);

  if (hasLines) {
    buildTextTimeline(frame.narration.lines, app.els.narrationLayer, prefersReducedMotion());
    app.els.accessibleNarration.textContent = frame.narration.lines.map((l) => l.text).join(' ');
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
    buildTextTimeline(phase.narration.lines, app.els.narrationLayer, prefersReducedMotion());
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

function transition(app, toIndex) {
  if (app.state === State.TRANSITIONING) return;
  app.state = State.TRANSITIONING;

  if (app.phaseTimer) {
    clearTimeout(app.phaseTimer);
    app.phaseTimer = null;
  }

  if (app.narrationTimer) {
    clearTimeout(app.narrationTimer);
    app.narrationTimer = null;
  }

  const toFrame = app.frames[toIndex];

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

  transition(app, app.currentIndex + 1);
}

function retreat(app) {
  if (app.state === State.TRANSITIONING) return;
  if (app.currentIndex <= 0) return;

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

function handleKeydown(app, e) {
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    retreat(app);
  } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    advance(app);
  }
}

function toggleMute(app) {
  app.muted = !app.muted;
  setMuted(app.muted);
  app.els.btnMute.classList.toggle('muted', app.muted);
  app.els.btnMute.setAttribute('aria-label', app.muted ? 'Unmute audio' : 'Mute audio');
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

      showFrame(app, 0);
      app.state = State.SCENE_ACTIVE;

      document.addEventListener('click', (e) => {
        if (e.target.closest('#overlay-controls')) return;
        triggerEffect(app);
      });
      document.addEventListener('keydown', (e) => handleKeydown(app, e));
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
        applyNarration(app, app.frames[app.currentIndex]);
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
    'accessible-narration',
    'overlay-controls',
    'progress-dots',
    'btn-prev',
    'btn-next',
    'btn-replay',
    'btn-mute',
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
    phaseTimer: null,
    narrationTimer: null,
    availableAudio: new Set(),
    els: {
      loadingScreen: document.getElementById('loading-screen'),
      sceneStage: document.getElementById('scene-stage'),
      sceneImage: document.getElementById('scene-image'),
      traceOverlay: document.getElementById('trace-overlay'),
      effectsLayer: document.getElementById('effects-layer'),
      narrationLayer: document.getElementById('narration-layer'),
      accessibleNarration: document.getElementById('accessible-narration'),
      controls: document.getElementById('overlay-controls'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnReplay: document.getElementById('btn-replay'),
      btnMute: document.getElementById('btn-mute'),
    },
  };

  initOverlay(app.sceneMap.byFrame.size, (sceneIndex) => {
    const frameIndex = app.sceneMap.byScene.get(sceneIndex);
    if (frameIndex !== undefined && frameIndex !== app.currentIndex) {
      transition(app, frameIndex);
    }
  });

  initApp(app);

  return {
    advance: () => advance(app),
    toggleMute: () => toggleMute(app),
    getState: () => app.state,
  };
}
