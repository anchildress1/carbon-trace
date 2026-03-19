import { Howl } from 'howler';
import { PausableTimer } from './pausable-timer.js';

// --- Global state ---

let globalMuted = false;

// Dynamic cue tracking — no hardcoded timer variables (ADR-005)
const activeCues = new Map(); // Map<cueId, { howl, timer, type, state }>

let isAudioPaused = false;

// Buffer monitoring state
let bufferChangeCallback = null;
let narrationBuffering = false;
let bufferCheckTimer = null;
let bufferEventCleanup = null;

// Ahead-of-time narration cache
const narrationCache = new Map();

// --- Buffer monitoring ---

export function onNarrationBufferChange(cb) {
  bufferChangeCallback = cb;
}

export function isNarrationBuffering() {
  return narrationBuffering;
}

function getBufferedEnd(node) {
  if (!node.buffered || node.buffered.length === 0) return 0;
  return node.buffered.end(node.buffered.length - 1);
}

function cleanupBufferMonitoring() {
  if (bufferCheckTimer) {
    clearInterval(bufferCheckTimer);
    bufferCheckTimer = null;
  }
  if (bufferEventCleanup) {
    bufferEventCleanup();
    bufferEventCleanup = null;
  }
  if (narrationBuffering) {
    narrationBuffering = false;
    bufferChangeCallback?.(false);
  }
}

function nudgeStall(node) {
  const pos = node.currentTime;
  node.currentTime = pos;
}

function reloadFromPosition(node) {
  const time = node.currentTime;
  const src = node.src;
  node.src = '';
  node.src = src;
  node.currentTime = time;
  if (!isAudioPaused) {
    node.play().catch((err) => {
      console.warn('Buffer recovery play() failed:', err.message);
      cleanupBufferMonitoring();
    });
  }
}

function checkBufferProgress(node, state, onExhaustion) {
  if (!narrationBuffering) {
    clearInterval(bufferCheckTimer);
    bufferCheckTimer = null;
    return;
  }

  const currentEnd = getBufferedEnd(node);
  if (currentEnd > state.lastBufferedEnd) {
    state.lastBufferedEnd = currentEnd;
    state.stallChecks = 0;
    state.recoveryAttempts = 0;
    const ahead = currentEnd - node.currentTime;
    const nearEnd = node.duration > 0 && node.duration - node.currentTime < 3;
    if (ahead >= 3 || nearEnd) {
      if (!isAudioPaused) {
        node.play().catch((err) => {
          console.warn('Buffer recovery play() failed:', err.message);
          cleanupBufferMonitoring();
        });
      }
    }
  } else {
    state.stallChecks++;
    if (state.stallChecks === 2) {
      nudgeStall(node);
    } else if (state.stallChecks >= 4) {
      state.recoveryAttempts = (state.recoveryAttempts || 0) + 1;
      if (state.recoveryAttempts >= 3) {
        console.warn('Buffer recovery exhausted after 3 attempts');
        cleanupBufferMonitoring();
        onExhaustion?.();
        return;
      }
      reloadFromPosition(node);
      state.stallChecks = 0;
    }
  }
}

function handleWaiting(node, state, onExhaustion) {
  if (narrationBuffering) return;
  narrationBuffering = true;
  bufferChangeCallback?.(true);

  state.stallChecks = 0;
  state.lastBufferedEnd = getBufferedEnd(node);
  bufferCheckTimer = setInterval(() => checkBufferProgress(node, state, onExhaustion), 4000);
}

function handlePlaying() {
  if (!narrationBuffering) return;
  narrationBuffering = false;
  bufferChangeCallback?.(false);
  if (bufferCheckTimer) {
    clearInterval(bufferCheckTimer);
    bufferCheckTimer = null;
  }
}

function monitorNarrationBuffer(howl, opts) {
  const attachListeners = () => {
    const node = howl._sounds?.[0]?._node;
    if (!node || typeof node.addEventListener !== 'function') {
      console.warn('Cannot monitor narration buffer: audio node unavailable');
      return;
    }

    const state = { lastBufferedEnd: 0, stallChecks: 0, recoveryAttempts: 0 };

    const onWaiting = () => handleWaiting(node, state, opts?.onExhaustion);
    const onPlaying = () => handlePlaying();

    node.addEventListener('waiting', onWaiting);
    node.addEventListener('playing', onPlaying);

    bufferEventCleanup = () => {
      node.removeEventListener('waiting', onWaiting);
      node.removeEventListener('playing', onPlaying);
    };
  };

  if (howl._sounds?.[0]?._node) {
    attachListeners();
  } else {
    howl.once('play', attachListeners);
  }
}

// --- Preload cache ---

export function preloadNarrationAhead(src) {
  if (narrationCache.has(src)) return;

  const howl = new Howl({
    src: [src],
    html5: true,
    preload: true,
    volume: 1,
    mute: globalMuted,
    onloaderror: (_id, err) => {
      console.warn(`Failed to load narration cache: ${src}`, err);
      narrationCache.delete(src);
      queueMicrotask(() => howl.unload());
    },
  });
  narrationCache.set(src, howl);
}

export function clearNarrationCache() {
  for (const howl of narrationCache.values()) {
    howl.unload();
  }
  narrationCache.clear();
}

// --- Anchor resolution ---

function resolveAnchors(cues, opts) {
  const durations = new Map();

  if (opts?.audioDurations) {
    for (const cue of cues) {
      const metaDuration = opts.audioDurations.get(cue.src);
      if (metaDuration > 0) durations.set(cue.id, metaDuration * 1000);
    }
  }

  const narrationCue = cues.find((c) => c.type === 'narration');
  if (narrationCue && opts?.maxNarrationDurationMs) {
    durations.set(narrationCue.id, opts.maxNarrationDurationMs);
  }

  return cues.map((cue) => {
    if (typeof cue.enter === 'number') {
      return { ...cue, resolvedEnter: cue.enter };
    }
    const refDuration = durations.get(cue.enter.ref);
    if (refDuration === null || refDuration === undefined) {
      console.warn(`Anchor ref "${cue.enter.ref}" duration unknown — falling back to enter: 0`);
      return { ...cue, resolvedEnter: 0 };
    }
    const refCue = cues.find((c) => c.id === cue.enter.ref);
    const refEnter = typeof refCue?.enter === 'number' ? refCue.enter : 0;
    return { ...cue, resolvedEnter: refEnter + refDuration + cue.enter.offset };
  });
}

// --- Internal cue playback ---

function findActiveAmbient() {
  for (const [, entry] of activeCues) {
    if (entry.type === 'ambient' && entry.state === 'playing') return entry;
  }
  return null;
}

function removeEntryIfCurrent(entry) {
  if (!entry?.id) return;
  if (activeCues.get(entry.id) === entry) {
    activeCues.delete(entry.id);
  }
}

function playCue(cue) {
  let howl = null;

  if (cue.type === 'narration' && narrationCache.has(cue.src)) {
    howl = narrationCache.get(cue.src);
    narrationCache.delete(cue.src);
    howl.mute(globalMuted);
  } else {
    howl = new Howl({
      src: [cue.src],
      volume: cue.fadeIn > 0 ? 0 : cue.volume,
      loop: cue.loop,
      html5: true,
      mute: globalMuted,
    });
  }

  // Error handlers for non-narration cues (narration gets handlers via wireNarrationEnd)
  if (cue.type !== 'narration') {
    const handlePlayCueError = (label, _id, err) => {
      console.error(`Cue ${label} failed: ${cue.id} (${cue.src})`, err);
      const entry = activeCues.get(cue.id);
      if (entry && entry.howl === howl) {
        entry.howl = null;
        entry.state = 'error';
      }
    };
    howl.on('loaderror', (id, err) => handlePlayCueError('load', id, err));
    howl.on('playerror', (id, err) => handlePlayCueError('play', id, err));
  }

  howl.play();

  if (cue.fadeIn > 0) {
    howl.fade(0, cue.volume, cue.fadeIn);
  }

  return howl;
}

function crossfadeAmbientCue(cue, crossfadeDurationMs) {
  const oldEntry = findActiveAmbient();
  const oldHowl = oldEntry?.howl;
  const oldVolume = oldHowl?.volume() ?? 0;

  const newHowl = new Howl({
    src: [cue.src],
    volume: 0,
    loop: cue.loop,
    html5: true,
    mute: globalMuted,
  });

  let unloaded = false;
  let fadeOutTimerId = null;

  let cancelled = false;

  // Unload old ONLY after new confirms playback
  newHowl.once('play', () => {
    if (cancelled) return;
    if (oldHowl && !unloaded) {
      oldEntry.state = 'fading-out';
      oldHowl.fade(oldHowl.volume(), 0, crossfadeDurationMs);
      fadeOutTimerId = new PausableTimer(() => {
        fadeOutTimerId = null;
        oldHowl.unload();
        unloaded = true;
        removeEntryIfCurrent(oldEntry);
      }, crossfadeDurationMs + 100);
    }
  });

  const handleError = (label, _id, err) => {
    console.warn(`Ambient ${label} failed: ${cue.src}`, err);
    newHowl.unload();
    if (oldHowl && !unloaded) {
      oldEntry.state = 'playing';
      oldHowl.fade(oldHowl.volume(), oldVolume, 200);
    }
    // Mark the entry as failed so pauseAudioCues/resumeAudioCues skip it
    const entry = activeCues.get(cue.id);
    if (entry && entry.howl === newHowl) {
      entry.howl = null;
      entry.state = 'error';
    }
  };

  newHowl.on('loaderror', (id, err) => handleError('load', id, err));
  newHowl.on('playerror', (id, err) => handleError('play', id, err));

  // Store cleanup hook so cancelAudioCues can drain the deferred unload
  newHowl._crossfadeCleanup = () => {
    cancelled = true;
    if (fadeOutTimerId) {
      fadeOutTimerId.cancel();
      fadeOutTimerId = null;
    }
    if (oldHowl && !unloaded) {
      oldHowl.unload();
      unloaded = true;
      removeEntryIfCurrent(oldEntry);
    }
  };

  // Pause/resume hooks for fading-out old ambient during global pause
  newHowl._crossfadePause = () => {
    fadeOutTimerId?.pause();
    if (oldHowl && !unloaded) oldHowl.pause();
  };
  newHowl._crossfadeResume = () => {
    fadeOutTimerId?.resume();
    if (oldHowl && !unloaded) oldHowl.play();
  };

  newHowl.play();
  newHowl.fade(0, cue.volume, cue.fadeIn > 0 ? cue.fadeIn : crossfadeDurationMs);
  return newHowl;
}

function wireNarrationEnd(entry, cue, opts) {
  let ended = false;
  let safetyTimer = null;

  const safeEnd = () => {
    if (ended) return;
    ended = true;
    if (safetyTimer) safetyTimer.cancel();
    if (entry.timer === safetyTimer) entry.timer = null;
    cleanupBufferMonitoring();
    opts.onNarrationEnd?.();
  };

  entry.howl.once('end', safeEnd);
  entry.howl.on('loaderror', () => {
    entry.howl.unload();
    safeEnd();
  });
  entry.howl.on('playerror', () => {
    entry.howl?.unload();
    safeEnd();
  });

  if (opts.maxNarrationDurationMs > 0) {
    const enterDelay = cue.resolvedEnter || 0;
    safetyTimer = new PausableTimer(
      () => {
        console.warn(`Narration safety timeout: ${cue.src}`);
        entry.howl?.unload();
        safeEnd();
      },
      enterDelay + opts.maxNarrationDurationMs + 5000,
    );
    entry.timer = safetyTimer;
  }

  monitorNarrationBuffer(entry.howl, {
    onExhaustion: () => {
      console.warn(`Buffer recovery exhausted: ${cue.src} — forcing advance`);
      entry.howl?.unload();
      safeEnd();
    },
  });
}

// --- Public API (ADR-005) ---

export function scheduleAudioCues(cues, opts = {}) {
  if (!cues || cues.length === 0) return;

  const crossfadeDurationMs = opts.crossfadeDurationMs ?? 800;
  const resolved = resolveAnchors(cues, opts);

  for (const cue of resolved) {
    // Defensive: clean up any pre-existing entry with the same ID.
    // Skip for ambient→ambient: crossfadeAmbientCue handles the transition.
    const existing = activeCues.get(cue.id);
    if (existing && !(cue.type === 'ambient' && existing.type === 'ambient')) {
      existing.timer?.cancel();
      existing.howl?._crossfadeCleanup?.();
      existing.howl?.unload();
    }

    const entry = { id: cue.id, howl: null, timer: null, type: cue.type, state: 'pending' };

    const startCue = () => {
      entry.timer = null;
      try {
        if (cue.type === 'ambient') {
          entry.howl = crossfadeAmbientCue(cue, crossfadeDurationMs);
        } else {
          entry.howl = playCue(cue);
        }
        entry.state = 'playing';
      } catch (err) {
        console.error(`Failed to start cue ${cue.id}:`, err);
        entry.state = 'error';
        return;
      }

      if (cue.type === 'narration' && opts.onNarrationEnd) {
        wireNarrationEnd(entry, cue, opts);
      }
    };

    if (cue.resolvedEnter > 0) {
      entry.timer = new PausableTimer(startCue, cue.resolvedEnter);
      entry.state = 'scheduled';
    } else {
      startCue();
    }

    activeCues.set(cue.id, entry);
  }
}

export function cancelAudioCues() {
  for (const [, entry] of activeCues) {
    entry.timer?.cancel();
    entry.howl?._crossfadeCleanup?.();
    entry.howl?.unload();
  }
  activeCues.clear();
  cleanupBufferMonitoring();
  isAudioPaused = false;
}

export function pauseAudioCues() {
  isAudioPaused = true;
  for (const [, entry] of activeCues) {
    entry.timer?.pause();
    if (entry.howl && entry.state === 'playing') {
      entry.howl.pause();
      entry.howl._crossfadePause?.();
    }
  }
}

export function resumeAudioCues() {
  isAudioPaused = false;
  for (const [, entry] of activeCues) {
    entry.timer?.resume();
    if (entry.howl && entry.state === 'playing') {
      entry.howl.play();
      entry.howl._crossfadeResume?.();
    }
  }
}

export function cueAudioCues(cues) {
  if (!cues || cues.length === 0) return;
  for (const cue of cues) {
    let howl = null;
    if (cue.type === 'narration' && narrationCache.has(cue.src)) {
      howl = narrationCache.get(cue.src);
      narrationCache.delete(cue.src);
      howl.mute(globalMuted);
    } else {
      howl = new Howl({
        src: [cue.src],
        volume: cue.volume,
        html5: true,
        preload: true,
        mute: globalMuted,
      });
    }
    const entry = { id: cue.id, howl, timer: null, type: cue.type, state: 'cued' };
    howl.on('loaderror', (_id, err) => {
      console.error(`Cue preload failed: ${cue.id} (${cue.src})`, err);
      if (activeCues.get(cue.id) === entry) {
        entry.howl = null;
        entry.state = 'error';
      }
    });
    activeCues.set(cue.id, entry);
  }
}

export function cancelCue(cueId) {
  const entry = activeCues.get(cueId);
  if (!entry) return;
  entry.timer?.cancel();
  entry.howl?.unload();
  activeCues.delete(cueId);
  if (entry.type === 'narration') cleanupBufferMonitoring();
}

export function reCueCue(cueId, cue) {
  cancelCue(cueId);
  const howl = new Howl({
    src: [cue.src],
    volume: cue.volume,
    html5: true,
    mute: globalMuted,
    preload: true,
  });
  const entry = { id: cueId, howl, timer: null, type: cue.type, state: 'cued' };
  howl.on('loaderror', (_id, err) => {
    console.error(`Re-cue preload failed: ${cueId} (${cue.src})`, err);
    if (activeCues.get(cueId) === entry) {
      entry.howl = null;
      entry.state = 'error';
    }
  });
  activeCues.set(cueId, entry);
  return howl;
}

export function getNarrationCue() {
  for (const [, entry] of activeCues) {
    if (entry.type === 'narration') return entry.howl;
  }
  return null;
}

export function setMuted(muted) {
  globalMuted = muted;
  for (const [, entry] of activeCues) {
    entry.howl?.mute(muted);
  }
}
