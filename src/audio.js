import { Howl } from 'howler';

let currentAmbient = null;
let currentNarration = null;
let currentMusic = null;
let globalMuted = false;

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
  // Force the browser to re-evaluate its buffer position by seeking
  // to the current time. This is an intentional no-op seek that
  // unsticks stalled HTML5 audio in some browsers.
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

export function preloadNarrationAhead(src) {
  if (narrationCache.has(src)) return;

  const howl = new Howl({
    src: [src],
    html5: true,
    preload: true,
    volume: 1,
    mute: globalMuted,
    onloaderror: (_id, err) => {
      console.warn(`Failed to preload narration: ${src}`, err);
      narrationCache.delete(src);
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

export function playAmbient(src, volume, loop) {
  if (currentAmbient) {
    currentAmbient.unload();
  }

  const howl = new Howl({
    src: [src],
    volume: volume,
    loop: loop,
    html5: true,
    mute: globalMuted,
    onloaderror: (_id, err) => {
      console.warn(`Failed to load ambient: ${src}`, err);
      if (currentAmbient === howl) currentAmbient = null;
    },
    onplayerror: (_id, err) => {
      console.warn(`Failed to play ambient: ${src}`, err);
    },
  });

  currentAmbient = howl;
  currentAmbient.play();
  return currentAmbient;
}

export function crossfadeAmbient(newSrc, volume, durationMs) {
  const oldAmbient = currentAmbient;

  const howl = new Howl({
    src: [newSrc],
    volume: 0,
    loop: true,
    html5: true,
    mute: globalMuted,
    onloaderror: (_id, err) => {
      console.warn(`Failed to load ambient: ${newSrc}`, err);
      if (currentAmbient === howl) currentAmbient = null;
    },
    onplayerror: (_id, err) => {
      console.warn(`Failed to play ambient: ${newSrc}`, err);
    },
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

export function playNarration(src, onend) {
  cleanupBufferMonitoring();

  if (currentNarration) {
    currentNarration.unload();
  }

  let howl = narrationCache.get(src);
  if (howl) {
    narrationCache.delete(src);
    howl.mute(globalMuted);
    if (onend) howl.on('end', onend);
    howl.on('loaderror', (_id, err) => {
      console.warn(`Failed to load narration: ${src}`, err);
      if (currentNarration === howl) currentNarration = null;
    });
    howl.on('playerror', (_id, err) => {
      console.warn(`Failed to play narration: ${src}`, err);
    });
  } else {
    howl = new Howl({
      src: [src],
      volume: 1,
      html5: true,
      mute: globalMuted,
      onend: onend || undefined,
      onloaderror: (_id, err) => {
        console.warn(`Failed to load narration: ${src}`, err);
        if (currentNarration === howl) currentNarration = null;
      },
      onplayerror: (_id, err) => {
        console.warn(`Failed to play narration: ${src}`, err);
      },
    });
  }

  currentNarration = howl;
  currentNarration.play();
  monitorNarrationBuffer(howl);
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
  if (currentNarration) {
    currentNarration.pause();
  }
}

export function resumeNarration() {
  if (currentNarration) {
    currentNarration.play();
  }
}

export function pauseAmbient() {
  if (currentAmbient) {
    currentAmbient.pause();
  }
}

export function resumeAmbient() {
  if (currentAmbient) {
    currentAmbient.play();
  }
}

export function playMusic(src, volume) {
  if (currentMusic) {
    currentMusic.unload();
  }

  const howl = new Howl({
    src: [src],
    volume: volume,
    loop: true,
    html5: true,
    mute: globalMuted,
    onloaderror: (_id, err) => {
      console.warn(`Failed to load music: ${src}`, err);
      if (currentMusic === howl) currentMusic = null;
    },
    onplayerror: (_id, err) => {
      console.warn(`Failed to play music: ${src}`, err);
    },
  });

  currentMusic = howl;
  currentMusic.play();
  return currentMusic;
}

export function fadeMusic(toVolume, durationMs) {
  if (currentMusic) {
    currentMusic.fade(currentMusic.volume(), toVolume, durationMs);
  }
}

export function pauseMusic() {
  if (currentMusic) {
    currentMusic.pause();
  }
}

export function resumeMusic() {
  if (currentMusic) {
    currentMusic.play();
  }
}

export function stopMusic() {
  if (currentMusic) {
    currentMusic.unload();
    currentMusic = null;
  }
}

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
  if (currentAmbient) {
    currentAmbient.mute(muted);
  }
  if (currentNarration) {
    currentNarration.mute(muted);
  }
  if (currentMusic) {
    currentMusic.mute(muted);
  }
}
