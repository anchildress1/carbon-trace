import { Howl, Howler } from 'howler';
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

// Audio-reactive analyser state (ADR-008)
// Uses Howler.ctx (AudioContext) — an internal Howler.js property,
// not part of the public API. Pinned to howler@^2.2.4.
let analyserNode = null;

// Ahead-of-time narration cache
const narrationCache = new Map();

// --- Buffer monitoring ---

export function onNarrationBufferChange(cb) {
  bufferChangeCallback = cb;
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

function reloadFromPosition(node, onRecoveryFailed) {
  const time = node.currentTime;
  const src = node.src;
  node.src = '';
  node.src = src;
  const onCanPlay = () => {
    node.removeEventListener('canplay', onCanPlay);
    node.currentTime = time;
    if (!isAudioPaused) {
      node.play().catch((err) => {
        console.warn('Buffer recovery play() failed:', err.message);
        cleanupBufferMonitoring();
        onRecoveryFailed?.();
      });
    }
  };
  node.addEventListener('canplay', onCanPlay);
}

function checkBufferProgress(node, state, onExhaustion, onRecoveryFailed) {
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
          onRecoveryFailed?.();
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
      reloadFromPosition(node, onRecoveryFailed);
      state.stallChecks = 0;
    }
  }
}

function handleWaiting(node, state, onExhaustion, onRecoveryFailed) {
  if (narrationBuffering) return;
  narrationBuffering = true;
  bufferChangeCallback?.(true);

  state.stallChecks = 0;
  state.lastBufferedEnd = getBufferedEnd(node);
  bufferCheckTimer = setInterval(
    () => checkBufferProgress(node, state, onExhaustion, onRecoveryFailed),
    4000,
  );
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

    const onWaiting = () => handleWaiting(node, state, opts?.onExhaustion, opts?.onRecoveryFailed);
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

export function trimNarrationCache(keepSrcs = []) {
  const keep = new Set(keepSrcs.filter(Boolean));
  for (const [src, howl] of narrationCache.entries()) {
    if (keep.has(src)) continue;
    howl.unload();
    narrationCache.delete(src);
  }
}

// --- Anchor resolution ---

function buildCueDurations(cues, opts) {
  const durations = new Map();

  if (opts?.audioDurations) {
    for (const cue of cues) {
      const metaDuration = opts.audioDurations.get(cue.src);
      if (metaDuration > 0) durations.set(cue.id, metaDuration * 1000);
    }
  }

  const narrationCue = cues.find((c) => c.type === 'narration');
  if (narrationCue && opts?.maxNarrationDurationMs && !durations.has(narrationCue.id)) {
    durations.set(narrationCue.id, opts.maxNarrationDurationMs);
  }

  return durations;
}

function tryResolveAnchor(cue, resolvedEnters, durations) {
  if (resolvedEnters.has(cue.id)) return false;
  if (!cue.enter || typeof cue.enter !== 'object') return false;
  const refEnter = resolvedEnters.get(cue.enter.ref);
  if (refEnter === undefined) return false;
  if (durations.has(cue.enter.ref)) {
    resolvedEnters.set(cue.id, refEnter + durations.get(cue.enter.ref) + cue.enter.offset);
  } else {
    console.error(`Anchor ref "${cue.enter.ref}" duration unknown — falling back to enter: 0`);
    resolvedEnters.set(cue.id, 0);
  }
  return true;
}

export function resolveCueEnters(cues, opts) {
  const durations = buildCueDurations(cues, opts);
  const resolvedEnters = new Map();

  for (const cue of cues) {
    if (typeof cue.enter === 'number') {
      resolvedEnters.set(cue.id, cue.enter);
    }
  }

  let progress = true;
  while (progress) {
    progress = false;
    for (const cue of cues) {
      if (tryResolveAnchor(cue, resolvedEnters, durations)) {
        progress = true;
      }
    }
  }

  for (const cue of cues) {
    if (!resolvedEnters.has(cue.id)) {
      console.error(
        `Anchor ref "${cue.enter.ref}" unresolvable (circular or missing) — falling back to enter: 0`,
      );
      resolvedEnters.set(cue.id, 0);
    }
  }

  return cues.map((cue) => ({ ...cue, resolvedEnter: resolvedEnters.get(cue.id) }));
}

// --- Internal cue playback ---

// Returns the ambient entry that crossfadeAmbientCue should replace.
// Only matches state === 'playing' — an entry in 'fading-out' is already
// being managed by a prior crossfade's unload timer and must not be
// re-adopted. cancelAudioCues must NOT set state to 'fading-out' on
// preserved entries, or this lookup will silently miss the active ambient
// and the old howl will never be unloaded.
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

  howl.once('playerror', (_id, err) => {
    console.warn(`Playback failed for "${cue.src}" (${cue.type}):`, err);
  });
  howl.play();

  if (cue.fadeIn > 0) {
    howl.fade(0, cue.volume, cue.fadeIn);
  }

  return howl;
}

function crossfadeAmbientCue(cue, crossfadeDurationMs, newEntry) {
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
  let fadeOutTimer = null;

  // Start outgoing fade immediately — tied to scene transition, not to when
  // the incoming file finishes buffering. Error handler cancels the timer and
  // restores the old ambient if the new one fails to load or play.
  if (oldHowl) {
    oldEntry.state = 'fading-out';
    oldHowl.fade(oldHowl.volume(), 0, crossfadeDurationMs);
    fadeOutTimer = new PausableTimer(() => {
      fadeOutTimer = null;
      oldHowl.unload();
      unloaded = true;
      removeEntryIfCurrent(oldEntry);
    }, crossfadeDurationMs + 100);
  }

  const handleError = (label, _id, err) => {
    console.warn(`Ambient ${label} failed: ${cue.src}`, err);
    newHowl.unload();
    if (oldHowl && !unloaded) {
      if (fadeOutTimer) {
        fadeOutTimer.cancel();
        fadeOutTimer = null;
      }
      oldEntry.state = 'playing';
      oldHowl.fade(oldHowl.volume(), oldVolume, 200);
    }
    // Mark the entry as failed so pauseAudioCues/resumeAudioCues skip it
    if (newEntry && newEntry.howl === newHowl) {
      newEntry.howl = null;
      newEntry.state = 'error';
    }
  };

  newHowl.once('loaderror', (id, err) => handleError('load', id, err));
  newHowl.once('playerror', (id, err) => handleError('play', id, err));

  // Store cleanup hook so cancelAudioCues can drain the deferred unload
  newHowl._crossfadeCleanup = () => {
    if (fadeOutTimer) {
      fadeOutTimer.cancel();
      fadeOutTimer = null;
    }
    if (oldHowl && !unloaded) {
      oldHowl.unload();
      unloaded = true;
      removeEntryIfCurrent(oldEntry);
    }
  };
  newHowl._crossfadePause = () => {
    fadeOutTimer?.pause();
    if (oldHowl && !unloaded && activeCues.get(oldEntry?.id) !== oldEntry) {
      oldHowl.pause();
    }
  };
  newHowl._crossfadeResume = () => {
    fadeOutTimer?.resume();
    if (oldHowl && !unloaded && activeCues.get(oldEntry?.id) !== oldEntry) {
      oldHowl.play();
    }
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
    entry.state = 'ended';
    if (safetyTimer) safetyTimer.cancel();
    if (entry.timer === safetyTimer) entry.timer = null;
    cleanupBufferMonitoring();
    opts.onNarrationEnd?.();
  };

  entry.howl.once('end', safeEnd);
  entry.howl.once('loaderror', () => {
    entry.howl.unload();
    safeEnd();
  });
  entry.howl.once('playerror', () => {
    entry.howl.unload();
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
    onRecoveryFailed: opts?.onRecoveryFailed,
  });
}

// --- Audio-reactive analyser (ADR-008) ---

/**
 * Lazy-create an AnalyserNode on Howler's AudioContext.
 * Returns the same instance on subsequent calls.
 * Returns null if the AudioContext is unavailable.
 *
 * The AnalyserNode is NOT connected to ctx.destination — it receives
 * input from a dedicated analysis <audio> element managed by
 * effects-canvas.js (ADR-008 approach B). Howler's playback audio
 * is completely independent.
 */
export function getAnalyserNode() {
  const ctx = Howler.ctx;
  if (!ctx) return null;

  if (!analyserNode) {
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.4;
  }

  return analyserNode;
}

/**
 * Disconnect and release the AnalyserNode. Called by cancelAudioCues()
 * on scene change. The dedicated analysis element (managed by
 * effects-canvas.js) is responsible for its own cleanup.
 */
export function disconnectAnalyserSource() {
  analyserNode = null;
}

// --- Public API (ADR-005) ---

/**
 * Wrap an onNarrationEnd callback to fade boost cues (volumeAfterNarration)
 * when narration ends. Returns the original callback unchanged if no boost
 * cues exist in the provided array.
 */
export function wrapOnNarrationEndWithBoost(cues, onNarrationEnd) {
  if (!cues || cues.length === 0) return onNarrationEnd;

  const boostCues = cues.filter((c) => c.volumeAfterNarration !== undefined);
  if (boostCues.length === 0) return onNarrationEnd;

  return () => {
    for (const cue of boostCues) {
      const entry = activeCues.get(cue.id);
      if (entry?.howl) {
        const fadeDuration = cue.fadeAfterNarration ?? 3000;
        entry.howl.fade(entry.howl.volume(), cue.volumeAfterNarration, fadeDuration);
      }
    }
    onNarrationEnd?.();
  };
}

export function scheduleAudioCues(cues, opts = {}) {
  if (!cues || cues.length === 0) return;

  const crossfadeDurationMs = opts.crossfadeDurationMs ?? 800;
  const resolved = resolveCueEnters(cues, opts);

  for (const cue of resolved) {
    // Defensive: clean up any pre-existing entry with the same ID.
    // Always cancel pending timers. For ambient→ambient, skip howl unload —
    // crossfadeAmbientCue handles the playing-howl transition.
    const existing = activeCues.get(cue.id);
    if (existing) {
      existing.timer?.cancel();
      if (!(cue.type === 'ambient' && existing.type === 'ambient')) {
        existing.howl?._crossfadeCleanup?.();
        existing.howl?.unload();
      }
    }

    const entry = { id: cue.id, howl: null, timer: null, type: cue.type, state: 'pending' };

    const startCue = () => {
      entry.timer = null;
      if (cue.type === 'ambient') {
        entry.howl = crossfadeAmbientCue(cue, crossfadeDurationMs, entry);
      } else {
        entry.howl = playCue(cue);
      }
      entry.state = 'playing';

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

export function cancelAudioCues(opts = {}) {
  const preserveAmbient = opts.preserveAmbient === true;
  const ambientFadeMs = opts.ambientFadeMs || 0;
  isAudioPaused = false;
  disconnectAnalyserSource();
  for (const [id, entry] of activeCues.entries()) {
    entry.timer?.cancel();
    const keepAmbient =
      preserveAmbient &&
      entry.type === 'ambient' &&
      entry.howl &&
      (entry.state === 'playing' || entry.state === 'fading-out');
    if (keepAmbient) {
      entry.timer = null;
      // Start a volume pre-fade so the ambient doesn't play at full volume
      // through the visual transition. DO NOT change entry.state here —
      // the entry must stay 'playing' so that findActiveAmbient() can still
      // locate it when crossfadeAmbientCue runs for the incoming scene.
      // crossfadeAmbientCue reads howl.volume() and fades from whatever
      // level the pre-fade has reached, so the handoff is seamless.
      if (ambientFadeMs > 0 && entry.state === 'playing') {
        entry.howl.fade(entry.howl.volume(), 0, ambientFadeMs);
      }
      continue;
    }
    entry.howl?._crossfadeCleanup?.();
    entry.howl?.unload();
    activeCues.delete(id);
  }
  cleanupBufferMonitoring();
}

export function pauseAudioCues() {
  isAudioPaused = true;
  for (const [, entry] of activeCues) {
    entry.timer?.pause();
    entry.howl?._crossfadePause?.();
    if (entry.howl && (entry.state === 'playing' || entry.state === 'fading-out')) {
      entry.howl.pause();
    }
  }
}

export function resumeAudioCues() {
  isAudioPaused = false;
  for (const [, entry] of activeCues) {
    entry.timer?.resume();
    entry.howl?._crossfadeResume?.();
    if (entry.howl && (entry.state === 'playing' || entry.state === 'fading-out')) {
      entry.howl.play();
    }
  }
}

export function setMuted(muted) {
  globalMuted = muted;
  for (const [, entry] of activeCues) {
    entry.howl?.mute(muted);
  }
}
