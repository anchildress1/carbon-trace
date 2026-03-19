# carbon-trace — System Design v5

**Project:** WeCoded 2026 Frontend Art Entry
**Author:** Ashley Childress (@anchildress1)
**Deadline:** April 5, 2026 @ 11:59 PM PDT
**Supersedes:** v4 — reconciled with implementation as of PR #8 (feat/canvas-effects)

---

## 1. Tech Stack

- **Build:** Vite
- **Rendering:** Canvas 2D (GSAP animates DOM, rAF animates canvas)
- **Animation:** GSAP
- **Audio:** Howler.js (html5 mode — streaming, not full preload)
- **Overlay:** Vanilla HTML/CSS (~25 DOM elements, no framework)
- **Images:** Leonardo AI (Flux 2 Pro), painterly/impressionistic, WebP
- **Deploy:** Cloud Run + nginx + GitHub Actions

---

## 2. Project Structure

```
carbon-trace/
├── index.html
├── vite.config.js
├── package.json
├── src/
│   ├── main.js                 # Entry — calls createApp()
│   ├── scenes.json             # All 12 frame definitions
│   ├── app.js                  # State machine, orchestrator
│   ├── canvas.js               # Scene image drawing, cover-fit, resize
│   ├── effects-canvas.js       # Effects overlay canvas, render loop
│   ├── audio.js                # Howler — narration, ambient, music, buffer recovery
│   ├── text.js                 # Ghost-drift text + caption entries — GSAP timelines
│   ├── captions.js             # Timed captions, localStorage persistence
│   ├── effects.js              # Effect registry — no-op skeleton (v2)
│   ├── overlay.js              # DOM controls — progress dots, buttons
│   └── loader.js               # Audio metadata preloading (sequential by scene)
├── public/
│   └── assets/
│       ├── images/             # 12 WebP scenes (16:9, 1536×824)
│       ├── audio/narration/    # Per-scene narration (.m4a)
│       ├── audio/sfx/          # End song
│       └── fonts/
├── Dockerfile
├── nginx.conf
└── .github/workflows/deploy.yml
```

---

## 3. Module Contracts

```
app.js → canvas, effects-canvas, effects, audio, text,
         captions, overlay, loader, scenes.json

All leaf modules → nothing (no cross-imports, no cycles)
app.js is the ONLY module that knows frame ordering.
All other modules receive config objects, not frame indices.
```

### canvas.js

```
initSceneCanvas(el)        → throws on context failure
drawImage(img)             → cover-fit, centered
clearScene()
drawFallback()             → solid color frame on image failure
loadImage(src)             → cached Promise<Image>, evicts on failure, concurrent-safe
getSceneContext()          → exposes ctx for effects
destroySceneCanvas()       → cleanup
```

DPR-aware sizing via ResizeObserver. Redraws current image on resize.

Image cache is a `Map<string, Promise<Image>>`. Concurrent calls for the same src share one in-flight request. Failed loads resolve to `null` and are evicted so retries work.

### effects-canvas.js

```
initCanvas(el)             → throws on context failure
resume() / pause()         → render loop control
clearAll()                 → pause + clear canvas
destroy()                  → cleanup
isRunning()                → boolean
```

DPR-aware. Respects `prefers-reduced-motion` — render loop self-stops when reduced motion is active.

### audio.js

```
// Scheduling API (ADR-005 session model)
scheduleNarration(src, delay, onend, maxDurationMs) → delayed playback + safety timeout
scheduleAmbient(src, volume, durationMs, loop)      → crossfade with error recovery
scheduleMusic(config)                               → internal enter/exit timer chain
pauseAll()                                          → freeze all audio + pending timers
resumeAll()                                         → resume from saved state
cancelAll()                                         → increment session, clear all, stop audio

// Low-level playback (used internally by scheduling API)
playAmbient(src, volume, loop)           → start ambient track
crossfadeAmbient(newSrc, volume, ms, loop) → fade out old, fade in new
playNarration(src, onend)                → play narration with end callback
cueNarration(src)                        → load + seek to 0, do NOT play (for hardCut)
cueAmbient(src, volume, loop)            → load, do NOT play
cueMusic(src, volume)                    → load, do NOT play
stopNarration()                          → stop + unload current narration
pauseNarration() / resumeNarration()
pauseAmbient() / resumeAmbient()
playMusic(src, volume)                   → start music track
fadeMusic(toVolume, durationMs)          → volume transition
pauseMusic() / resumeMusic()
stopMusic()                              → stop + unload
stopAll()                                → unload everything
setMuted(bool)                           → global mute (affects volume, not playback)
onNarrationBufferChange(callback)        → register buffer state listener
preloadNarrationAhead(src)               → pre-create Howl for next scene
clearNarrationCache()                    → unload ahead-of-time cache
```

All Howl instances use `html5: true` for streaming. Narration uses `preloadNarrationAhead` for one-scene-ahead buffering. Ambient and music create new Howl instances per scene (old instances unloaded after crossfade).

**Session model (ADR-005):** Internal `sessionId` counter. `cancelAll()` increments it. All scheduled callbacks capture sessionId at creation and check before executing, preventing stale playback after scene transitions.

**Narration safety timeout:** `scheduleNarration` sets a safety timer at `maxDurationMs + 5000ms`. If no `end`/`loaderror`/`playerror` fires, force-stops narration and calls `onend`. `safeEnd` deduplicates — callback fires at most once. Duration authority is a 4-tier fallback chain: metadata → frame captions → project-wide max → 60s floor. Safety is never skipped.

**Crossfade error recovery:** `scheduleAmbient` tracks old ambient during crossfade. On new ambient load/play error: cancels old fade-out, restores old ambient volume, guards ownership to prevent overwriting a third ambient.

**Music timer chain:** `scheduleMusic` owns enter delay and exit fade timers internally via `PausableTimer`. `pauseAll()`/`resumeAll()` handle them atomically — no orphaning possible.

**Buffer recovery:** `monitorNarrationBuffer()` attaches `waiting`/`playing` event listeners to the underlying HTML5 audio node. On stall: tracks buffered ranges, attempts nudge-seek after 2 checks, full reload after 4 checks, gives up after 3 recovery attempts. Visual indicator via `.scene-stage.buffering` CSS class.

**Mute:** Affects `howl.mute()`, not `howl.volume()`. `'end'` events still fire when muted. Auto-advance works while muted.

**Audio failure graceful degradation:** Both `onloaderror` and `onplayerror` call the `onend` callback, which triggers the auto-advance chain. If narration fails to load/play, the scene still advances.

### text.js

```js
function buildNarrationTimeline(lines, container, opts) {
  // opts: { reducedMotion, captions, captionContainer, captionDelay, isCaptionEnabled }
  // Returns: { timeline: GSAPTimeline (paused), captionEntries: [] }
}

function clearNarrationLayer(container) {
  // kills tweens, removes all children
}
```

Lines are absolutely positioned via `x` (vw), `y` (vh), `align` (left/center/right). Ghost-drift animation: blur(4px) + y:18 → clear + y:0 on enter; blur(3px) + y:-10 → gone on exit. Reduced motion: simple opacity fade, no spatial movement.

Caption entries are GSAP `tl.call()` callbacks at `startSec`/`endSec` that create/remove caption DOM elements. `isCaptionEnabled` function is checked at callback time, enabling mid-scene caption toggle.

### captions.js

```
initCaptions()                    → read localStorage, return enabled state
setCaptionsEnabled(bool)          → write localStorage + update state
areCaptionsEnabled()              → return current state
syncCaptionsToTime(entries, timeSec, container) → show correct caption for current time
clearCaptionElements(entries)     → remove all active caption DOM elements
```

### effects.js (v2 placeholder)

```
effectExists(name)                → boolean — checks registry
runEffect(name, effectsCanvas, sceneCanvas) → execute or warn + no-op
clearEffects()                    → no-op until implementations exist
```

Effect registry is `const effects = {}`. All scene references (dust-drift, heat-pulse, etc.) no-op with console warning until implementations are registered. `validateEffects()` in app.js logs all missing effects at startup.

### overlay.js

```
initOverlay(sceneCount, onDotClick)  → create progress dots
updateProgress(sceneIndex)           → update active dot
showControls()                       → unhide overlay
```

Progress dots map to scene indices (excludes title frame). Each dot is a `<button>` with `aria-label`, `aria-current="step"` on active.

### loader.js

```
preloadAudio(src)                    → Promise<{src, duration}>, metadata-only, 5s timeout
audioSrcsFromEntry(frame)            → extract all audio srcs from frame config
preloadFirstFrameAudio(frames, onLoaded) → preload frame 0 audio immediately
preloadBackgroundAudio(frames, onLoaded) → sequential by scene, skips first frame
```

Uses native `Audio()` elements with `preload: 'metadata'` — lightweight, no Howler overhead. Returns `{ src, duration }` where duration is from `audio.duration` after `loadedmetadata` (used as Tier 1 in narration safety timeout fallback chain). Timeout prevents stalled loads from blocking the pipeline.

---

## 4. Frame Configuration

### 4.1 Schema

Every frame has identical shape via `meta.frameDefaults` merge. `null` = skip feature.

```jsonc
{
  "meta": {
    "title": "carbon-trace",
    "author": "Ashley Childress",
    "aspectRatio": "16:9",
    "defaultTransition": { "type": "fade", "duration": 1200 },
    "defaultHoldAfterNarration": 2000,
    "frameDefaults": {
      "textMode": "ghost-drift"
    }
  },
  "frames": [
    {
      "id": "scene-01-seam",
      "frameType": "scene",
      "holdUntilClick": false,
      "holdAfterNarration": 2000,
      "description": "Coal seam wall, lamp upper left — carbon buried under pressure",
      "image": "assets/images/scene-01-seam.webp",
      "narration": {
        "lines": [
          { "text": "...", "enter": 2000, "exit": 5000, "x": 10, "y": 70, "align": "left" }
        ],
        "captions": [
          { "text": "...", "start": 0, "end": 5000 }
        ],
        "audio": "assets/audio/narration/01-seam.m4a",
        "delay": 500
      },
      "ambient": {
        "src": "assets/audio/ambient/scene-01-seam.mp3",
        "volume": 0.15,
        "loop": true
      },
      "music": null,
      "effects": { "idle": "dust-drift", "entry": "fade-in" },
      "transition": { "type": "fade", "duration": 1200 },
      "traceOverlay": { "opacity": 0.05 }
    }
  ]
}
```

### 4.2 narration Object

```
FIELD    │ TYPE            │ DESCRIPTION
─────────┼─────────────────┼──────────────────────────────────────
lines    │ array           │ Ghost-drift text lines with enter/exit/x/y/align
captions │ array           │ Timed caption entries with text/start/end (ms)
audio    │ string | null   │ Narration audio asset path. null = no narration audio
delay    │ number          │ ms delay before narration audio starts
```

`narration: null` = no narration at all (no text, no audio, no captions).

`narration.audio: null` = text + captions but no audio (Scene 8: silence with ghost-drift text).

### 4.3 ambient Object

```
FIELD    │ TYPE            │ DESCRIPTION
─────────┼─────────────────┼──────────────────────────────────────
src      │ string          │ Ambient audio asset path
volume   │ number          │ Target volume (0.0–1.0)
loop     │ boolean         │ Loop playback (default true)
```

`ambient: null` = no ambient audio for this frame.

First frame uses `playAmbient()` (direct start). All subsequent frames use `crossfadeAmbient()` (fade out old, fade in new over 800ms).

### 4.4 music Object (Scene 11 only)

```
FIELD        │ TYPE            │ DESCRIPTION
─────────────┼─────────────────┼──────────────────────────────────────
src          │ string          │ Music audio asset path
enter        │ number          │ ms after scene entry to begin playback
exit         │ number | null   │ ms after scene entry to begin fade-out. null = no auto-fade.
startVolume  │ number          │ Initial volume for fade-in start
fullVolume   │ number          │ Target volume after crescendo
crescendoMs  │ number          │ Duration of volume ramp from startVolume to fullVolume
```

Music is a separate audio channel from ambient and narration. Pause/resume/timer-remaining all tracked independently.

### 4.5 holdUntilClick Map

```
FRAME                │ holdUntilClick │ holdAfterNarration
─────────────────────┼────────────────┼────────────────────
00 Title             │ true           │ null
01 Seam              │ false          │ 2000
02 Travel            │ false          │ 2000
03 Reach             │ false          │ 3000
04 Pocket            │ false          │ 2000
05 Rinse             │ false          │ 2500
06 Storage           │ false          │ 2000
07 Empty             │ false          │ 2000
08 Stillness         │ true           │ null
09 Return            │ false          │ 2000
10 Building          │ false          │ 3000
11 Music             │ null           │ null
```

### 4.6 Audio Hierarchy

```
1. Narration (loudest, volume: 1.0)
2. Emotional silence (narration.audio: null, ambient: null)
3. Ambient texture (volume: 0.08–0.20, loop: true)
4. End song (music channel, crescendo to 0.25)
```

---

## 5. State Machine (app.js)

### 5.1 States

```js
const State = Object.freeze({
  LOADING: 'LOADING',
  SCENE_ACTIVE: 'SCENE_ACTIVE',
  TRANSITIONING: 'TRANSITIONING',
  PAUSED: 'PAUSED',
  CREDITS: 'CREDITS',
});
```

### 5.2 App State Object

```js
const app = {
  frames,                    // from scenes.json with frameDefaults applied
  sceneMap,                  // { byFrame: Map<frameIdx, sceneIdx>, byScene: Map<sceneIdx, frameIdx> }
  currentIndex: 0,
  state: State.LOADING,
  muted: false,
  paused: false,
  pausedFromState: null,     // state to restore on resume
  userHasInteracted: false,  // play-gate flag
  generation: 0,             // incremented on every navigation — guards stale callbacks
  cueOnly: false,            // true during hardCut — audio cued, not played
  replayPending: false,      // replay happened while paused — doResume schedules fresh narration
  pendingPause: false,       // pause queued during transition
  pendingNavIndex: null,     // navigation queued during transition
  buffering: false,          // narration buffer stall active
  textTimeline: null,        // current GSAP timeline
  captionEntries: [],        // active caption DOM entries
  imageCache: new Map(),     // src → Image
  availableAudio: new Set(), // preloaded audio srcs
  audioDurations: new Map(), // src → duration in seconds (from loader.js metadata preload)
  projectMaxCaptionMs: 0,    // max caption end time across all frames (computed at startup)

  // Timer — PausableTimer instance (auto-advance is a state machine concern, stays in app.js)
  // All audio timers (narration delay, music enter/exit) are internal to audio.js (ADR-005)
  autoAdvanceTimer: null,    // PausableTimer | null
};
```

### 5.3 transition(app, toIndex)

```
transition(toIndex):
  if TRANSITIONING:
    pendingNavIndex = toIndex     // queue — executed after current transition
    return

  wasPaused = app.paused
  if paused: clearPauseState()

  state = TRANSITIONING
  generation++
  cleanupCurrentScene()           // clear all timers, kill timelines, stop audio

  if wasPaused:
    hardJump(toIndex)             // instant — drawImage, cueOnly, re-pause
  else if prefersReducedMotion:
    instantSwap(toIndex)          // no animation, immediate showFrame + land
  else:
    gsapFade(toIndex)             // fade out → showFrame → fade in → land
```

**Animated transition (playing):**

```
time ──────────────────────────────────────────────►

GSAP fade out      ████████████░░░░░░░░░░░░░░░░░░░
showFrame          ░░░░░░░░░░░░█░░░░░░░░░░░░░░░░░░
GSAP fade in       ░░░░░░░░░░░░████████████░░░░░░░░
land on frame      ░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░
  → set state      ░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░
  → play text tl   ░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░
  → auto-advance   ░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░
  → pending pause  ░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░
  → pending nav    ░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░
```

Transition uses GSAP opacity fade on the `#scene-stage` container — NOT offscreen canvas compositing. The container fades to 0, frame content swaps, container fades back to 1. Simpler than v4's planned offscreen approach, works correctly with DOM overlay.

**Image wait:** If the target frame's image isn't cached, a debounced spinner appears after 300ms. Preload-ahead usually prevents this.

### 5.4 hardJump(toIndex) — paused

```
drawImage(toImg)                → instant, no crossfade
set cueOnly = true
showFrame(toIndex)              → renders image, builds text/captions, cues audio (not playing)
set cueOnly = false
doPause()                       → freeze everything
```

No lock. No timer. No animation. Scene lands paused and frozen.

### 5.5 scheduleAutoAdvance

```js
function setupAutoAdvance(app) {
  clearAutoAdvance(app);
  const frame = app.frames[app.currentIndex];
  if (!shouldAutoAdvance(app, frame)) return;

  const holdAfterNarration = frame.holdAfterNarration
    ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;

  if (!frame.narration?.audio) {
    // No narration audio — schedule immediately on landing
    scheduleAutoAdvance(app, holdAfterNarration);
  }
  // With narration audio — Howler 'end' callback triggers scheduleAutoAdvance
}

function shouldAutoAdvance(app, frame) {
  if (frame.holdUntilClick === true || frame.holdUntilClick === null) return false;
  if (app.currentIndex >= app.frames.length - 1) return false;
  return true;
}
```

Narration `onend` callback:

```js
const gen = app.generation;
const onend = () => {
  if (gen !== app.generation) return;          // stale — rapid navigation
  if (shouldAutoAdvance(app, frame)) {
    scheduleAutoAdvance(app, holdAfterNarration);
  }
};
```

### 5.6 Play Gate

Experience starts paused behind a full-screen "click to begin" button (`#play-gate`). This serves two purposes:

1. **Mobile audio context unlock:** The first user gesture enables the AudioContext via Howler's internal unlock.
2. **LCP optimization:** The play-gate label text serves as the Lighthouse LCP element.

On click: `togglePause()` → `doResume()` → `handleFirstPlay()` which triggers narration and auto-advance for the first frame.

### 5.7 togglePause()

```
if LOADING: return
if TRANSITIONING:
  pendingPause = !pendingPause    // toggle queued intent
  return

if paused:
  doResume()
else:
  doPause()
```

**doPause():**
- Set `paused = true`, `pausedFromState = current state`, `state = PAUSED`
- `pauseAll()` — freezes all audio + internal timers (narration delay, music enter/exit, old ambient crossfade)
- Pause text timeline, effects canvas
- `autoAdvanceTimer?.pause()` — saves remaining auto-advance time

**doResume():**
- Restore `pausedFromState`, clear pause

```
if replayPending:
  replayPending = false
  scheduleNarrationAudio(frame.narration)   // fresh onend for auto-advance
  resumeAmbient()                           // resume — not resumeAll (narration is fresh)
  resumeMusic()
  textTimeline.play(0)                      // restart from beginning
  setupAutoAdvance()
else:
  resumeAll()                               // resume all audio + internal timers
  textTimeline.resume()
```

- Resume effects canvas
- `autoAdvanceTimer?.resume()` — reschedule with saved remaining
- If first interaction: hide play-gate, trigger `handleFirstPlay()`

### 5.8 replayNarration() — ADR-004

```
replayNarration(app):
  if TRANSITIONING or LOADING: return

  userHasInteracted = true

  if paused:
    // Hard jump reset — same pattern as paused navigation
    stopNarration()
    clear narration timer
    clearAutoAdvance()

    cueOnly = true
    buildNarration(app, frame)      // cues audio (loaded, not playing), builds timeline
    cueOnly = false

    replayPending = true            // doResume will schedule fresh narration with onend
    if textTimeline: textTimeline.pause(0)   // reset to start, stay paused

    // Stay paused. No state change. User presses play to hear.
    return

  // --- Playing path (unchanged) ---
  clearAutoAdvance()
  clear narration timer
  buildNarration(app, frame)        // plays audio immediately
  if textTimeline: textTimeline.play(0)
  setupAutoAdvance(app)
  run entry effect (if defined)
```

**Key rule:** While paused, replay is a hard jump — same as paused navigation. No unpause, no audio playback, no auto-advance. The scene resets to its starting state and waits for the user to press play. See ADR-004 for full rationale.

### 5.9 Buffering

When narration audio stalls mid-playback:

1. `audio.js` detects `waiting` event on HTML5 audio node
2. Calls `bufferChangeCallback(true)` → app adds `.buffering` class to stage (CSS spinner)
3. Text timeline pauses (if not already paused by user)
4. Buffer recovery attempts: nudge-seek → full reload → give up after 3 attempts
5. On `playing` event: remove `.buffering`, resume text timeline

---

## 6. Input Handling

```
INPUT              │ DESKTOP              │ MOBILE             │ EFFECT
───────────────────┼──────────────────────┼────────────────────┼─────────────────────
Scene interaction  │ Click / hover stage  │ Tap on stage       │ trigger visual effects (v2)
Navigate to scene  │ Click dot            │ Tap dot            │ transition(dotFrameIdx)
Forward            │ Click ► / Arrow → / Enter │ Tap ►         │ advance(cur+1)
Back               │ Click ◄ / Arrow ←    │ Tap ◄              │ retreat(cur-1)
Play/Pause         │ Click ⏯ / Space      │ Tap ⏯              │ togglePause()
Replay narration   │ Click replay btn     │ Tap replay btn     │ replayNarration()
Mute/unmute        │ Click mute btn       │ Tap mute btn       │ toggleMute()
Captions on/off    │ Click CC btn         │ Tap CC btn         │ toggleCaptions()
Play gate          │ Click play gate      │ Tap play gate      │ togglePause() (first play)
Tab to controls    │ Tab                  │ —                  │ focus management
Auto-advance       │ (internal)           │ (internal)         │ advance(cur+1)
```

- **Stage click/tap does NOT navigate** — reserved for visual effects (hover text, particle triggers). Mobile has no hover, so tap is the mobile equivalent for triggering scene interactions. Navigation is exclusively via buttons, dots, and keyboard.
- TRANSITIONING: navigation queued as pendingNavIndex, pause queued as pendingPause
- PAUSED: hardJump — no lock, rapid dot-clicking works
- CREDITS: advance disabled (`holdUntilClick === null`)
- holdUntilClick scenes: no auto-advance, forward button still navigates

---

## 7. UI Overlay

### 7.1 HTML Structure

```html
<div id="app" role="application" aria-label="carbon-trace visual narrative">
  <div id="loading-screen" role="status" aria-label="Loading carbon-trace">
    <!-- SVG trace animation + title -->
  </div>

  <div id="scene-stage" hidden>
    <canvas id="scene-canvas" aria-hidden="true"></canvas>
    <div id="trace-overlay"></div>
    <canvas id="effects-canvas" aria-hidden="true"></canvas>
    <div id="narration-layer" aria-hidden="true"></div>
    <div id="caption-layer" aria-hidden="true"></div>
  </div>

  <button id="play-gate" hidden aria-label="Begin experience">
    <!-- SVG play icon + "click to begin" label -->
  </button>

  <div id="transition-loader" hidden aria-hidden="true"></div>

  <div id="overlay-controls" hidden>
    <nav id="progress-dots" aria-label="Scene progress"></nav>
    <div class="control-buttons">
      <!-- btn-prev, btn-pause, btn-mute, btn-captions, btn-replay, btn-next -->
    </div>
  </div>

  <div class="sr-only" aria-live="polite" id="accessible-narration"></div>
</div>
```

### 7.2 Controls

```
ELEMENT          │ FUNCTION                        │ NOTES
─────────────────┼─────────────────────────────────┼────────────────────
Back button      │ retreat()                       │ Disabled on frame 0
Forward button   │ advance()                       │ Disabled on last frame / credits
Progress dots    │ transition(frameIndex)          │ Dots = scenes only (excludes title)
Play/Pause btn   │ togglePause()                   │ Swaps icon, aria-pressed
Replay button    │ replayNarration()               │ Disabled when no narration
Mute button      │ toggleMute()                    │ Swaps icon, disabled until audio loads
Captions button  │ toggleCaptions()                │ aria-pressed, syncs mid-scene
```

### 7.3 Design

- 44×44px touch targets on all buttons
- Backdrop blur + semi-transparent backgrounds
- WCAG AA contrast on all controls
- Focus-visible outlines on keyboard navigation
- Progress dots: 44×44px hit area, 8px visible dot, active = bright
- Controls hidden during loading, shown after first frame renders
- `env(safe-area-inset-bottom)` for notched devices

---

## 8. Ghost-Drift Text

```
line 1:  ░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░
line 2:  ░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░
line 3:  ░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░
```

- Lines positioned absolutely via `x` (vw), `y` (vh), `align` (left/center/right)
- Enter: blur(4px) + y:18 → clear + y:0 (1.2s, power3.out)
- Exit: clear → blur(3px) + y:-10 (0.9s, power2.in)
- Lines enter/exit independently, overlap allowed
- If user navigates mid-drift: kill timeline, transition. Interrupt, not queue
- Scene 8: text only, no audio — holdUntilClick waits for user
- Reduced motion: simple opacity fade (0.3s), no spatial movement, no blur
- `aria-live="polite"` region mirrors caption text for screen readers

---

## 9. Captions

- Stored in `narration.captions[]` per frame
- Timed via GSAP `tl.call()` callbacks embedded in the narration timeline
- `isCaptionEnabled()` checked at callback execution time — enabling mid-scene works
- `syncCaptionsToTime()` shows correct caption when toggled on mid-narration
- Persistence: `localStorage` key `carbon-trace-captions-enabled`
- Visual: dark semi-transparent background, centered below scene, `clamp()` font sizing
- Accessible narration region populated from caption text (full paragraph)

---

## 10. Asset Loading Strategy

### 10.1 Critical Path (blocking)

1. First frame image: `loadImage()` → cache → `drawSceneImage()` → reveal stage
2. First frame audio: `preloadFirstFrameAudio()` → metadata-only via native `Audio()`

### 10.2 Background (deferred 4 seconds after first frame)

In parallel:
- **Images:** Sequential by scene order. `loadImage()` caches each.
- **Audio:** Sequential by scene order. `preloadBackgroundAudio()` uses metadata-only preload.

### 10.3 Ahead-of-Time (per scene)

On each `showFrame()` call, `prebufferNextScene()`:
- Preloads next frame's image (if not cached)
- Pre-creates Howl for next frame's narration via `preloadNarrationAhead()` — stored in narrationCache, reused on `playNarration()` to avoid double-download

### 10.4 Image Failure

`loadImage()` resolves to `null` on error. `renderSceneImage()` calls `drawFallback()` — solid dark color. Image evicted from cache so retry is possible.

---

## 11. Responsive

- Full-bleed: scene-stage fills viewport (no letterboxing — images cover-fit)
- ResizeObserver on both canvases. DPR-aware sizing. Redraw on resize
- `clamp()` font sizes: narration text, captions, loading title, play-gate label
- 320px minimum functional width
- `viewport-fit=cover` + `env(safe-area-inset-bottom)` for notched devices

---

## 12. Deployment

```dockerfile
# Build stage — install deps and run Vite build
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.js ./
COPY src/ src/
COPY public/ public/
RUN pnpm build

# Production stage — serve static files with nginx
FROM nginx:1-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://localhost:8080/ || exit 1
USER nginx
CMD ["nginx", "-g", "daemon off;"]
```

```nginx
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location ~* \.(webp|mp3|m4a|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

CSP in `index.html`:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self'; media-src 'self' data:; font-src 'self' https://fonts.gstatic.com;
connect-src 'none'; object-src 'none'; base-uri 'self'
```

**Note:** `connect-src: 'none'` is safe because Howler uses `html5: true` mode (streaming via `<audio>` elements → `media-src`), not XHR/fetch (`connect-src`). Verify across Safari/Chrome/Firefox.

---

## 13. Accessibility

- Canvas: `aria-hidden="true"` on both scene and effects canvases
- DOM: `aria-live="polite"` narration region populated from caption text
- Keyboard: Arrow ←/→ navigate, Space toggle pause, Enter advance, Tab to controls
- Play/pause button satisfies WCAG 2.2.2 (Pause, Stop, Hide)
- `prefers-reduced-motion`: ghost-drift → opacity fade, transitions → instant, effects canvas self-stops, loading animation disabled
- All buttons: `aria-label`, `aria-pressed` where stateful, `aria-disabled` when inactive
- Focus-visible outlines on all interactive elements
- Captions available as alternative to audio narration

---

## 14. Edge Cases

```
CASE                                │ BEHAVIOR
────────────────────────────────────┼──────────────────────────────
Muted audio                         │ 'end' still fires. Auto-advance works.
No narration audio (Scene 8)        │ holdAfterNarration used as scene duration.
                                    │ (Scene 8 also has holdUntilClick: true.)
Skip mid-narration (playing)        │ cleanupCurrentScene: stop narration,
                                    │ crossfade ambient, clear all timers.
Nav during transition (playing)     │ Queued as pendingNavIndex. Executes after
                                    │ current transition completes.
Navigate while paused               │ hardJump. Lands paused. Play to start.
Pause during transition             │ pendingPause. Transition finishes, then freezes.
Pause during holdAfterNarration     │ Save remaining. Resume: reschedule.
Scene 8 + paused                    │ No timer. Pause freezes text. Nav = hardJump.
Scene 8 + playing                   │ No timer. Holds until click/tap/arrow.
Credits (Scene 11)                  │ holdUntilClick: null. No advance. Music plays.
Replay while playing                │ Restart narration + text. Clear timer.
                                    │ 'end' re-arms auto-advance. (ADR-004)
Replay while paused                 │ Hard jump reset. Narration cued (loaded,
                                    │ not playing). Text timeline at 0, paused.
                                    │ replayPending = true. State stays PAUSED.
                                    │ doResume schedules fresh narration. (ADR-004)
Image load failure                  │ Fallback solid color. Evict from cache.
Audio load failure                  │ onloaderror/onplayerror call onend.
                                    │ Auto-advance chain continues.
Narration buffer stall              │ .buffering CSS spinner. Text timeline pauses.
                                    │ Recovery: nudge-seek → reload → give up.
Scene 11 music + narration          │ Music scheduled via enter delay (20000ms).
                                    │ Crescendo from 0.01 to 0.25 over 45s.
                                    │ Both play simultaneously. Terminal — no advance.
Scene 11 skip (nav away)            │ cleanupCurrentScene stops music. Normal.
                                    │ Return = restart from top.
First interaction (play gate)       │ doResume → handleFirstPlay: trigger narration
                                    │ + text + auto-advance for frame 0.
Rapid navigation                    │ generation counter guards stale onend callbacks.
                                    │ pendingNavIndex queues during transition.
                                    │ Session counter (ADR-005) guards stale audio
                                    │ scheduling callbacks.
Transition error                    │ Revert currentIndex + state to previous frame.
                                    │ Force stage opacity back to 1.
Narration safety timeout            │ If Howler end/error never fires within
                                    │ maxDurationMs + 5s, force-stop narration
                                    │ and call onend. Prevents scene hang. (ADR-005)
Crossfade ambient failure           │ scheduleAmbient: on new ambient load/play error,
                                    │ cancel old fade-out, restore old ambient volume.
                                    │ Ownership guard prevents overwrite. (ADR-005)
Music timer orphaning               │ Eliminated. scheduleMusic owns enter/exit timers
                                    │ internally. pauseAll/resumeAll handle atomically.
Pause during ambient crossfade      │ Old ambient paused mid-fade. On resume, snapped
                                    │ to target volume (0) and unloaded. (ADR-005)
```

---

## 15. Performance Budget

```
First paint         │ <2s (loading screen)
First frame visible │ <4s (first image + audio metadata)
Background preload  │ Deferred 4s after first frame
Total images        │ ~2-5MB (12 WebP at 1536×824)
Total audio         │ TBD (narration .m4a + end song .mp3)
Canvas render       │ 60fps during effects
Transition          │ ~0.6-0.75s (half of transition duration, each direction)
```

Progressive loading: first frame blocks, background assets load sequentially by scene, narration pre-buffered one scene ahead.

---

## 16. v1 Scope (ships April 5)

- All 12 frames with GSAP opacity fade transitions
- Narration-driven auto-advance with play/pause (ADR-002)
- Ghost-drift text (DOM overlay + GSAP) with positioned lines
- Three-channel audio: narration, ambient, music (separate systems, not unified cues)
- End song on Scene 11 with delayed entry and crescendo
- Timed captions with localStorage persistence and mid-scene toggle
- Play-gate for mobile audio context unlock
- Progress dots + forward/back + keyboard navigation
- Scene 8: holdUntilClick, ghost-drift text, no audio
- Replay-while-paused: hard jump reset, stay paused (ADR-004)
- Narration buffer stall detection and recovery
- Accessibility: aria-live, reduced-motion, keyboard, WCAG 2.2.2, captions
- Cloud Run deploy with CI/CD
- Effects registry wired but no-op until implementations added
- Ambient audio: architecture ready, data empty (next branch)

---

## 17. Rules

```
ARCHITECTURE:
  ✓ each module does ONE thing
  ✓ app.js is the ONLY module that knows frame ordering
  ✓ all other modules receive config objects, not frame indices
  ✓ no module imports from app.js (one-direction dependency)
  ✓ scenes.json is single source of truth
  ✓ scene differences = config data, not if-blocks

RENDERING:
  ✓ canvas = visual plane (images, traces in v2)
  ✓ DOM overlay = semantic plane (text, buttons, a11y)
  ✓ both canvases are aria-hidden="true"
  ✓ GSAP animates DOM elements
  ✓ requestAnimationFrame animates canvas
  ✓ transitions via GSAP opacity fade on scene-stage container
  ✓ NEVER getImageData() in a render loop for compositing

STATE:
  ✓ five states: LOADING, SCENE_ACTIVE, TRANSITIONING, PAUSED, CREDITS
  ✓ generation counter incremented on every navigation
  ✓ generation guards all async callbacks (onend, timers)
  ✓ pausedFromState preserves resume target
  ✓ autoAdvanceTimer is a PausableTimer — pause/resume/cancel built in
  ✓ audio timers internal to audio.js — app.js calls pauseAll/resumeAll/cancelAll
  ✓ togglePause() queues as pendingPause during TRANSITIONING
  ✓ navigation queues as pendingNavIndex during TRANSITIONING

AUDIO:
  ✓ three channels: narration, ambient, music
  ✓ all Howls use html5: true (streaming)
  ✓ narration pre-buffered one scene ahead
  ✓ mute via howl.mute(), not volume — 'end' events still fire
  ✓ load/play errors call onend to maintain auto-advance chain
  ✓ buffer stall recovery: nudge → reload → give up
  ✓ audio.js owns all audio timer lifecycle (ADR-005)
  ✓ session counter prevents stale audio scheduling callbacks
  ✓ narration safety timeout always set (4-tier duration fallback, never skipped)
  ✓ crossfade error recovery: restore old ambient on new failure
  ✓ play gate is hard no-play boundary — no audio before dismissal

NEVER:
  ✗ hardcoded frame indices in if/else
  ✗ multiple functions for same navigation action
  ✗ text drawn on canvas
  ✗ cross-imports between leaf modules
  ✗ global GSAP timelines
  ✗ releasing locks before async completes
  ✗ constructing Howl instances per transition (use narrationCache)
  ✗ framework for ~25 DOM elements
  ✗ temporarily un-pausing for transitions
  ✗ auto-advancing during pause
  ✗ losing pause state across navigation
  ✗ audio timers in app.js (audio.js owns scheduling — ADR-005)
  ✗ advanceTimers without clearing previous
  ✗ killing mid-flight GSAP timelines on pause (pause them)
  ✗ orphaned timers after navigate (cleanupCurrentScene clears all)

PRE-SHIP CHECKLIST:
  ☑ Generation counter guards stale narration 'end' events
  ☑ Per-image error handling with fallback solid color frame
  ☑ Audio load failures degrade gracefully (onend still fires)
  □ Verify Vite content-hashes assets, or drop "immutable"
    from nginx cache for public/ assets during iteration
  □ Test connect-src: 'none' CSP with Howler html5 streaming
    across Safari, Chrome, Firefox
  □ Suppress or remove unimplemented effect warnings before submission
  □ Ambient audio data in scenes.json (next branch)
```
