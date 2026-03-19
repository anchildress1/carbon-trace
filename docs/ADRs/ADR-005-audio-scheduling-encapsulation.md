# ADR-005: Audio Scheduling Encapsulation and Failure Safety

**Status:** Proposed
**Date:** March 18, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Resolves:** Timer bloat in app.js, state desync on audio errors
**Affects:** v5 §3 (audio.js contract), §5 (state machine), §17 (rules)

## Context

### Problem 1: Timer Bloat in the Orchestrator

`app.js` currently manages 4 independent `setTimeout` chains for audio timing, each with a manual `start`/`delay`/`remaining` triple for pause precision:

```
Timer                  │ State fields (×4 each)           │ Lines in app.js
───────────────────────┼──────────────────────────────────┼────────────────
autoAdvanceTimer       │ timer, start, delay, remaining   │ ~30
narrationTimer         │ timer, start, delay, remaining   │ ~40
musicTimer             │ timer, start, delay, remaining   │ ~50
musicExitTimer         │ timer, start, delay, remaining   │ ~30
```

That's **16 state fields** and **~150 lines** of save/clear/resume boilerplate in app.js — all following the identical pattern:

```js
// Save remaining on pause
const elapsed = Date.now() - app.fooTimerStart;
app.fooTimerRemaining = Math.max(0, app.fooTimerDelay - elapsed);
clearTimeout(app.fooTimer);
app.fooTimer = null; app.fooTimerStart = null; app.fooTimerDelay = null;

// Resume on unpause
app.fooTimerStart = Date.now();
app.fooTimerDelay = app.fooTimerRemaining;
app.fooTimer = setTimeout(() => { /* callback */ }, app.fooTimerRemaining);
app.fooTimerRemaining = null;
```

This pattern is repeated verbatim for each timer. Each repetition is a chance to misname a field, forget to clear a timer, or leak a remaining value across navigation. ADR-003 identified this: audio scheduling should live in `audio.js`, and `app.js` should call high-level methods.

### Problem 2: State Desync on Audio Errors

`audio.js` correctly wires `onloaderror` and `onplayerror` to call the `onend` callback, which maintains the auto-advance chain. But there are gaps:

1. **Crossfade stall:** `crossfadeAmbient()` fades the old ambient to 0 over `durationMs`, then calls `oldAmbient.unload()` via `setTimeout(fn, durationMs + 100)`. If the new ambient fails to play (error callback fires), the old ambient is *already fading* and will unload regardless — leaving no ambient at all. The error path doesn't cancel the old ambient's fade-out.

2. **Silent HTML5 stall:** The buffer recovery system (`monitorNarrationBuffer`) handles the `waiting` event. But some mobile browsers (especially older WebKit on iOS) can stall without emitting `waiting` — the audio simply stops progressing. The current recovery relies on event-driven detection. A stall with no event = no recovery = narration never fires `end` = scene hangs.

3. **Music timer orphaning:** `scheduleMusic()` creates a `musicExitTimer` inside its `startPlayback` callback. If `doPause()` fires after `musicTimer` starts but before `startPlayback` runs, `saveMusicTimerRemaining` saves the music delay — but when resume fires `resumeDelayedMusic`, it re-creates the entire `startPlayback` chain including a new `musicExitTimer` that may conflict with any previously-saved `musicExitTimerRemaining`.

Root cause for all three: audio timing logic is split between the orchestrator (app.js owns the timers) and the audio module (audio.js owns the Howl instances). Neither module has complete ownership of the scheduling lifecycle.

## Options Considered

### Option A: PausableTimer Utility + Keep Timers in app.js

Extract the save/clear/resume pattern into a reusable `PausableTimer` class. Timers stay in `app.js` but the boilerplate is eliminated.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — ~30-line utility class |
| Refactor scope | Medium — replace 4 timer patterns, remove 16 state fields |
| Risk | Low — mechanical substitution, testable in isolation |
| Audio error fix | None — doesn't address crossfade stall or silent hang |
| Module boundary | Unchanged — timers still in app.js |

**Pros:** Eliminates all boilerplate. Type-safe (one class, tested once). Drop-in replacement.

**Cons:** Timers still in app.js — the module boundary problem persists. Audio error handling still split across two files. Doesn't fix the crossfade stall, silent hang, or music timer orphaning. Reduces symptoms (boilerplate) without addressing cause (split ownership).

### Option B: Encapsulate All Audio Scheduling in audio.js (ADR-003 Fulfillment)

Move all audio timer management into `audio.js`. The module owns scheduling, pause/resume, and error recovery internally. `app.js` calls high-level commands only.

New `audio.js` contract:

```
// Scheduling
scheduleNarration(src, delay, onend, maxDurationMs)
                                     → schedule narration with delay + end callback + safety timeout
scheduleAmbient(src, volume, loop)   → play or crossfade ambient (error-safe: keeps old on failure)
scheduleMusic(config)                → schedule music with enter/exit/crescendo (internal timer chain)
cancelAll()                          → stop everything, clear all internal timers, increment session

// Pause/resume (all internal timers)
pauseAll()                           → freeze all active audio + pending timers
resumeAll()                          → resume from saved state

// Cueing (for paused hardCut / replay-while-paused)
cueNarration(src)                    → load + seek to 0, do NOT play
cueAmbient(src, volume, loop)        → load, do NOT play
cueMusic(src, volume)                → load, do NOT play

// State
setMuted(bool)
onNarrationBufferChange(callback)
preloadNarrationAhead(src)
clearNarrationCache()
```

`audio.js` internally uses `PausableTimer` for narration delay, music enter, and music exit. `app.js` only manages `autoAdvanceTimer` (which is a state-machine concern, not an audio concern).

Audio error recovery moves entirely into `audio.js`:

- `scheduleNarration` owns the safety timeout: if no `end`/`loaderror`/`playerror` fires within `maxDurationMs + 5000ms`, force-call `onend`. `maxDurationMs` derived from a 4-tier fallback chain (see Addendum).
- `scheduleAmbient` with crossfade: on new-ambient failure, cancel old-ambient fade-out (keep current ambient playing instead of fading to silence).
- `scheduleMusic`: entire enter/exit timer chain is internal — no orphaning possible because `pauseAll()` pauses the internal `PausableTimer` instances atomically.
- Buffer stall detection + recovery stays in `audio.js` (already there).

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — ~80 lines of new scheduling logic in audio.js |
| Refactor scope | High — remove 3 timers + 12 state fields from app.js, rewrite doPause/doResume/cleanupCurrentScene audio paths |
| Risk | Medium — touching pause/resume is high-stakes, but simplifies the result |
| Audio error fix | Full — safety timeouts, crossfade error recovery, stall detection all colocated |
| Module boundary | Clean — audio.js owns audio lifecycle, app.js owns state machine |

**Pros:** Fulfills ADR-003's stated contract. app.js `doPause()` audio path drops to `pauseAll()`. app.js `doResume()` audio path drops to `resumeAll()`. app.js `cleanupCurrentScene()` audio path drops to `cancelAll()`. All audio error recovery lives in one file. Crossfade error recovery is possible because audio.js sees both old and new ambient. Music timer orphaning eliminated because audio.js owns the full scheduling chain internally.

**Cons:** Larger refactor surface. audio.js becomes more complex (currently ~400 lines, would grow to ~500). Testing requires mocking Howler internals for timer tests. Risk of pause/resume regression during refactor — mitigated by existing test suite (46 app.js tests, audio.js tests).

### Option C: Hybrid — PausableTimer in app.js + Safety Timeout in audio.js

Use Option A's `PausableTimer` to eliminate boilerplate, PLUS add a safety timeout in `audio.js` `playNarration()`. Don't move timer ownership.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low-Medium |
| Audio error fix | Partial — safety timeout catches silent hangs, but crossfade stall and music orphaning remain |
| Module boundary | Unchanged — timers still in app.js |

**Pros:** Gets 80% of the value with 20% of the risk.

**Cons:** Crossfade error recovery still not addressed. Music timer orphaning still possible. Module boundary still split. Leaves the architecture in a halfway state that contradicts ADR-003's contract.

## Trade-off Analysis

```
Issue                   │ Option A  │ Option B  │ Option C
────────────────────────┼───────────┼───────────┼───────────
Timer boilerplate       │ Fixed     │ Fixed     │ Fixed
Silent audio hang       │ —         │ Fixed     │ Fixed
Crossfade stall         │ —         │ Fixed     │ —
Music timer orphaning   │ —         │ Fixed     │ —
ADR-003 alignment       │ No        │ Yes       │ No
Module boundary clean   │ No        │ Yes       │ No
```

Option C was tempting as a "ship now, fix later" choice. But "fix later" with 18 days to deadline means "never." The audio branch is the next work stream — if the timer logic isn't encapsulated when that work starts, the new audio features (ambient per-scene, anchor resolution) will add *more* timer state to app.js, making Option B harder to do later. The right time to do this is now, before the audio branch adds complexity on top of the split.

## Decision

**Option B: Full encapsulation of audio scheduling in audio.js.**

`audio.js` owns all audio timer lifecycle — scheduling, pause, resume, cancel, and error recovery. `app.js` calls high-level methods only. `autoAdvanceTimer` stays in `app.js` because it's a state-machine concern (it calls `advance()`), not an audio concern.

### PausableTimer Utility

Used internally by `audio.js` for narration delay, music enter, and music exit timers. Also used by `app.js` for `autoAdvanceTimer`. Shared utility, not module-specific.

Uses `performance.now()` for monotonic time — `Date.now()` can shift on NTP adjustments or manual clock changes, causing negative elapsed values or premature timer fires.

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
    this.#start = performance.now();
    this.#id = setTimeout(() => {
      this.#id = null;
      this.#start = null;
      this.#remaining = null;
      this.#callback();
    }, delay);
  }

  pause() {
    if (this.#id === null) return;
    const elapsed = performance.now() - this.#start;
    this.#remaining = Math.max(0, this.#delay - elapsed);
    clearTimeout(this.#id);
    this.#id = null;
    this.#start = null;
  }

  resume() {
    if (this.#remaining === null || this.#remaining <= 0) return;
    this.#delay = this.#remaining;
    this.#start = performance.now();
    this.#id = setTimeout(() => {
      this.#id = null;
      this.#start = null;
      this.#remaining = null;
      this.#callback();
    }, this.#remaining);
    this.#remaining = null;
  }

  cancel() {
    if (this.#id !== null) clearTimeout(this.#id);
    this.#id = null;
    this.#start = null;
    this.#delay = null;
    this.#remaining = null;
  }

  get isActive() { return this.#id !== null; }
  get isPaused() { return this.#remaining !== null && this.#remaining > 0; }
}
```

### Cancelable Scene Session

`audio.js` tracks an internal session counter. `cancelAll()` increments it. All scheduled callbacks capture `sessionId` at creation time and check it before executing. This prevents stale callbacks from firing after scene transitions — the generation guard in `app.js` only blocks auto-advance scheduling, not the Howl creation itself.

```js
let sessionId = 0;

export function cancelAll() {
  sessionId++;
  // cancel all internal PausableTimers + safety timers
  // stop all audio
}

// Every scheduled callback:
const mySession = sessionId;
const startPlayback = () => {
  if (mySession !== sessionId) return;  // session cancelled
  // ... proceed
};
```

### Play Gate = Hard No-Play Boundary

No audio of any kind plays before play gate dismissal. All scheduling respects this via `app.cueOnly`. Documented as an architectural constraint for the upcoming ambient branch: ambient audio must also obey the play gate.

### Narration Safety Timeout

Inside `audio.js` `scheduleNarration()`:

```js
const SAFETY_MARGIN_MS = 5000;

export function scheduleNarration(src, delay, onend, maxDurationMs) {
  const mySession = sessionId;
  let ended = false;

  const safeEnd = () => {
    if (ended) return;
    ended = true;
    clearNarrationSafetyTimer();
    if (onend) onend();
  };

  const startPlayback = () => {
    if (mySession !== sessionId) return;  // session cancelled
    playNarration(src, safeEnd);

    if (maxDurationMs > 0) {
      narrationSafetyTimer = setTimeout(() => {
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
```

### Crossfade Error Recovery

Inside `audio.js` `scheduleAmbient()`. Key fixes from original ADR draft:

1. **Set up `oldFadeTimer` before `play()`** — prevents race where error fires before timer is assigned
2. **Track `oldUnloaded` boolean** — prevents restoring an already-unloaded Howl
3. **Guard `currentAmbient` ownership** — only restore old if `currentAmbient === newHowl` (prevents overwriting a third ambient that was scheduled)

```js
let oldAmbientRef = null;       // Howl being faded out
let oldAmbientFadeTimer = null; // unload timer for old ambient

function cancelOldAmbientFade() {
  if (oldAmbientFadeTimer) { clearTimeout(oldAmbientFadeTimer); oldAmbientFadeTimer = null; }
  oldAmbientRef = null;
}

export function scheduleAmbient(newSrc, volume, durationMs, loop = true) {
  const mySession = sessionId;
  const oldAmbient = currentAmbient;
  let oldUnloaded = false;

  // Set up old ambient fade-out FIRST (before play)
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

  const newHowl = new Howl({
    src: [newSrc], volume: 0, loop, html5: true, mute: globalMuted,
    onloaderror: (_id, err) => {
      console.warn(`Failed to load ambient: ${newSrc}`, err);
      // Only restore old if WE still own currentAmbient and old isn't unloaded
      if (currentAmbient === newHowl && !oldUnloaded && oldAmbient) {
        if (oldAmbientFadeTimer) { clearTimeout(oldAmbientFadeTimer); oldAmbientFadeTimer = null; }
        oldAmbient.fade(oldAmbient.volume(), volume, 200);
        currentAmbient = oldAmbient;
        oldAmbientRef = null;
      }
    },
    onplayerror: (_id, err) => {
      console.warn(`Failed to play ambient: ${newSrc}`, err);
      if (currentAmbient === newHowl && !oldUnloaded && oldAmbient) {
        if (oldAmbientFadeTimer) { clearTimeout(oldAmbientFadeTimer); oldAmbientFadeTimer = null; }
        oldAmbient.fade(oldAmbient.volume(), volume, 200);
        currentAmbient = oldAmbient;
        oldAmbientRef = null;
      }
    },
  });

  currentAmbient = newHowl;
  currentAmbient.play();
  currentAmbient.fade(0, volume, durationMs);
}
```

### pauseAll / resumeAll — In-Flight Fade Handling

Old ambient mid-crossfade must be paused when user pauses, and snapped to target (0) on resume to avoid stale fades lingering:

```js
export function pauseAll() {
  narrationDelayTimer?.pause();
  musicEnterTimer?.pause();
  musicExitTimer?.pause();
  pauseNarration();
  pauseAmbient();
  pauseMusic();
  // Pause old ambient mid-crossfade
  if (oldAmbientRef) oldAmbientRef.pause();
  if (oldAmbientFadeTimer) {
    clearTimeout(oldAmbientFadeTimer);
    oldAmbientFadeTimer = null;
  }
}

export function resumeAll() {
  narrationDelayTimer?.resume();
  musicEnterTimer?.resume();
  musicExitTimer?.resume();
  resumeNarration();
  resumeAmbient();
  resumeMusic();
  // Snap old ambient to target (0) and unload — don't resume a stale fade
  if (oldAmbientRef) {
    oldAmbientRef.volume(0);
    oldAmbientRef.unload();
    oldAmbientRef = null;
  }
}
```

### app.js Changes

**Removed from app.js state:**
- `narrationTimer`, `narrationTimerStart`, `narrationTimerDelay`, `narrationTimerRemaining`
- `musicTimer`, `musicTimerStart`, `musicTimerDelay`, `musicTimerRemaining`
- `musicExitTimer`, `musicExitTimerStart`, `musicExitTimerDelay`, `musicExitTimerRemaining`

**Kept in app.js (using PausableTimer):**
- `autoAdvanceTimer` → replaced with `PausableTimer` instance

**app.js audio calls become:**

```js
// doPause — audio path
pauseAll();  // replaces pauseNarration + pauseAmbient + pauseMusic + save 3 timer remainders

// doResume — audio path (normal)
resumeAll(); // replaces resumeNarration + resumeAmbient + resumeMusic + resume 3 timer remainders

// doResume — replayPending path
scheduleNarration(src, delay, onend, maxDurationMs);  // wires fresh onend
resumeAmbient();
resumeMusic();

// cleanupCurrentScene — audio path
cancelAll(); // replaces stopNarration + stopMusic + clear 3 timers + clear 3 remainders

// showFrame — audio path
scheduleNarration(src, delay, onend, maxDurationMs);  // instead of raw playNarration + setTimeout
scheduleAmbient(src, volume, loop);
scheduleMusic(config);

// showFrame — cueOnly path (unchanged)
cueNarration(src);
cueAmbient(src, volume, loop);
cueMusic(src, volume);
```

## Consequences

**What becomes easier:**

- `doPause()` audio path: one call (`pauseAll()`) instead of 6 calls + 3 timer save blocks
- `doResume()` audio path: one call (`resumeAll()`) instead of 6 calls + 3 timer resume blocks
- `cleanupCurrentScene()` audio path: one call (`cancelAll()`) instead of 3 stops + 3 timer clears + 3 remainder clears
- All audio error recovery colocated — safety timeout, crossfade recovery, buffer stall in one file
- Music timer orphaning eliminated — internal timer chain, atomic pause/resume
- Adding new audio features (ambient per-scene, SFX, anchor resolution) doesn't add state to app.js

**What becomes harder:**

- audio.js grows from ~400 to ~500 lines — more complex module
- Timer-related tests move from app.js to audio.js — need Howler mocking for scheduling tests
- `PausableTimer` is a new shared utility — but it's ~40 lines with clear semantics

## Action Items

1. [ ] Implement `PausableTimer` utility in `src/pausable-timer.js` (standalone, unit tested)
2. [ ] Refactor `audio.js`: add `scheduleNarration`, `scheduleAmbient`, `scheduleMusic`, `pauseAll`, `resumeAll`, `cancelAll` using internal `PausableTimer` instances with session model
3. [ ] Add narration safety timeout to `scheduleNarration` with 4-tier `maxDurationMs` fallback chain
4. [ ] Add crossfade error recovery to `scheduleAmbient` — cancel old-ambient fade on new-ambient failure, ownership guard, oldUnloaded tracking
5. [ ] Refactor `app.js`: remove 12 timer state fields, replace `doPause`/`doResume`/`cleanupCurrentScene` audio paths with high-level calls
6. [ ] Replace `autoAdvanceTimer` fields with `PausableTimer` instance in app.js
7. [ ] Expose duration from `loader.js` `preloadAudio()` for metadata-based timing authority
8. [ ] Update tests: move timer scheduling tests from app.test.js to audio.test.js
9. [ ] Update v5 spec §3, §5.2, §5.7, §14, §17 to reflect new architecture

---

## Addendum: Duration Authority and Anchor Resolution Strategy

This does not warrant a separate ADR — it's a refinement of ADR-003's anchor resolution design, corrected from the original draft.

### Problem

ADR-003 specifies `enter: { ref: "narration", offset: -5000 }` to anchor one cue's timing to another cue's duration. Since Howler with `html5: true` streams audio, `howl.duration()` may return `0` until enough data is buffered. The current `loader.js` uses `Audio()` with `preload: 'metadata'` and a 5-second timeout — if metadata hasn't loaded, the duration is unknown.

The original draft of this ADR recommended caption-derived duration as the sole source. This was flawed: caption end times are approximate (when the caption *disappears*, not when audio *ends*), and the safety timeout was skipped when captions were absent. Both problems are corrected below.

### Resolution: 4-Tier Fallback Chain (Option B — Metadata with Fallback)

`maxDurationMs` is used both for anchor resolution and narration safety timeout. It is computed via a 4-tier fallback chain — the safety timeout is **never** skipped:

```
Tier 1: Metadata duration from loader.js preload (most accurate)
         → loader.js resolves { src, duration } from Audio.loadedmetadata
         → app.js stores in audioDurations map
         → Duration in ms: metadata * 1000

Tier 2: Frame caption max (authored data, always available when captions exist)
         → Math.max(...frame.narration.captions.map(c => c.end))

Tier 3: Project-wide caption max (computed at startup across all frames)
         → provides a reasonable upper bound even for frames without captions

Tier 4: 60000ms floor (absolute safety net — no narration should exceed 60s)
```

**Key rule:** The safety timeout is always set. If all tiers return 0 or are unavailable, the 60s floor ensures the scene never hangs.

```js
function getMaxNarrationDuration(narration, audioDurations) {
  // Tier 1: metadata
  const metaDuration = audioDurations?.get(narration.audio);
  if (metaDuration > 0) return metaDuration * 1000;

  // Tier 2: frame captions
  if (narration.captions?.length > 0) {
    return Math.max(...narration.captions.map(c => c.end));
  }

  // Tier 3: project-wide max (computed at startup, passed by app)
  // Falls through to tier 4 if projectMaxCaptionMs is 0

  // Tier 4: floor
  return 60000;
}
```

This applies to ADR-003 Action Item #3 ("Implement anchor resolution with duration metadata") — use metadata as primary source with caption fallback.

---

## Appendix: Implementation Hazards (Verified March 18, 2026)

The following issues were flagged during review and verified against the codebase. Documented here because they interact with the timer and audio systems this ADR addresses.

### [P0] ADR-004 Replay Behavior — ✅ RESOLVED (branch `docs/adr-004-option-b-alignment`)

**Original issue:** Code implemented Option A (auto-resume + auto-advance). ADR-004 mandates Option B (stay paused, hard jump reset with `replayPending`).

**Resolved in commits:** `dcf219e` (tests), `83c861c` (ADR-004 docs), `9e3906c` (v5 spec). Code now correctly implements Option B: `replayNarration()` stays paused, sets `cueOnly`, sets `replayPending`. `doResume()` checks `replayPending` and calls `scheduleNarrationAudio()` to wire fresh `onend`. `cleanupCurrentScene()` clears the flag. Tests assert state stays `PAUSED` after replay.

**Remaining v5 spec gap:** The repo's v5 `doResume()` section (§5.7, line 471) is bullet-point-only — it doesn't show the `replayPending` branching logic. The output v5 has this (§5.8, lines 516-534). The repo v5 should be updated to include the `doResume()` pseudocode.

### [P1] Stage Click Advance Handler — ✅ RESOLVED (branch `docs/adr-004-option-b-alignment`)

**Original issue:** Code had `document.addEventListener('click', ... advance(app))`. v4 spec and E2E test said stage click should NOT advance. v5 spec contradicted both.

**Resolved in commits:** `f5a41d4` (removed click→advance handler), `dcf219e` (hardened E2E test), `496545b` (aligned docs). Stage click is now reserved for visual effects. No document-level click handler exists. Navigation is exclusively via buttons, dots, and keyboard.

### [P1] validateEffects — Issue Withdrawn

**Claim:** No startup `validateEffects()` despite v5 mention.

**Verified:** Incorrect. `validateEffects()` exists at app.js:60-73 and is called at app.js:1077 in `createApp()`. The v5 spec is accurate.

**No action needed.** The original flag was wrong.

---

## Updated Action Items (incorporating hazards)

1. [x] **[P0]** ~~Implement ADR-004 replay-while-paused (Option B)~~ — resolved in `docs/adr-004-option-b-alignment`
2. [x] **[P1]** ~~Remove stage click advance handler~~ — resolved in `docs/adr-004-option-b-alignment`
3. [ ] **[P1]** Update repo v5 spec `doResume()` section to include `replayPending` branching pseudocode
4. [ ] Implement `PausableTimer` utility in `src/pausable-timer.js` (unit tested)
5. [ ] Refactor `audio.js` with session model + scheduling API + safety timeout + crossfade recovery
6. [ ] Refactor `app.js`: remove 12 timer state fields, replace audio paths with high-level calls
7. [ ] Expose duration from `loader.js` `preloadAudio()` for metadata-based timing authority
8. [ ] Update tests: scheduling + session + safety + crossfade tests
9. [ ] Update v5 spec §3, §5.2, §5.7, §14, §17 to reflect new architecture
