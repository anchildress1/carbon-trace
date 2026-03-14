import { gsap } from 'gsap';
import scenesData from './scenes.json';
import { playAmbient, crossfadeAmbient, playNarration, setMuted } from './audio.js';
import { buildTextTimeline, clearNarrationLayer } from './text.js';
import { runEffect, clearEffects } from './effects.js';
import { initOverlay, updateProgress, showControls } from './overlay.js';

const State = Object.freeze({
  LOADING: 'LOADING',
  TITLE: 'TITLE',
  SCENE_ACTIVE: 'SCENE_ACTIVE',
  TRANSITIONING: 'TRANSITIONING',
  CREDITS: 'CREDITS',
});

const STATE_BY_FRAME_TYPE = {
  credits: State.CREDITS,
  title: State.TITLE,
};

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
    audio.oncanplaythrough = resolve;
    audio.onerror = () => {
      console.warn(`Failed to preload audio: ${src}`);
      resolve();
    };
    audio.src = src;
  });
}

function audioSrcsFromEntry(entry) {
  const srcs = [];
  if (entry.ambient?.src) srcs.push(entry.ambient.src);
  if (entry.narration?.audio) srcs.push(entry.narration.audio);
  return srcs;
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
  const imagePromises = app.frames.map((frame) => preloadImage(frame.image));
  const audioPromises = [...collectAudioSrcs(app.frames)].map(preloadAudio);
  return Promise.all([...imagePromises, ...audioPromises]);
}

function applyNarration(app, frame) {
  if (!frame.narration) {
    app.els.accessibleNarration.textContent = '';
    app.els.btnReplay.hidden = true;
    return;
  }

  const hasLines = Array.isArray(frame.narration.lines) && frame.narration.lines.length > 0;

  if (hasLines) {
    buildTextTimeline(frame.narration.lines, app.els.narrationLayer, prefersReducedMotion());
    app.els.accessibleNarration.textContent = frame.narration.lines.map((l) => l.text).join(' ');
  } else {
    app.els.accessibleNarration.textContent = '';
  }

  if (frame.narration.audio) {
    app.els.btnReplay.hidden = false;
    const delay = frame.narration.delay || 0;
    setTimeout(() => playNarration(frame.narration.audio), delay);
  } else {
    if (document.activeElement === app.els.btnReplay) {
      app.els.btnMute.focus();
    }
    app.els.btnReplay.hidden = true;
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

function showFrame(app, index) {
  if (app.phaseTimer) {
    clearTimeout(app.phaseTimer);
    app.phaseTimer = null;
  }

  const frame = app.frames[index];
  app.els.sceneImage.src = frame.image;
  app.els.sceneImage.alt = frame.description || '';
  app.els.traceOverlay.style.opacity = frame.traceOverlay?.opacity ?? 0;

  clearEffects(app.els.effectsLayer);
  clearNarrationLayer(app.els.narrationLayer);

  if (frame.effects?.idle) {
    runEffect(frame.effects.idle, app.els.effectsLayer);
  }

  if (frame.frameType === 'scene') {
    const sceneIndex = app.frames.slice(0, index + 1).filter((f) => f.frameType === 'scene').length;
    updateProgress(sceneIndex);
  }

  applyNarration(app, frame);
  applyAmbient(app, frame);

  if (frame.phases) {
    runPhases(app, frame);
  }
}

function startPhase(app, frame, pi) {
  const phase = frame.phases[pi];
  if (!phase) return;

  clearNarrationLayer(app.els.narrationLayer);

  if (phase.narration?.lines?.length > 0) {
    buildTextTimeline(phase.narration.lines, app.els.narrationLayer, prefersReducedMotion());
    app.els.accessibleNarration.textContent = phase.narration.lines.map((l) => l.text).join(' ');

    if (phase.narration.audio) {
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

function runPhases(app, frame) {
  startPhase(app, frame, 0);
}

function transition(app, toIndex) {
  if (app.state === State.TRANSITIONING) return;
  app.state = State.TRANSITIONING;

  if (app.phaseTimer) {
    clearTimeout(app.phaseTimer);
    app.phaseTimer = null;
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

function handleInput(app, e) {
  if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
  if (e.type === 'keydown') e.preventDefault();

  advance(app);
}

function toggleMute(app) {
  app.muted = !app.muted;
  setMuted(app.muted);
  const icon = app.els.btnMute.querySelector('span');
  if (icon) {
    icon.textContent = app.muted ? '\u{1F507}' : '\u{1F50A}';
  }
  app.els.btnMute.setAttribute('aria-label', app.muted ? 'Unmute audio' : 'Mute audio');
}

function initApp(app) {
  preloadAssets(app)
    .then(() => {
      app.els.loadingScreen.hidden = true;
      app.els.sceneStage.hidden = false;
      showControls();

      showFrame(app, 0);
      app.state = State.TITLE;

      document.addEventListener('click', (e) => handleInput(app, e));
      document.addEventListener('keydown', (e) => handleInput(app, e));
      app.els.btnMute.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMute(app);
      });
      app.els.btnReplay.addEventListener('click', (e) => {
        e.stopPropagation();
        const frame = app.frames[app.currentIndex];
        if (frame.narration?.audio) {
          playNarration(frame.narration.audio);
        }
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
    'btn-replay',
    'btn-mute',
  ];

  for (const id of requiredIds) {
    if (!document.getElementById(id)) {
      throw new Error(`Required element #${id} not found in DOM`);
    }
  }

  const app = {
    frames: scenesData.frames,
    currentIndex: 0,
    state: State.LOADING,
    muted: false,
    phaseTimer: null,
    els: {
      loadingScreen: document.getElementById('loading-screen'),
      sceneStage: document.getElementById('scene-stage'),
      sceneImage: document.getElementById('scene-image'),
      traceOverlay: document.getElementById('trace-overlay'),
      effectsLayer: document.getElementById('effects-layer'),
      narrationLayer: document.getElementById('narration-layer'),
      accessibleNarration: document.getElementById('accessible-narration'),
      controls: document.getElementById('overlay-controls'),
      btnReplay: document.getElementById('btn-replay'),
      btnMute: document.getElementById('btn-mute'),
    },
  };

  const narrativeSceneCount = app.frames.filter((f) => f.frameType === 'scene').length;
  initOverlay(narrativeSceneCount);

  initApp(app);

  return {
    advance: () => advance(app),
    toggleMute: () => toggleMute(app),
    getState: () => app.state,
  };
}
