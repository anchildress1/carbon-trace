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
  onNarrationBufferChange,
  preloadNarrationAhead,
  clearNarrationCache,
  playMusic,
  fadeMusic,
  pauseMusic,
  resumeMusic,
  stopMusic,
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
    audio.preload = 'metadata';

    const timeout = setTimeout(() => {
      console.warn(`Audio preload timed out: ${src}`);
      resolve(null);
    }, 5000);

    audio.onloadedmetadata = () => {
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
  return [entry.ambient?.src, entry.narration?.audio, entry.music?.src].filter(Boolean);
}

function registerAudio(app, loaded) {
  if (loaded) {
    app.availableAudio.add(loaded);
    if (app.availableAudio.size === 1) {
      app.els.btnMute.removeAttribute('aria-disabled');
    }
  }
}

function preloadFirstFrameAudio(app) {
  const srcs = audioSrcsFromEntry(app.frames[0]);
  for (const src of srcs) {
    preloadAudio(src)
      .then((loaded) => registerAudio(app, loaded))
      .catch((err) => console.warn('First frame audio preload failed:', err));
  }
}

async function preloadBackgroundAssets(app) {
  const firstFrameSrcs = new Set(audioSrcsFromEntry(app.frames[0]));

  for (const frame of app.frames.slice(1)) {
    if (frame.image) await preloadImage(frame.image);
    for (const src of audioSrcsFromEntry(frame)) {
      if (!firstFrameSrcs.has(src)) {
        const loaded = await preloadAudio(src);
        registerAudio(app, loaded);
      }
    }
  }
}

function preloadAssets(app) {
  const firstFrame = app.frames[0];
  return firstFrame?.image ? preloadImage(firstFrame.image) : Promise.resolve();
}

function clearMusicTimer(app) {
  if (app.musicTimer) {
    clearTimeout(app.musicTimer);
    app.musicTimer = null;
    app.musicTimerStart = null;
    app.musicTimerDelay = null;
  }
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

function scheduleCaptionDisplay(app, frame) {
  const captionDelay = frame.narration.delay || 0;
  if (captionDelay > 0) {
    setTimeout(() => {
      if (app.frames[app.currentIndex] === frame && !app.paused) {
        showCaptions(frame.narration.captions, app.els.captionLayer);
      }
    }, captionDelay);
  } else {
    showCaptions(frame.narration.captions, app.els.captionLayer);
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
      scheduleCaptionDisplay(app, frame);
    }
  } else {
    app.els.accessibleNarration.textContent = '';
  }

  app.els.btnReplay.disabled = !(hasLines || hasAudioRef);

  if (frame.music) {
    scheduleMusic(app, frame.music);
  }

  if (hasAudioRef) {
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

  // Pre-buffer next scene's narration audio while current scene plays
  clearNarrationCache();
  const nextFrame = app.frames[index + 1];
  if (nextFrame?.narration?.audio) {
    preloadNarrationAhead(nextFrame.narration.audio);
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
      pauseCaptions();
    }
    app.els.sceneStage.classList.add('buffering');
  } else {
    if (!app.paused) {
      if (app.textTimeline) app.textTimeline.resume();
      resumeCaptions();
    }
    app.els.sceneStage.classList.remove('buffering');
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
  app.buffering = false;
  app.els.sceneStage.classList.remove('buffering');

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

  clearMusicTimer(app);
  if (app.musicExitTimer) {
    clearTimeout(app.musicExitTimer);
    app.musicExitTimer = null;
    app.musicExitTimerStart = null;
    app.musicExitTimerDelay = null;
  }
  app.musicExitTimerRemaining = null;
  stopMusic();

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

function resumeDelayedNarration(app) {
  if (app.narrationTimerRemaining <= 0) return;
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
  if (app.musicTimerRemaining <= 0) return;
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
  if (app.phaseTimerRemaining <= 0) return;
  const frame = app.frames[app.currentIndex];
  const pi = app.pausedPhaseIndex;
  app.phaseTimer = setTimeout(() => startPhase(app, frame, pi + 1), app.phaseTimerRemaining);
  app.phaseTimerRemaining = null;
  app.pausedPhaseIndex = null;
}

function handleFirstPlay(app) {
  const frame = app.frames[app.currentIndex];
  if (app.textTimeline) {
    app.textTimeline.restart();
  }
  if (frame.music) {
    scheduleMusic(app, frame.music);
  }
  if (frame.narration?.audio) {
    scheduleNarrationAudio(app, frame.narration);
  }
  if (areCaptionsEnabled() && frame.narration?.captions?.length > 0) {
    showCaptions(frame.narration.captions, app.els.captionLayer);
  }
}

function resumeEffects(app) {
  const effectsTweens = gsap.getTweensOf(app.els.effectsLayer);
  const childTweens = gsap.getTweensOf(app.els.effectsLayer.children);
  [...effectsTweens, ...childTweens].forEach((tw) => tw.resume());
}

function pauseEffects(app) {
  const effectsTweens = gsap.getTweensOf(app.els.effectsLayer);
  const childTweens = gsap.getTweensOf(app.els.effectsLayer.children);
  [...effectsTweens, ...childTweens].forEach((tw) => tw.pause());
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

  resumeEffects(app);

  if (!app.buffering) {
    if (areCaptionsEnabled()) {
      resumeCaptions();
    } else {
      clearCaptions();
    }
  }

  resumeDelayedNarration(app);
  resumeDelayedMusic(app);
  resumeDelayedPhase(app);
  resumeMusicExitTimer(app);

  if (firstPlay) {
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

  pauseEffects(app);
  pauseCaptions();

  saveNarrationTimerRemaining(app);
  saveMusicTimerRemaining(app);

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
  if (app.state === State.TRANSITIONING || app.state === State.LOADING) return;

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

  if (frame.music) {
    scheduleMusic(app, frame.music);
  }

  if (hasAudioRef) {
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

  if (app.paused) return;

  if (enabled) {
    const frame = app.frames[app.currentIndex];
    const hasCaptions =
      Array.isArray(frame.narration?.captions) && frame.narration.captions.length > 0;
    if (hasCaptions) {
      const offsetMs = app.textTimeline ? app.textTimeline.time() * 1000 : 0;
      showCaptions(frame.narration.captions, app.els.captionLayer, offsetMs);
    }
  } else {
    clearCaptions();
  }
}

function initApp(app) {
  app.els.sceneImage.addEventListener('error', () => {
    app.els.sceneImage.removeAttribute('src');
  });

  preloadFirstFrameAudio(app);
  onNarrationBufferChange((isBuffering) => handleBufferChange(app, isBuffering));

  preloadAssets(app)
    .then(() => {
      app.els.loadingScreen.hidden = true;
      app.els.sceneStage.hidden = false;
      showControls();

      if (app.availableAudio.size > 0) {
        app.els.btnMute.removeAttribute('aria-disabled');
      }

      const captionsEnabled = initCaptions();
      app.els.btnCaptions.setAttribute('aria-pressed', String(captionsEnabled));

      showFrame(app, 0);

      // Start paused — everything waits for the user to press play.
      // Seek the text timeline past the first line's entrance animation
      // so it's visible as a static title card (also provides an LCP
      // element for Lighthouse). On play, textTimeline.restart() replays
      // from t=0 with the full ghost-drift entrance.
      stopNarration();
      clearCaptions();
      app.paused = true;
      app.pausedFromState = State.SCENE_ACTIVE;
      app.state = State.PAUSED;
      if (app.textTimeline) {
        const firstLine = app.frames[0].narration?.lines?.[0];
        const seekTime = firstLine ? firstLine.enter / 1000 + 1.3 : 0;
        app.textTimeline.seek(seekTime);
        app.textTimeline.pause();
      }
      app.els.btnPause.setAttribute('aria-pressed', 'true');
      app.els.btnPause.classList.add('paused');

      // Defer background asset preloads to avoid network contention.
      // Loads sequentially: each scene's image then audio, in order.
      setTimeout(() => {
        preloadBackgroundAssets(app).catch((err) =>
          console.warn('Background asset preload failed:', err),
        );
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
    phaseTimerStart: null,
    phaseTimerDelay: null,
    phaseTimerRemaining: null,
    pausedPhaseIndex: null,
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
    buffering: false,
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
