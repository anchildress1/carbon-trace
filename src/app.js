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

function collectAudioSrcs(frames) {
  const srcs = new Set();
  for (const frame of frames) {
    if (frame.ambient?.src) srcs.add(frame.ambient.src);
    if (frame.narration?.audio) srcs.add(frame.narration.audio);
    if (frame.phases) {
      for (const phase of frame.phases) {
        if (phase.ambient?.src) srcs.add(phase.ambient.src);
        if (phase.narration?.audio) srcs.add(phase.narration.audio);
      }
    }
  }
  return srcs;
}

export function createApp() {
  const frames = scenesData.frames;
  let currentIndex = 0;
  let state = State.LOADING;
  let muted = false;
  let phaseTimer = null;

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

  const els = {
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
  };

  const narrativeSceneCount = frames.filter((f) => f.frameType === 'scene').length;
  initOverlay(narrativeSceneCount);

  function preloadAssets() {
    const imagePromises = frames.map((frame) => preloadImage(frame.image));
    const audioPromises = [...collectAudioSrcs(frames)].map(preloadAudio);
    return Promise.all([...imagePromises, ...audioPromises]);
  }

  function applyNarration(frame) {
    if (!frame.narration) {
      els.accessibleNarration.textContent = '';
      els.btnReplay.hidden = true;
      return;
    }

    const hasLines = Array.isArray(frame.narration.lines) && frame.narration.lines.length > 0;

    if (hasLines) {
      buildTextTimeline(frame.narration.lines, els.narrationLayer, prefersReducedMotion());
      els.accessibleNarration.textContent = frame.narration.lines.map((l) => l.text).join(' ');
    } else {
      els.accessibleNarration.textContent = '';
    }

    if (frame.narration.audio) {
      els.btnReplay.hidden = false;
      const delay = frame.narration.delay || 0;
      setTimeout(() => playNarration(frame.narration.audio), delay);
    } else {
      els.btnReplay.hidden = true;
    }
  }

  function applyAmbient(frame) {
    if (!frame.ambient) return;

    if (currentIndex === 0) {
      playAmbient(frame.ambient.src, frame.ambient.volume, frame.ambient.loop);
    } else {
      crossfadeAmbient(frame.ambient.src, frame.ambient.volume, 800);
    }
  }

  function showFrame(index) {
    if (phaseTimer) {
      clearTimeout(phaseTimer);
      phaseTimer = null;
    }

    const frame = frames[index];
    els.sceneImage.src = frame.image;
    els.sceneImage.alt = `Scene: ${frame.id}`;
    els.traceOverlay.style.opacity = frame.traceOverlay?.opacity ?? 0;

    clearEffects(els.effectsLayer);
    clearNarrationLayer(els.narrationLayer);

    if (frame.effects?.idle) {
      runEffect(frame.effects.idle, els.effectsLayer);
    }

    if (frame.frameType === 'scene') {
      const sceneIndex = frames.slice(0, index + 1).filter((f) => f.frameType === 'scene').length;
      updateProgress(sceneIndex);
    }

    applyNarration(frame);
    applyAmbient(frame);

    if (frame.phases) {
      runPhases(frame);
    }
  }

  function runPhases(frame) {
    let phaseIndex = 0;

    function startPhase(pi) {
      const phase = frame.phases[pi];
      if (!phase) return;

      clearNarrationLayer(els.narrationLayer);

      if (phase.narration?.lines?.length > 0) {
        buildTextTimeline(phase.narration.lines, els.narrationLayer, prefersReducedMotion());
        els.accessibleNarration.textContent = phase.narration.lines.map((l) => l.text).join(' ');

        if (phase.narration.audio) {
          playNarration(phase.narration.audio);
        }
      }

      if (phase.ambient) {
        crossfadeAmbient(phase.ambient.src, phase.ambient.volume, 600);
      }

      if (phase.duration && pi < frame.phases.length - 1) {
        phaseTimer = setTimeout(() => {
          phaseIndex++;
          startPhase(phaseIndex);
        }, phase.duration);
      }
    }

    startPhase(phaseIndex);
  }

  function transition(fromIndex, toIndex) {
    if (state === State.TRANSITIONING) return;
    state = State.TRANSITIONING;

    if (phaseTimer) {
      clearTimeout(phaseTimer);
      phaseTimer = null;
    }

    const toFrame = frames[toIndex];
    const transitionConfig = toFrame.transition || scenesData.meta.defaultTransition;

    function resolveState() {
      if (toFrame.frameType === 'credits') {
        state = State.CREDITS;
      } else if (toFrame.frameType === 'title') {
        state = State.TITLE;
      } else {
        state = State.SCENE_ACTIVE;
      }
    }

    gsap.to(els.sceneStage, {
      opacity: 0,
      duration: transitionConfig.duration / 2000,
      ease: 'power2.inOut',
      onComplete: () => {
        try {
          currentIndex = toIndex;
          showFrame(toIndex);
        } catch (err) {
          console.error('Error during scene transition:', err);
          resolveState();
          return;
        }

        gsap.to(els.sceneStage, {
          opacity: 1,
          duration: transitionConfig.duration / 2000,
          ease: 'power2.inOut',
          onComplete: resolveState,
        });
      },
    });
  }

  function advance() {
    if (state === State.TRANSITIONING || state === State.CREDITS) return;
    if (currentIndex >= frames.length - 1) return;

    transition(currentIndex, currentIndex + 1);
  }

  function handleInput(e) {
    if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
    if (e.type === 'keydown') e.preventDefault();

    advance();
  }

  function toggleMute() {
    muted = !muted;
    setMuted(muted);
    const icon = els.btnMute.querySelector('span');
    if (icon) {
      icon.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    }
    els.btnMute.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
  }

  function init() {
    preloadAssets()
      .then(() => {
        els.loadingScreen.hidden = true;
        els.sceneStage.hidden = false;
        showControls();

        showFrame(0);
        state = State.TITLE;

        document.addEventListener('click', handleInput);
        document.addEventListener('keydown', handleInput);
        els.btnMute.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleMute();
        });
        els.btnReplay.addEventListener('click', (e) => {
          e.stopPropagation();
          const frame = frames[currentIndex];
          if (frame.narration?.audio) {
            playNarration(frame.narration.audio);
          }
        });
      })
      .catch((err) => {
        console.error('Failed to initialize:', err);
        els.loadingScreen.textContent = 'Something went wrong. Please refresh.';
      });
  }

  init();

  return { advance, toggleMute, getState: () => state };
}
