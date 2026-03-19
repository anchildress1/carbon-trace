import { Howl } from 'howler';
import { PausableTimer } from './pausable-timer.js';

// --- Channel state ---

let currentAmbient = null;
let currentNarration = null;
let currentMusic = null;
let globalMuted = false;

const channels = {
  ambient: {
    get() {
      return currentAmbient;
    },
    set(v) {
      currentAmbient = v;
    },
  },
  narration: {
    get() {
      return currentNarration;
    },
    set(v) {
      currentNarration = v;
    },
  },
  music: {
    get() {
      return currentMusic;
    },
    set(v) {
      currentMusic = v;
    },
  },
};

// --- Howl factory with centralized error handling ---
//
// Every Howl uses html5: true → acquires from Howler's Audio pool.
// On load failure, the factory:
//   1. Logs a warning with channel name and src
//   2. Nulls the channel ref if this Howl is still current
//   3. Calls onFail (e.g., narration's onend for auto-advance chain)
//   4. Defers unload to release the pool slot
//
// On play failure, same warn + onFail but no unload (Howl may retry).
//
// Pass channel=null to skip ref-null (e.g., preloadNarrationAhead,
// scheduleAmbient which have custom error recovery).

function createHowl(channel, howlOptions, onFail) {
  const src = howlOptions.src?.[0] || 'unknown';
  const label = channel || 'audio';

  const howl = new Howl({
    ...howlOptions,
    onloaderror: (_id, err) => {
      console.warn(`Failed to load ${label}: ${src}`, err);
      if (channel && channels[channel].get() === howl) channels[channel].set(null);
      if (onFail) onFail();
      queueMicrotask(() => howl.unload());
    },
    onplayerror: (_id, err) => {
      console.warn(`Failed to play ${label}: ${src}`, err);
      if (onFail) onFail();
    },
  });
  return howl;
}

// Session model — cancelAll() increments sessionId, stale callbacks check before executing
let sessionId = 0;

// Internal scheduling timers
let narrationDelayTimer = null;
let narrationSafetyTimer = null;
let musicEnterTimer = null;
let musicExitTimer = null;

// Crossfade tracking
let oldAmbientRef = null;
let oldAmbientFadeTimer = null;

const SAFETY_MARGIN_MS = 5000;

// Buffer monitoring state
let bufferChangeCallback = null;
let narrationBuffering = false;
let bufferCheckTimer = null;
let bufferEventCleanup = null;

// Ahead-of-time narration cache — pre-created Howls that start downloading
// audio data so it's buffered before playback begins.
const narrationCache = new Map();

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
  node.play().catch((err) => {
    console.warn('Buffer recovery play() failed:', err.message);
    cleanupBufferMonitoring();
  });
}

function checkBufferProgress(node, state) {
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
      node.play().catch((err) => {
        console.warn('Buffer recovery play() failed:', err.message);
        cleanupBufferMonitoring();
      });
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
        return;
      }
      reloadFromPosition(node);
      state.stallChecks = 0;
    }
  }
}

function handleWaiting(node, state) {
  if (narrationBuffering) return;
  narrationBuffering = true;
  bufferChangeCallback?.(true);

  state.stallChecks = 0;
  state.lastBufferedEnd = getBufferedEnd(node);
  bufferCheckTimer = setInterval(() => checkBufferProgress(node, state), 4000);
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

function monitorNarrationBuffer(howl) {
  const attachListeners = () => {
    const node = howl._sounds?.[0]?._node;
    if (!node || typeof node.addEventListener !== 'function') {
      console.warn('Cannot monitor narration buffer: audio node unavailable');
      return;
    }

    const state = { lastBufferedEnd: 0, stallChecks: 0 };

    const onWaiting = () => handleWaiting(node, state);
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

  const howl = createHowl(null, {
    src: [src],
    html5: true,
    preload: true,
    volume: 1,
    mute: globalMuted,
  });
  // Factory handles warn + unload on error; we just clean the cache ref
  howl.on('loaderror', () => narrationCache.delete(src));
  narrationCache.set(src, howl);
}

export function clearNarrationCache() {
  for (const howl of narrationCache.values()) {
    howl.unload();
  }
  narrationCache.clear();
}

// --- Ambient ---

export function playAmbient(src, volume, loop) {
  if (currentAmbient) currentAmbient.unload();

  const howl = createHowl('ambient', {
    src: [src],
    volume,
    loop,
    html5: true,
    mute: globalMuted,
  });
  currentAmbient = howl;
  currentAmbient.play();
  return currentAmbient;
}

export function cueAmbient(src, volume, loop) {
  if (currentAmbient) currentAmbient.unload();

  const howl = createHowl('ambient', {
    src: [src],
    volume,
    loop,
    html5: true,
    preload: true,
    mute: globalMuted,
  });
  currentAmbient = howl;
  return currentAmbient;
}

export function crossfadeAmbient(newSrc, volume, durationMs, loop = true) {
  const oldAmbient = currentAmbient;

  const howl = createHowl('ambient', {
    src: [newSrc],
    volume: 0,
    loop,
    html5: true,
    mute: globalMuted,
  });
  currentAmbient = howl;
  currentAmbient.play();
  currentAmbient.fade(0, volume, durationMs);

  if (oldAmbient) {
    oldAmbient.fade(oldAmbient.volume(), 0, durationMs);
    setTimeout(() => oldAmbient.unload(), durationMs + 100);
  }

  return currentAmbient;
}

// --- Narration ---

export function playNarration(src, onend) {
  cleanupBufferMonitoring();
  if (currentNarration) currentNarration.unload();

  let howl = narrationCache.get(src);
  if (howl) {
    narrationCache.delete(src);
    howl.mute(globalMuted);
    if (onend) howl.once('end', onend);
    // Factory already handles warn + unload; add domain logic
    howl.on('loaderror', () => {
      if (currentNarration === howl) currentNarration = null;
      if (onend) onend();
    });
    howl.on('playerror', () => {
      if (onend) onend();
    });
  } else {
    howl = createHowl(
      'narration',
      {
        src: [src],
        volume: 1,
        html5: true,
        mute: globalMuted,
        onend: onend || undefined,
      },
      onend,
    );
  }

  currentNarration = howl;
  currentNarration.play();
  monitorNarrationBuffer(howl);
  return currentNarration;
}

export function cueNarration(src) {
  cleanupBufferMonitoring();
  if (currentNarration) currentNarration.unload();

  let howl = narrationCache.get(src);
  if (howl) {
    narrationCache.delete(src);
    howl.mute(globalMuted);
    howl.on('loaderror', () => {
      if (currentNarration === howl) currentNarration = null;
    });
  } else {
    howl = createHowl('narration', {
      src: [src],
      volume: 1,
      html5: true,
      mute: globalMuted,
      preload: true,
    });
  }

  currentNarration = howl;
  return currentNarration;
}

export function stopNarration() {
  cleanupBufferMonitoring();
  if (currentNarration) {
    currentNarration.unload();
    currentNarration = null;
  }
}

export function pauseNarration() {
  if (currentNarration) currentNarration.pause();
}

export function resumeNarration() {
  if (currentNarration) currentNarration.play();
}

// --- Ambient pause/resume ---

export function pauseAmbient() {
  if (currentAmbient) currentAmbient.pause();
}

export function resumeAmbient() {
  if (currentAmbient) currentAmbient.play();
}

// --- Music ---

export function playMusic(src, volume) {
  if (currentMusic) currentMusic.unload();

  const howl = createHowl('music', {
    src: [src],
    volume,
    loop: true,
    html5: true,
    mute: globalMuted,
  });
  currentMusic = howl;
  currentMusic.play();
  return currentMusic;
}

export function cueMusic(src, volume) {
  if (currentMusic) currentMusic.unload();

  const howl = createHowl('music', {
    src: [src],
    volume,
    loop: true,
    html5: true,
    preload: true,
    mute: globalMuted,
  });
  currentMusic = howl;
  return currentMusic;
}

export function fadeMusic(toVolume, durationMs) {
  if (currentMusic) currentMusic.fade(currentMusic.volume(), toVolume, durationMs);
}

export function pauseMusic() {
  if (currentMusic) currentMusic.pause();
}

export function resumeMusic() {
  if (currentMusic) currentMusic.play();
}

export function stopMusic() {
  if (currentMusic) {
    currentMusic.unload();
    currentMusic = null;
  }
}

// --- Global ---

export function stopAll() {
  cleanupBufferMonitoring();
  clearNarrationCache();
  if (currentAmbient) currentAmbient.unload();
  if (currentNarration) currentNarration.unload();
  if (currentMusic) currentMusic.unload();
  currentAmbient = null;
  currentNarration = null;
  currentMusic = null;
}

export function setMuted(muted) {
  globalMuted = muted;
  if (currentAmbient) currentAmbient.mute(muted);
  if (currentNarration) currentNarration.mute(muted);
  if (currentMusic) currentMusic.mute(muted);
}

// --- Scheduling API (ADR-005) ---

function clearNarrationSafetyTimer() {
  narrationSafetyTimer?.cancel();
  narrationSafetyTimer = null;
}

function cancelOldAmbientFade() {
  if (oldAmbientFadeTimer) {
    clearTimeout(oldAmbientFadeTimer);
    oldAmbientFadeTimer = null;
  }
  oldAmbientRef = null;
}

export function scheduleNarration(src, delay, onend, maxDurationMs) {
  const mySession = sessionId;
  let ended = false;

  narrationDelayTimer?.cancel();
  narrationDelayTimer = null;
  clearNarrationSafetyTimer();

  const safeEnd = () => {
    if (ended) return;
    ended = true;
    clearNarrationSafetyTimer();
    if (onend) onend();
  };

  const startPlayback = () => {
    if (mySession !== sessionId) return;
    playNarration(src, safeEnd);

    if (maxDurationMs > 0) {
      narrationSafetyTimer = new PausableTimer(() => {
        narrationSafetyTimer = null;
        console.warn(`Narration safety timeout: ${src}`);
        stopNarration();
        safeEnd();
      }, maxDurationMs + SAFETY_MARGIN_MS);
    }
  };

  if (delay > 0) {
    narrationDelayTimer = new PausableTimer(startPlayback, delay);
  } else {
    startPlayback();
  }
}

export function scheduleAmbient(newSrc, volume, durationMs, loop = true) {
  const oldAmbient = currentAmbient;
  let oldUnloaded = false;

  cancelOldAmbientFade();
  if (oldAmbient) {
    oldAmbientRef = oldAmbient;
    oldAmbient.fade(oldAmbient.volume(), 0, durationMs);
    oldAmbientFadeTimer = setTimeout(() => {
      oldUnloaded = true;
      oldAmbientRef = null;
      oldAmbientFadeTimer = null;
      oldAmbient.unload();
    }, durationMs + 100);
  }

  // Custom error recovery — restore old ambient on failure.
  // Pass channel=null; we handle ref management ourselves.
  const restoreOld = () => {
    if (currentAmbient === newHowl && !oldUnloaded && oldAmbient) {
      if (oldAmbientFadeTimer) {
        clearTimeout(oldAmbientFadeTimer);
        oldAmbientFadeTimer = null;
      }
      oldAmbient.fade(oldAmbient.volume(), volume, 200);
      currentAmbient = oldAmbient;
      oldAmbientRef = null;
    }
  };

  const newHowl = createHowl(null, {
    src: [newSrc],
    volume: 0,
    loop,
    html5: true,
    mute: globalMuted,
  });
  // Attach custom recovery after factory handles warn + unload
  newHowl.on('loaderror', restoreOld);
  newHowl.on('playerror', restoreOld);

  currentAmbient = newHowl;
  currentAmbient.play();
  currentAmbient.fade(0, volume, durationMs);
}

export function scheduleMusic(config) {
  const mySession = sessionId;
  musicEnterTimer?.cancel();
  musicEnterTimer = null;
  musicExitTimer?.cancel();
  musicExitTimer = null;
  stopMusic();

  const enter = config.enter || 0;
  const startPlayback = () => {
    if (mySession !== sessionId) return;
    musicEnterTimer = null;
    playMusic(config.src, config.startVolume);
    fadeMusic(config.fullVolume, config.crescendoMs);

    if (config.exit !== null && config.exit !== undefined) {
      musicExitTimer = new PausableTimer(() => {
        musicExitTimer = null;
        fadeMusic(0, 2000);
      }, config.exit - enter);
    }
  };

  if (enter > 0) {
    musicEnterTimer = new PausableTimer(startPlayback, enter);
  } else {
    startPlayback();
  }
}

export function pauseAll() {
  narrationDelayTimer?.pause();
  narrationSafetyTimer?.pause();
  musicEnterTimer?.pause();
  musicExitTimer?.pause();
  pauseNarration();
  pauseAmbient();
  pauseMusic();
  if (oldAmbientRef) oldAmbientRef.pause();
  if (oldAmbientFadeTimer) {
    clearTimeout(oldAmbientFadeTimer);
    oldAmbientFadeTimer = null;
  }
}

export function resumeAll() {
  narrationDelayTimer?.resume();
  narrationSafetyTimer?.resume();
  musicEnterTimer?.resume();
  musicExitTimer?.resume();
  resumeNarration();
  resumeAmbient();
  resumeMusic();
  if (oldAmbientRef) {
    oldAmbientRef.volume(0);
    oldAmbientRef.unload();
    oldAmbientRef = null;
  }
}

// Cancels narration, music, and all scheduling timers.
// Ambient is intentionally excluded — scheduleAmbient manages its own
// crossfade lifecycle, and callers (e.g., scene transitions) rely on
// the old ambient remaining active so the next scheduleAmbient can fade from it.
export function cancelAll() {
  sessionId++;
  narrationDelayTimer?.cancel();
  narrationDelayTimer = null;
  clearNarrationSafetyTimer();
  musicEnterTimer?.cancel();
  musicEnterTimer = null;
  musicExitTimer?.cancel();
  musicExitTimer = null;
  cancelOldAmbientFade();
  stopNarration();
  stopMusic();
}
