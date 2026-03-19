# ADR-005: Audio Scheduling Encapsulation and Failure Safety

**Status:** Accepted
**Date:** March 19, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Resolves:** Timer bloat in app.js, state desync on audio errors
**Implements:** ADR-003 audio.js contract (scheduleAudioCues / pauseAudioCues / resumeAudioCues)
**Affects:** v5 §3 (audio.js contract), §4 (schema migration to audioCues), §5 (state machine)

## Context

### Problem 1: Timer Bloat in the Orchestrator

`app.js` currently manages 4 independent `setTimeout` chains for audio timing, each with a manual `start`/`delay`/`remaining` triple for pause precision — 16 state fields and ~150 lines of identical save/clear/resume boilerplate. Each repetition is a misname-a-field-and-leak-a-timer bug waiting to happen.

### Problem 2: State Desync on Audio Errors

1. **Crossfade stall:** `crossfadeAmbient()` unloads the old ambient on a blind `setTimeout(fn, durationMs + 100)`. If the new ambient fails to load (network stall, DNS failure), the error fires *after* the old ambient is already unloaded — dead silence, no recovery.

2. **Silent HTML5 stall:** Some mobile browsers stall without emitting `waiting`. The buffer recovery system only listens for events. No event = no recovery = narration never fires `end` = scene hangs forever. The existing safety timer gap is real: buffer monitor gives up after ~12s and removes the spinner, but `onend` never fires. User stares at a static scene for 50+ seconds until any outer safety timeout trips.

3. **Music timer orphaning:** `scheduleMusic()` creates nested timers (`musicExitTimer` inside `startPlayback`). Pause/resume can orphan the inner timer if timing overlaps.

### Problem 3: ADR-003 Contract Not Implemented

ADR-003 accepted the unified `audioCues` array and defined the audio.js contract:

```
scheduleAudioCues(cues)    → schedule all cues for a frame
cancelAudioCues()          → clear all pending timers + stop all cues
pauseAudioCues()           → freeze all active/pending cues
resumeAudioCues()          → resume from pause point
crossfadeAmbient(fromCues, toCues, ms)
cueAllAudio(cues)          → load + seek to 0, do NOT play (hardCut)
getNarrationCue()          → returns active narration Howl (for replay)
setMuted(bool)
```

The current implementation uses separate `narration`/`ambient`/`music` slots — the exact rigid model ADR-003 replaced. ADR-005 must implement the unified cue model, not re-silo it.

## Options Considered

### Option A: Encapsulate Current Slots (Rejected)

Wrap the existing `scheduleNarration`/`scheduleAmbient`/`scheduleMusic` functions with `PausableTimer` internally but keep the slot-based API.

| Dimension | Assessment |
|-----------|------------|
| ADR-003 alignment | None — restores the slot model ADR-003 rejected |
| Extensibility | Poor — every new cue type requires a new function |
| Anchor support | Impossible — anchoring requires cues to reference each other by id |

**Rejected.** This is a backwards regression. ADR-003 exists specifically because the slot model can't express "start this track 5 seconds before that other track ends."

### Option B: Unified audioCues with Dynamic Timer Map (Accepted)

Implement ADR-003's contract. `audio.js` receives the full `audioCues` array, dynamically creates `PausableTimer` instances per cue keyed by `id`, and manages the entire lifecycle internally. `app.js` calls `scheduleAudioCues(cues, onNarrationEnd)` and nothing else.

| Dimension | Assessment |
|-----------|------------|
| ADR-003 alignment | Full — implements the accepted contract |
| Extensibility | High — new cue type is just another entry in the array |
| Anchor support | Native — cues reference each other by id within the same array |
| Error recovery | Colocated — all failure handling in one module |

**Accepted.**

## Decision

**Option B: Unified audioCues with dynamic timer map.**

### audio.js Contract

```
// Scheduling
scheduleAudioCues(cues, opts)       → schedule all cues for a frame
  opts.onNarrationEnd               → callback for auto-advance chain
  opts.maxNarrationDurationMs       → safety timeout (caption-derived)
  opts.crossfadeDurationMs          → ambient crossfade duration (default 800)
cancelAudioCues()                   → stop all Howls, cancel all timers, clear map
pauseAudioCues()                    → pause all active Howls + freeze all pending timers
resumeAudioCues()                   → resume all paused Howls + reschedule all frozen timers

// Cueing (hardCut / replay-while-paused)
cueAudioCues(cues)                  → load all, seek to 0, do NOT play
cancelCue(cueId)                    → stop + cancel one specific cue (for replay reset)
reCueCue(cueId, cue)                → cancel + re-cue a single cue without touching others

// Query
getNarrationCue()                   → returns active narration Howl (for replay)

// Global
setMuted(bool)
onNarrationBufferChange(callback)
preloadNarrationAhead(src)
clearNarrationCache()
```

### Internal Architecture

```js
// Dynamic cue tracking — no hardcoded timer variables
const activeCues = new Map();   // Map<cueId, { howl, timer: PausableTimer, type, state }>

function scheduleAudioCues(cues, opts) {
  if (!cues) return;

  const resolved = resolveAnchors(cues, opts.maxNarrationDurationMs);

  for (const cue of resolved) {
    const entry = { howl: null, timer: null, type: cue.type, state: 'pending' };

    const startCue = () => {
      if (cue.type === 'ambient') {
        entry.howl = crossfadeAmbientCue(cue, opts.crossfadeDurationMs);
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

function cancelAudioCues() {
  for (const [id, entry] of activeCues) {
    entry.timer?.cancel();
    entry.howl?.unload();
  }
  activeCues.clear();
  cleanupBufferMonitoring();
}

function pauseAudioCues() {
  for (const [id, entry] of activeCues) {
    entry.timer?.pause();
    entry.howl?.pause();
  }
}

function resumeAudioCues() {
  for (const [id, entry] of activeCues) {
    entry.timer?.resume();
    if (entry.state === 'playing') entry.howl?.play();
  }
}
```

### Anchor Resolution

Caption-derived duration as primary source:

```js
function resolveAnchors(cues, maxNarrationDurationMs) {
  const durations = new Map();
  const narrationCue = cues.find(c => c.type === 'narration');
  if (narrationCue && maxNarrationDurationMs) {
    durations.set(narrationCue.id, maxNarrationDurationMs);
  }

  return cues.map(cue => {
    if (typeof cue.enter === 'number') {
      return { ...cue, resolvedEnter: cue.enter };
    }
    const refDuration = durations.get(cue.enter.ref);
    if (refDuration == null) {
      console.warn(`Anchor ref "${cue.enter.ref}" duration unknown — falling back to enter: 0`);
      return { ...cue, resolvedEnter: 0 };
    }
    const refCue = cues.find(c => c.id === cue.enter.ref);
    const refEnter = typeof refCue?.enter === 'number' ? refCue.enter : 0;
    return { ...cue, resolvedEnter: refEnter + refDuration + cue.enter.offset };
  });
}
```

### Crossfade Error Recovery

Defer old ambient unload until new ambient confirms playback:

```js
function crossfadeAmbientCue(cue, crossfadeDurationMs) {
  const oldEntry = findActiveAmbient();
  const oldHowl = oldEntry?.howl;
  const oldVolume = oldHowl?.volume() ?? 0;

  const newHowl = new Howl({
    src: [cue.src], volume: 0, loop: cue.loop,
    html5: true, mute: globalMuted,
  });

  let unloaded = false;

  // Unload old ONLY after new confirms playback
  newHowl.once('play', () => {
    if (oldHowl && !unloaded) {
      oldHowl.fade(oldHowl.volume(), 0, crossfadeDurationMs);
      setTimeout(() => { oldHowl.unload(); unloaded = true; }, crossfadeDurationMs + 100);
    }
  });

  newHowl.on('loaderror', () => {
    console.warn(`Ambient load failed: ${cue.src} — keeping old ambient`);
    newHowl.unload();
    if (oldHowl && !unloaded) oldHowl.fade(oldHowl.volume(), oldVolume, 200);
  });

  newHowl.on('playerror', () => {
    console.warn(`Ambient play failed: ${cue.src} — keeping old ambient`);
    newHowl.unload();
    if (oldHowl && !unloaded) oldHowl.fade(oldHowl.volume(), oldVolume, 200);
  });

  newHowl.play();
  newHowl.fade(0, cue.volume, crossfadeDurationMs);
  return newHowl;
}
```

### Narration Safety Timeout + Buffer Exhaustion Bridge

```js
function wireNarrationEnd(entry, cue, opts) {
  let ended = false;
  let safetyTimer = null;

  const safeEnd = () => {
    if (ended) return;
    ended = true;
    if (safetyTimer) clearTimeout(safetyTimer);
    cleanupBufferMonitoring();
    opts.onNarrationEnd?.();
  };

  entry.howl.once('end', safeEnd);
  entry.howl.on('loaderror', () => { entry.howl.unload(); safeEnd(); });
  entry.howl.on('playerror', () => safeEnd());

  if (opts.maxNarrationDurationMs > 0) {
    const enterDelay = cue.resolvedEnter || 0;
    safetyTimer = setTimeout(() => {
      console.warn(`Narration safety timeout: ${cue.src}`);
      entry.howl?.unload();
      safeEnd();
    }, enterDelay + opts.maxNarrationDurationMs + 5000);
  }

  // Bridge: buffer monitor exhaustion → safeEnd immediately
  monitorNarrationBuffer(entry.howl, {
    onExhaustion: () => {
      console.warn(`Buffer recovery exhausted: ${cue.src} — forcing advance`);
      entry.howl?.unload();
      safeEnd();
    }
  });
}
```

### Granular Cue Control (ADR-004 Replay)

```js
function cancelCue(cueId) {
  const entry = activeCues.get(cueId);
  if (!entry) return;
  entry.timer?.cancel();
  entry.howl?.unload();
  activeCues.delete(cueId);
}

function reCueCue(cueId, cue) {
  cancelCue(cueId);
  const howl = new Howl({
    src: [cue.src], volume: cue.volume,
    html5: true, mute: globalMuted, preload: true,
  });
  activeCues.set(cueId, { howl, timer: null, type: cue.type, state: 'cued' });
  return howl;
}
```

### PausableTimer

No `sessionId` guards inside callbacks — `.cancel()` calls `clearTimeout()`, preventing the callback from entering the event queue. Generation/session guards belong only on Howler async callbacks (`onend`, `onloaderror`, `onplayerror`) where unload doesn't guarantee the event loop is clear.

```js
class PausableTimer {
  #id = null;
  #callback;
  #delay;
  #start = null;
  #remaining = null;

  constructor(callback, delay) {
    this.#callback = callback;
    this.#delay = delay;
    this.#start = Date.now();
    this.#id = setTimeout(() => {
      this.#id = null; this.#start = null; this.#remaining = null;
      this.#callback();
    }, delay);
  }

  pause() {
    if (this.#id === null) return;
    this.#remaining = Math.max(0, this.#delay - (Date.now() - this.#start));
    clearTimeout(this.#id);
    this.#id = null; this.#start = null;
  }

  resume() {
    if (this.#remaining === null || this.#remaining <= 0) return;
    this.#delay = this.#remaining;
    this.#start = Date.now();
    this.#id = setTimeout(() => {
      this.#id = null; this.#start = null; this.#remaining = null;
      this.#callback();
    }, this.#remaining);
    this.#remaining = null;
  }

  cancel() {
    if (this.#id !== null) clearTimeout(this.#id);
    this.#id = null; this.#start = null; this.#delay = null; this.#remaining = null;
  }

  get isActive() { return this.#id !== null; }
  get isPaused() { return this.#remaining !== null && this.#remaining > 0; }
}
```

### app.js Changes

**Removed from app.js state:** 12 timer fields (narrationTimer×4, musicTimer×4, musicExitTimer×4)

**Kept in app.js:** `autoAdvanceTimer` as `PausableTimer` (state-machine concern, calls `advance()`)

**app.js audio calls:**

```js
// showFrame — playing
scheduleAudioCues(frame.audioCues, {
  onNarrationEnd: makeNarrationEndCallback(app, frame, holdAfterNarration),
  maxNarrationDurationMs: getMaxCaptionEnd(frame),
});

// showFrame — cueOnly (hardCut)
cueAudioCues(frame.audioCues);

// doPause
pauseAudioCues();

// doResume (normal)
resumeAudioCues();

// doResume (replayPending)
cancelCue('narration');
scheduleAudioCues([narrationCue], {
  onNarrationEnd: makeNarrationEndCallback(app, frame, holdAfterNarration),
  maxNarrationDurationMs: getMaxCaptionEnd(frame),
});

// cleanupCurrentScene
cancelAudioCues();

// replayNarration (paused) — ADR-004
cancelCue('narration');
reCueCue('narration', narrationCue);
app.replayPending = true;

// replayNarration (playing)
cancelCue('narration');
scheduleAudioCues([narrationCue], {
  onNarrationEnd: makeNarrationEndCallback(app, frame, holdAfterNarration),
  maxNarrationDurationMs: getMaxCaptionEnd(frame),
});
```

## Consequences

**What becomes easier:**

- Pause/resume/cancel: one call each, iterates the cue map
- New cue types require zero infrastructure changes
- Anchor resolution works natively (cues reference each other by id)
- All audio error recovery colocated in audio.js
- Crossfade errors keep old ambient alive
- Buffer exhaustion triggers advance immediately
- Replay targets specific cues without blowing away ambient/music
- Schema matches ADR-003 — no backwards compatibility debt

**What becomes harder:**

- Schema migration: current slots → `audioCues` array in all 12 frames
- audio.js grows to ~550 lines
- Timer tests move from app.js to audio.js
- Dynamic `Map` is harder to inspect than named fields (mitigated by logging)

## Action Items

1. [ ] Implement `PausableTimer` in `src/pausable-timer.js` (standalone, unit tested)
2. [ ] Migrate `scenes.json` from `narration`/`ambient`/`music` slots to `audioCues` array
3. [ ] Rewrite `audio.js`: `scheduleAudioCues`/`cancelAudioCues`/`pauseAudioCues`/`resumeAudioCues` with `Map<cueId, entry>` + `PausableTimer`
4. [ ] Implement anchor resolution using caption-derived duration
5. [ ] Implement crossfade error recovery: defer old-ambient unload until new-ambient `play`
6. [ ] Implement narration safety timeout + buffer exhaustion → `safeEnd()` bridge
7. [ ] Add `cancelCue(id)` / `reCueCue(id, cue)` for ADR-004 replay
8. [ ] Refactor `app.js`: remove 12 timer state fields, use unified audio API
9. [ ] Replace `autoAdvanceTimer` with `PausableTimer` in app.js
10. [ ] Move timer scheduling tests from app.test.js to audio.test.js
11. [ ] Update v5 spec §3 + §4 + §5.2

---

## Appendix: Resolved Hazards

- **[P0] ADR-004 replay** — ✅ Resolved on `docs/adr-004-option-b-alignment`. ADR-005 changes replay path from `cueNarration(src)` to `reCueCue('narration', cue)` — same behavior, unified API.
- **[P1] Stage click advance** — ✅ Resolved.
- **[P1] validateEffects** — Withdrawn (exists and works).
- **[P2] Lighthouse gap** — AGENTS.md 100 vs CI 90. Recommend aligning to 90.
