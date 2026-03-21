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
│   ├── audio.js                # Howler — narration, ambient, buffer recovery
│   ├── text.js                 # Ghost-drift text + caption entries — GSAP timelines
│   ├── captions.js             # Timed captions, localStorage persistence
│   ├── effects.js              # Effect registry — no-op skeleton (v2)
│   ├── overlay.js              # DOM controls — progress dots, buttons
│   ├── loader.js               # Audio metadata preloading (sequential by scene)
│   └── pausable-timer.js      # Pausable/cancelable timer utility
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
         captions, overlay, loader, pausable-timer, scenes.json

audio.js → pausable-timer

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
// Unified scheduling API (ADR-005)
scheduleAudioCues(cues, opts)    → schedule all cues for a frame
  opts.onNarrationEnd            → callback for auto-advance chain
  opts.maxNarrationDurationMs    → safety timeout (caption-derived)
  opts.crossfadeDurationMs       → ambient crossfade duration (default 800)
  opts.audioDurations            → metadata durations map for generic anchor resolution
cancelAudioCues()                → stop all Howls, cancel all timers, clear map
pauseAudioCues()                 → pause all active Howls + freeze all pending timers
resumeAudioCues()                → resume all paused Howls + reschedule all frozen timers

// Cueing (targeted reset / preload flows)
cueAudioCues(cues)               → load all, seek to 0, do NOT play
cancelCue(cueId)                 → stop + cancel one specific cue (for replay reset)
reCueCue(cueId, cue)             → cancel + re-cue a single cue without touching others

// Query
getNarrationCue()                → returns active narration Howl (for replay)
restartNarrationCue(cue, opts)   → stop + play existing narration Howl from 0 (avoids Audio pool exhaustion on rapid replay)

// Global
setMuted(bool)                   → global mute (affects volume, not playback)
onNarrationBufferChange(callback) → register buffer state listener
isNarrationBuffering()           → returns current buffer stall state
preloadNarrationAhead(src)        → pre-create Howl for next scene
clearNarrationCache()             → unload ahead-of-time cache
```

Internal state uses `activeCues = new Map<cueId, { howl, timer, type, state }>`. No hardcoded timer variables — each cue gets its own `PausableTimer` entry. All Howl instances use `html5: true` for streaming.

**Anchor resolution:** `resolveAnchors(cues, opts)` computes `resolvedEnter` for each cue. Numeric enters pass through. Anchor objects (`{ ref, offset }`) resolve to `refEnter + refDuration + offset`. Duration lookup prefers `opts.audioDurations` metadata and falls back to `opts.maxNarrationDurationMs` for narration when metadata is missing. Unknown refs fall back to `enter: 0`.

**Narration safety timeout:** `wireNarrationEnd` sets a safety timer at `enterDelay + maxDurationMs + 5000ms`. If no `end`/`loaderror`/`playerror` fires, force-stops narration and calls `safeEnd`. Safety timer is a `PausableTimer` — pauses with the experience. Deduplicates — callback fires at most once. Duration authority: metadata → frame captions → project-wide max → 60s floor.

**Crossfade error recovery:** `crossfadeAmbientCue` defers old ambient unload until new ambient confirms playback (`play` event). On load/play error: restores old ambient to its *original* volume, not the new target. No blind `setTimeout` unload.

**Buffer exhaustion bridge:** `monitorNarrationBuffer` reports buffer exhaustion directly to `wireNarrationEnd` via `onExhaustion` callback, which triggers `safeEnd` immediately. No gap between buffer giving up and scene advancing.

**Buffer recovery:** Attaches `waiting`/`playing` event listeners to the underlying HTML5 audio node. On stall: tracks buffered ranges, attempts nudge-seek after 2 checks, full reload after 4 checks, gives up after 3 recovery attempts. Visual indicator via `.scene-stage.buffering` CSS class.

**Mute:** Iterates `activeCues` and calls `howl.mute()`. `'end'` events still fire when muted. Auto-advance works while muted.

**Audio failure graceful degradation:** Both `onloaderror` and `onplayerror` call `safeEnd`, which triggers the auto-advance chain. If narration fails to load/play, the scene still advances.

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

Effect registry is `const effects = {}`. All scene references (dust-drift, heat-pulse, etc.) no-op with console warning until implementations are registered.

### overlay.js

```
initOverlay(sceneCount, onDotClick)  → create progress dots
updateProgress(sceneIndex)           → update active dot
showControls()                       → unhide overlay
```

Progress dots map to scene indices (includes all frame types: title, scene, credits). Each dot is a `<button>` with `aria-label`, `aria-current="step"` on active.

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
      "holdAfterNarration": 2000,
      "description": "Underground mine tunnel with timber supports, lantern on left wall, diamond barely visible in coal seam — carbon buried under immense pressure",
      "image": "assets/images/scene-01-seam.webp",
      "narration": {
        "lines": [
          { "text": "...", "enter": 2000, "exit": 5000, "x": 10, "y": 70, "align": "left" }
        ],
        "captions": [
          { "text": "...", "start": 0, "end": 5000 }
        ]
      },
      "audioCues": [
        { "id": "narration", "type": "narration", "src": "assets/audio/narration/01-seam.m4a", "enter": 500, "volume": 1.0, "loop": false, "fadeIn": 0, "fadeOut": null }
      ],
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
```

`narration: null` = no narration at all (no text, no captions).

`narration` with `lines`/`captions` but no narration cue in `audioCues` = text + captions but no audio (Scene 8: silence with ghost-drift text).

### 4.3 audioCues Array (ADR-003/ADR-005)

Replaces the former `ambient`, `music`, and `narration.audio`/`narration.delay` slots.

```
FIELD    │ TYPE                │ DESCRIPTION
─────────┼─────────────────────┼──────────────────────────────────────
id       │ string              │ Unique identifier within the frame (referenced by anchoring)
type     │ string              │ "narration" | "ambient" | "sfx"
src      │ string              │ Audio asset path
enter    │ number | object     │ ms after scene entry, OR anchor { ref, offset }
volume   │ number              │ Target volume (0.0–1.0)
loop     │ boolean             │ Loop playback
fadeIn   │ number              │ ms fade-in duration from 0 to target volume
fadeOut  │ number | null       │ ms fade-out at end. null = no auto-fade.
```

`audioCues: null` = no audio for this frame.

**Anchor objects:** `{ ref: "narration", offset: -5000 }` resolves to `refEnter + refDuration + offset`. Resolution prefers `audioDurations` metadata and falls back to `maxNarrationDurationMs` for narration when metadata is missing.

**Type behavior:**
- `narration`: fires `end` event for auto-advance. One per frame max. Replay targets this.
- `ambient`: crossfades on scene transition via `crossfadeAmbientCue`. Can overlap with narration.
- `sfx`: one-shot, no crossfade, no replay.

### 4.5 holdAfterNarration Map

```
FRAME                │ holdAfterNarration
─────────────────────┼────────────────────
00 Title             │ null (default 2000)
01 Seam              │ 2000
02 Travel            │ 2000
03 Reach             │ 3000
04 Pocket            │ 2000
05 Rinse             │ 2500
06 Storage           │ 2000
07 Empty             │ 2000
08 Stillness         │ 8000
09 Return            │ 2000
10 Building          │ 3000
11 Music (credits)   │ n/a (last frame, no advance)
```

All frames auto-advance after narration + holdAfterNarration. The credits frame
is the last frame, so `shouldAutoAdvance` returns false and `advance()` is blocked
by the CREDITS state.

### 4.6 Audio Hierarchy

```
1. Narration (loudest, volume: 1.0)
2. Emotional silence (audioCues: null, no audio cues)
3. Ambient texture (volume: 0.05–0.20, loop: true, 1.5s fade-in)
4. End song (type: "ambient", anchored entry 5s before narration ends, crescendo to 0.75 over 10s)
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
  deferFrameAudioUntilResume: false, // true after paused hardJump — next resume schedules frame audio fresh
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
  els: { /* DOM element references — see createApp() */ },
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
    hardJump(toIndex)             // instant — drawImage, defer frame audio, re-pause
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
if toImg not cached:
  waitForImage(toImg)           → debounced spinner, resolve on load/fail
drawImage(toImg)                → instant, no crossfade
set deferFrameAudioUntilResume = true
showFrame(toIndex)              → renders image, builds text/captions, skips audio scheduling
doPause()                       → freeze everything
```

No lock. No timer. No animation. Scene lands paused and frozen. On resume, audio enters through the normal `scheduleFrameAudio()` path so delayed and anchored cues keep one authoritative timing model.

### 5.5 setupAutoAdvance

```js
function setupAutoAdvance(app) {
  clearAutoAdvance(app);
  const frame = app.frames[app.currentIndex];
  if (!shouldAutoAdvance(app, frame)) return;

  const holdAfterNarration = frame.holdAfterNarration
    ?? scenesData.meta.defaultHoldAfterNarration ?? 2000;

  const hasNarrationAudio = frame.audioCues?.some(c => c.type === 'narration');
  if (!hasNarrationAudio) {
    // No narration audio — schedule immediately on landing
    scheduleAutoAdvance(app, holdAfterNarration);
  }
  // With narration audio — onNarrationEnd callback triggers scheduleAutoAdvance
}

function shouldAutoAdvance(app) {
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
- `pauseAudioCues()` — freezes all audio + pending timers in activeCues Map
- Pause text timeline, effects canvas
- `autoAdvanceTimer?.pause()` — saves remaining auto-advance time

**doResume():**
- Restore `pausedFromState`, clear pause

```
if replayPending:
  replayPending = false
  if deferFrameAudioUntilResume:
    deferFrameAudioUntilResume = false
    cancelAudioCues()
    scheduleFrameAudio(app, currentFrame)    // full frame fresh after paused hardJump
  else:
    cancelCue('narration')
    resumeAudioCues()                        // resume remaining cues (ambient, etc.)
    scheduleAudioCues([narrationCue], { onNarrationEnd, maxNarrationDurationMs, audioDurations })
  textTimeline.play(0)                       // restart from beginning
  setupAutoAdvance()
else:
  if deferFrameAudioUntilResume:
    deferFrameAudioUntilResume = false
    scheduleFrameAudio(app, currentFrame)    // first real start after paused hardJump
  else:
    resumeAudioCues()                        // resume all audio + pending timers
  textTimeline.resume()
```

- Resume effects canvas
- `autoAdvanceTimer?.resume()` — reschedule with saved remaining
- If first interaction: hide play-gate, `cancelAudioCues()`, then `handleFirstPlay()`.

### 5.8 replayNarration() — ADR-004

```
replayNarration(app):
  if TRANSITIONING or LOADING: return

  userHasInteracted = true

  if paused:
    clearAutoAdvance()
    cancelCue('narration')
    reCueCue('narration', narrationCue)
    buildNarration(app, frame)      // rebuild text, stay paused at the start
    replayPending = true            // doResume schedules fresh narration with onend
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
- CREDITS: advance disabled (last frame + CREDITS state)

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
Progress dots    │ transition(frameIndex)          │ Dots = all frames (title, scenes, credits)
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
- Scene 8: text only, no audio — auto-advances after holdAfterNarration (8000ms)
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

See `Dockerfile` and `nginx.conf` at repo root for the canonical deployment configuration. Key design points:

- **Two-stage build:** `node:22-alpine` builder → `nginx:1-alpine` production image
- **Non-root runtime:** runs as `nginx` user with `chown` on `/run` and cache directories
- **Port 8080:** Cloud Run requirement
- **Health check:** `wget` against localhost for container orchestrator liveness
- **Caching strategy:** immutable hashed assets (1 year), images/audio (30 days); security headers configured in nginx
- **Gzip:** enabled for text-based assets (JS, CSS, JSON, SVG)

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
No narration audio (Scene 8)        │ holdAfterNarration (8s) used as scene duration.
                                    │ Auto-advances after the long hold.
Skip mid-narration (playing)        │ cleanupCurrentScene: stop narration,
                                    │ crossfade ambient, clear all timers.
Nav during transition (playing)     │ Queued as pendingNavIndex. Executes after
                                    │ current transition completes.
Navigate while paused               │ hardJump. Lands paused. Play to start.
Pause during transition             │ pendingPause. Transition finishes, then freezes.
Pause during holdAfterNarration     │ Save remaining. Resume: reschedule.
Scene 8 + paused                    │ holdAfterNarration timer paused. Nav = hardJump.
Scene 8 + playing                   │ Auto-advances after 8s hold.
Credits (Scene 11)                  │ Last frame + CREDITS state. No advance. Music plays.
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
Scene 11 music + narration          │ End song (type: ambient) anchored to narration
                                    │ end (offset: -5s). Crescendo 0→0.75 over 10s. Both
                                    │ play simultaneously. Terminal — no advance.
Scene 11 skip (nav away)            │ cleanupCurrentScene stops music. Normal.
                                    │ Return = restart from top.
First interaction (play gate)       │ doResume → handleFirstPlay: trigger narration
                                    │ + text + auto-advance for frame 0.
Rapid navigation                    │ Generation counter guards stale onend callbacks.
                                    │ pendingNavIndex queues during transition.
Transition error                    │ Revert currentIndex + state to previous frame.
                                    │ Force stage opacity back to 1.
Narration safety timeout            │ If Howler end/error never fires within
                                    │ maxDurationMs + 5s, force-stop narration
                                    │ and call onend. Prevents scene hang. (ADR-005)
Crossfade ambient failure           │ crossfadeAmbientCue: defers old unload until new
                                    │ confirms play. On error, restores old ambient at
                                    │ original volume. No blind setTimeout. (ADR-005)
Timer orphaning                     │ Eliminated. activeCues Map with PausableTimer per
                                    │ cue. pauseAudioCues/resumeAudioCues iterate map.
Pause during ambient crossfade      │ Old ambient paused mid-fade via _crossfadePause
                                    │ hook. Fade-out timer (PausableTimer) paused.
                                    │ On resume: old ambient resumes fade. (ADR-005)
```

---

## 15. Performance Budget

```
First paint         │ <2s (loading screen)
First frame visible │ <4s (first image + audio metadata)
Background preload  │ Deferred 4s after first frame
Total images        │ ~2-5MB (12 WebP at 1536×824)
Total audio         │ ~17MB (narration 6.4MB + ambient 3.2MB + end song 7.4MB)
Canvas render       │ 60fps during effects
Transition          │ ~0.6-0.75s (half of transition duration, each direction)
```

Progressive loading: first frame blocks, background assets load sequentially by scene, narration pre-buffered one scene ahead.

---

## 16. v1 Scope (ships April 5)

- All 12 frames with GSAP opacity fade transitions
- Narration-driven auto-advance with play/pause (ADR-002)
- Ghost-drift text (DOM overlay + GSAP) with positioned lines
- Unified audio cue system (ADR-005): narration, ambient, anchoring, crossfade
- End song on Scene 11 with delayed entry and crescendo
- Timed captions with localStorage persistence and mid-scene toggle
- Play-gate for mobile audio context unlock
- Progress dots + forward/back + keyboard navigation
- Scene 8: holdAfterNarration (8s), ghost-drift text, no audio
- Replay-while-paused: hard jump reset, stay paused (ADR-004)
- Narration buffer stall detection and recovery
- Accessibility: aria-live, reduced-motion, keyboard, WCAG 2.2.2, captions
- Cloud Run deploy with CI/CD
- Effects registry wired but no-op until implementations added
- End song on Scene 11 using type: ambient with anchor-based entry and 10s crescendo to 0.75

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
  ✓ audio timers internal to audio.js — app.js calls pauseAudioCues/resumeAudioCues/cancelAudioCues
  ✓ togglePause() queues as pendingPause during TRANSITIONING
  ✓ navigation queues as pendingNavIndex during TRANSITIONING

AUDIO:
  ✓ unified activeCues Map — no hardcoded channels
  ✓ all Howls use html5: true (streaming)
  ✓ narration pre-buffered one scene ahead
  ✓ mute via howl.mute(), not volume — 'end' events still fire
  ✓ load/play errors call onend to maintain auto-advance chain
  ✓ buffer stall recovery: nudge → reload → give up
  ✓ audio.js owns all audio timer lifecycle (ADR-005)
  ✓ activeCues Map entry checks prevent stale audio callbacks
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
```
