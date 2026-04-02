# carbon-trace — System Design

**Project:** WeCoded 2026 Frontend Art Entry
**Author:** Ashley Childress (@anchildress1)
**Deadline:** April 5, 2026 @ 11:59 PM PDT
**Supersedes:** v6 — docs aligned with implemented codebase (effects, shimmer, audio-reactive all shipped)
**Spec convention:** This document describes the implemented architecture. All ADR decisions through ADR-011 are reflected in code.
**Active ADRs:** ADR-006/006A (trace shimmer overlay, mask-based), ADR-007 (PixiJS effects), ADR-008 (audio-reactive modulation), ADR-011 (credits overlay) are all implemented in v1. See individual ADRs for specifications.

---

## 1. Tech Stack

- **Build:** Vite
- **Rendering:** Canvas 2D for scene; PixiJS/WebGL for effects (ADR-007). GSAP animates DOM, rAF/ticker animates canvases.
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
│   ├── effects-canvas.js       # Effects overlay canvas, PixiJS/WebGL lifecycle (ADR-007)
│   ├── audio.js                # Howler — narration, ambient, buffer recovery
│   ├── text.js                 # Ghost-drift text + caption entries — GSAP timelines
│   ├── captions.js             # Timed captions, localStorage persistence
│   ├── keyboard.js             # Declarative key-action map, document listener
│   ├── effects.js              # Effect factory registry — water, heat, dust, glow, shockwave (ADR-007)
│   ├── shimmer.js              # Trace shimmer overlay — mask-based pixel-walking dots (ADR-006A)
│   ├── credits.js              # Credits overlay — GSAP scroll, focus/hover pause (ADR-011)
│   ├── credits-content.html    # Credits text content (imported ?raw by credits.js)
│   ├── overlay.js              # DOM controls — progress dots, buttons
│   ├── loader.js               # Audio metadata preloading (sequential by scene)
│   └── pausable-timer.js      # Pausable/cancelable timer utility
├── public/
│   └── assets/
│       ├── images/             # 12 WebP scenes (16:9, 1536×824)
│       ├── masks/              # Grayscale PNG effect masks, 16:9 (ADR-007)
│       ├── audio/narration/    # Per-scene narration (.m4a)
│       ├── audio/sfx/          # End song
│       └── fonts/
│   # All asset filenames carry an 8-char SHA-256 content hash
│   # suffix for cache busting (ADR-010). When updating any asset:
│   #   shasum -a 256 <file> | cut -c1-8
│   # Rename file, update references in scenes.json / styles.css.
├── Dockerfile
└── nginx.conf
```

---

## 3. Module Contracts

```
app.js → canvas, effects-canvas, effects, audio, text,
         captions, keyboard, shimmer, credits, overlay, loader, pausable-timer, scenes.json

audio.js → pausable-timer

credits.js → pausable-timer

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

### effects-canvas.js (UPDATED by ADR-007 — now PixiJS/WebGL)

```
init(canvasEl)                         → create PixiJS Application (WebGL context).
                                         Wrapped in try/catch — on failure, sets
                                         webglAvailable = false, all loadScene() no-op.
loadScene(effectsConfig, sceneImageUrl) → clearAll() + load scene texture (shared, no full-screen sprite)
                                         + create per-region masked Containers with cloned sprites and
                                         filters. Masks loaded via new Image() + Texture.from() (lazy).
                                         PixiJS layer is transparent outside effect regions (ADR-007 addendum).
setAnalyser(analyserNode)              → store Web Audio AnalyserNode reference. Ticker reads FFT
                                         data each frame for regions with audioReactive config (ADR-008).
clearAll()                             → destroy sprites/filters/textures via .destroy(false)
                                         (frees GPU backing store). Ticker stays running.
pause() / resume()                     → stop/start PixiJS ticker (WCAG 2.2.2).
                                         Only pause()/resume() control ticker lifecycle.
```

Uses PixiJS v8 (WebGL) instead of Canvas 2D (ADR-007). Transparent overlay — no full-screen sceneSprite, only masked effect containers (ADR-007 addendum). DPR-aware. Reduced motion: effects render static (no displacement animation, audioReactive ignored — ADR-008). Handles WebGL context loss (re-init on next loadScene, permanent static fallback if re-init fails).

### audio.js

```
// Unified scheduling API (ADR-005)
scheduleAudioCues(cues, opts)    → schedule all cues for a frame
  opts.onNarrationEnd            → callback for auto-advance chain
  opts.maxNarrationDurationMs    → safety timeout (caption-derived)
  opts.crossfadeDurationMs       → ambient crossfade duration (default 800)
  opts.audioDurations            → metadata durations map for generic anchor resolution
cancelAudioCues(opts)            → stop all Howls, cancel all timers, clear map
  opts.preserveAmbient           → keep playing/fading ambient cues alive (for crossfade continuity)
pauseAudioCues()                 → pause all active Howls + freeze all pending timers
resumeAudioCues()                → resume all paused Howls + reschedule all frozen timers

// Anchor resolution
resolveCueEnters(cues, opts)     → compute resolvedEnter for all cues (iterative anchor resolution)

// Narration boost
wrapOnNarrationEndWithBoost(cues, onNarrationEnd) → wrap callback to fade volumeAfterNarration cues

// Global
setMuted(bool)                   → global mute (affects volume, not playback)
onNarrationBufferChange(callback) → register buffer state listener
preloadNarrationAhead(src)       → pre-create Howl for next scene
trimNarrationCache(keepSrcs)     → unload all cached Howls except keepSrcs

// Audio analysis (ADR-008 audio-reactive)
getAnalyserNode()                → lazy-create AnalyserNode on Howler's AudioContext,
                                   connect to Howler.masterGain(). Returns same instance on
                                   subsequent calls. fftSize: 2048. See ADR-008 for
                                   CORS/html5-mode verification requirements.
disconnectAnalyserSource()       → disconnect source node (for cleanup between scenes)
```

Internal state uses `activeCues = new Map<cueId, { howl, timer, type, state }>`. No hardcoded timer variables — each cue gets its own `PausableTimer` entry. All Howl instances use `html5: true` for streaming.

**Anchor resolution:** `resolveAnchors(cues, opts)` computes `resolvedEnter` for each cue. Numeric enters pass through. Anchor objects (`{ ref, offset }`) resolve to `refResolvedEnter + refDuration + offset`. Resolution is iterative: numeric enters are seeded first, then each pass resolves anchors whose refs are already resolved, repeating until no progress. This supports chained anchors (A → B → C) at arbitrary depth. Circular references and missing refs are detected (no progress after a full pass) and fall back to `enter: 0` with a console warning. Duration lookup prefers `opts.audioDurations` metadata and falls back to `opts.maxNarrationDurationMs` for narration when metadata is missing.

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

Lines are absolutely positioned via `x` (%), `y` (%) relative to the narration layer. Positioned lines are left-aligned via CSS class, not per-line config. Ghost-drift animation: blur(4px) + y:18 → clear + y:0 on enter; blur(3px) + y:-10 → gone on exit. Reduced motion: simple opacity fade, no spatial movement.

Caption entries are GSAP `tl.call()` callbacks at `startSec`/`endSec` that create/remove caption DOM elements. `isCaptionEnabled` function is checked at callback time, enabling mid-scene caption toggle.

### captions.js

```
initCaptions()                    → read localStorage, return enabled state
setCaptionsEnabled(bool)          → write localStorage + update state
areCaptionsEnabled()              → return current state
syncCaptionsToTime(entries, timeSec, container) → show correct caption for current time
clearCaptionElements(entries)     → remove all active caption DOM elements
```

### keyboard.js

```
handleKeydown(e, actionHandler)  → pure key handler: resolves key to action, fires actionHandler
initKeyboard(actionHandler)      → register document listener, return cleanup fn
```

Key map: Space → togglePause, Escape → pause, Enter → advance, ArrowRight → advance, ArrowLeft → retreat.
`allowOnButton: false` on Space/Enter suppresses the key when a `<button>` is focused (native button takes precedence).
`allowOnButton: true` on arrows and Escape allows global navigation even when a button is focused.

### effects.js (UPDATED by ADR-007 — now PixiJS factory registry)

```
registerEffect(type, factoryFn)  → register a named effect type
createEffect(type, app, params)  → create PixiJS filter/emitter for this type
```

Built-in registrations: `water`, `heat`, `dust`, `glow`, `shockwave`. Displacement types (water, heat, dust) return DisplacementFilter. Glow returns GlowFilter (`pixi-filters`). Shockwave returns ShockwaveFilter (`pixi-filters`). No particle emitter dependency. See ADR-007 for full specification.

### overlay.js

```
initOverlay(sceneCount, onDotClick)  → create progress dots
updateProgress(sceneIndex)           → update active dot
focusActiveDot()                     → move keyboard focus to the current active dot
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

### shimmer.js (ADR-006A — mask-based trace overlay)

```
init(canvasEl)              → setup dedicated <canvas> + ResizeObserver + rAF loop
loadScene(config)           → async: load mask PNG, build walkMap, spawn dots
pause() / resume()          → stop/start rAF loop
destroy()                   → cleanup canvas, observer, animation frame
```

Renders visible circuit traces with traveling glow dots on a dedicated `<canvas id="trace-overlay">` layered above effects-canvas. Loads a per-scene mask image (dark pixels = walkable), builds a binary `walkMap` Uint8Array, and spawns autonomous pixel-walking dots that follow 8-compass pathfinding along circuit lines. Dots pulse via `sin()` for shimmer effect. `prefers-reduced-motion`: dots freeze at 0.6α, no movement. Generation counter guards stale async loads. See ADR-006A for the full mask-based architecture specification.

### credits.js (ADR-011 — credits overlay)

```
initCreditsContent(el)                          → populate credits HTML from static import
revealCreditsPanel(panel, scroll, config, opts) → fade-in + GSAP auto-scroll timeline
cleanupCredits(panel)                           → kill timelines, cancel timers, hide panel
pauseCreditsScroll() / resumeCreditsScroll()    → pause/resume scroll timeline
```

Frosted glass overlay on frame 11. Triggered by `makeNarrationEndCallback` after narration ends + `holdAfterNarration` delay. GSAP `translateY` auto-scroll with `repeat: -1` loop. Wheel and touch-drag events scrub timeline; focus/hover on links pauses scroll (WCAG 2.4.3). PausableTimer-based resume delay after manual interaction. `prefers-reduced-motion`: no GSAP animation, native `overflow-y: auto` scroll. Credits content imported from `credits-content.html` via Vite `?raw`. See ADR-011 for the full architecture specification.

---

## 4. Frame Configuration

### 4.1 Schema

Every frame has identical shape via `meta.frameDefaults` merge. `null` = feature not active on this frame. Applies uniformly to all optional keys: `narration: null`, `audioCues: null`, `traceOverlay: null`, `effects: null`.

Startup performs strict config validation (`validateScenesConfig`) and fails fast on invalid narration line schema. Each `narration.lines[]` entry must provide `text` (string) plus finite numeric `enter`, `exit`, `x`, and `y` values. Invalid config throws from `createApp()`, which is caught by the top-level error boundary in `main.js` — the on-page message stays generic while the full error is logged to the console. `createLineElement()` enforces the same finite-numeric contract at render time as a second safety layer.

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
      "description": "Coal seam wall, lamp upper left — carbon buried under pressure",
      "image": "assets/images/scene-01-seam-48263be1.webp",
      "traceOverlay": {
        "mask": "assets/masks/mask-01-seam-circuit-41940702.png",
        "opacity": 0.2,
        "color": [180, 155, 100],
        "dotCount": 0,
        "dotSpeed": 0
      },
      "narration": {
        "lines": [
          { "text": "...", "enter": 2000, "exit": 5000, "x": 10, "y": 70 }
        ],
        "captions": [
          { "text": "...", "start": 0, "end": 5000 }
        ]
      },
      "audioCues": [
        { "id": "narration", "type": "narration", "src": "assets/audio/narration/01-seam-a1b2c3d4.m4a", "enter": 500, "volume": 1.0, "loop": false, "fadeIn": 0, "fadeOut": null }
      ],
      "effects": {
        "regions": [
          {
            "type": "water",
            "mask": "assets/masks/mask-01-seam-dust-e5f6g7h8.png",
            "direction": 90,
            "speed": 0.3,
            "intensity": 4,
            "scale": 0.01
          }
        ]
      },
      "transition": { "type": "fade", "duration": 1200 }
    }
  ]
}
```

### 4.2 narration Object

```
FIELD    │ TYPE            │ DESCRIPTION
─────────┼─────────────────┼──────────────────────────────────────
lines    │ array           │ Ghost-drift text lines with enter/exit/x/y
captions │ array           │ Timed caption entries with text/start/end (ms)
```

`narration: null` = no narration at all (no text, no captions).

`narration` with `lines`/`captions` but no narration cue in `audioCues` = text + captions but no audio (Scene 8: ghost-drift text with ambient audio only, no narration).

### 4.3 traceOverlay Object (ADR-006A)

```
FIELD    │ TYPE                │ DESCRIPTION
─────────┼─────────────────────┼──────────────────────────────────────
mask     │ string              │ Path to circuit mask PNG (dark pixels = walkable)
opacity  │ number              │ Base trace line opacity (0.0–1.0)
color    │ [r, g, b]           │ RGB glow color for trace lines and dots
dotCount │ number              │ Number of traveling dots (0 = static traces only)
dotSpeed │ number              │ Dot movement speed multiplier
```

`traceOverlay: null` = no trace overlay on this frame. Rendered by `shimmer.js` on the dedicated `#trace-overlay` canvas.

### 4.4 audioCues Array (ADR-003/ADR-005)

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
fadeOut              │ number | null       │ ms fade-out at end. null = no auto-fade.
volumeAfterNarration │ number             │ Target volume after narration ends (faded via wrapOnNarrationEndWithBoost)
fadeAfterNarration   │ number             │ ms fade duration to volumeAfterNarration (default 3000)
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
00 Title             │ 2000
01 Seam              │ 2000
02 Travel            │ 2000
03 Reach             │ 3000
04 Pocket            │ 2000
05 Rinse             │ 2500
06 Storage           │ 2000
07 Missing           │ 2000
08 Empty             │ 16000
09 Return            │ 2000
10 Building          │ 3000
11 Music (credits)   │ 3000 (credits reveal delay)
```

All non-final frames auto-advance after narration + holdAfterNarration. The credits
frame is the last frame, so `shouldAutoAdvance` returns false and `advance()` is
blocked by the CREDITS state. For frame 11, `holdAfterNarration` is still used as
the delay before `revealCreditsPanel()` fires.

### 4.6 Audio Hierarchy

```
1. Narration (loudest, volume: 1.0)
2. Emotional silence (audioCues: null, no audio cues)
3. Ambient texture (volume: 0.08–0.20, loop: true)
4. End song (type: "ambient", anchor-based entry, crescendo to 0.25 over 45s)
```

### 4.7 credits Object (ADR-011)

```
FIELD          │ TYPE   │ DESCRIPTION
───────────────┼────────┼──────────────────────────────────────
scrollDuration │ number │ Total scroll cycle duration (ms)
resumeDelay    │ number │ Idle delay before auto-scroll resumes after manual interaction (ms)
fadeInDuration │ number │ Panel fade-in duration (ms)
repeatDelay    │ number │ Pause at loop restart point before re-scrolling (ms)
```

`credits: null` = no credits overlay on this frame. Only frame 11 (`frameType: "credits"`) has this config. Triggers `revealCreditsPanel()` after narration ends + `holdAfterNarration` delay via `makeNarrationEndCallback()`. See ADR-011 for full specification.

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
  userHasInteracted: false,  // loading-screen interaction flag
  generation: 0,             // incremented on every navigation — guards stale callbacks
  deferFrameAudioUntilResume: false, // true after paused hardJump — next resume schedules frame audio fresh
  pendingPause: false,       // pause queued during transition
  pendingNavIndex: null,     // navigation queued during transition
  buffering: false,          // narration buffer stall active
  textTimeline: null,        // current GSAP timeline
  captionEntries: [],        // active caption DOM entries
  imageCache: new Map(),     // src → Image
  availableAudio: new Set(), // preloaded audio srcs
  audioDurations: new Map(), // src → duration in seconds (from loader.js metadata preload)
  projectMaxCaptionMs: 0,    // max caption end time across all frames (computed at startup)

  lastNavSource: null,         // 'click' | 'keyboard' | null — guards focus management after navigation

  // Timers — PausableTimer instances (state machine concerns, stay in app.js)
  // All audio timers (narration delay, music enter/exit) are internal to audio.js (ADR-005)
  autoAdvanceTimer: null,       // PausableTimer | null
  creditsRevealTimer: null,     // PausableTimer | null — holdAfterNarration delay before credits reveal (ADR-011)
  analysisStartTimer: null,     // PausableTimer | null — delays audio analyser start (ADR-008)
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

### 5.5 setupAutoAdvance (ADR-009)

```js
function setupAutoAdvance(app) {
  const frame = app.frames[app.currentIndex];
  if (!shouldAutoAdvance(app)) {
    clearAutoAdvance(app);
    return;
  }

  const holdAfterNarration = getHoldAfterNarration(frame);

  const hasNarrationAudio = frame.audioCues?.some(c => c.type === 'narration');
  if (hasNarrationAudio) {
    // Full scene timer: narration enter delay + max duration + hold.
    // onNarrationEnd shortens this when narration ends normally (ADR-009).
    const maxMs = getMaxNarrationDuration(frame, app.audioDurations, app.projectMaxCaptionMs);
    const enterDelay = getNarrationEnterDelay(frame, app.audioDurations, maxMs);
    scheduleAutoAdvance(app, enterDelay + maxMs + holdAfterNarration);
  } else {
    scheduleAutoAdvance(app, holdAfterNarration);
  }
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

### 5.6 Loading Screen Gate

Experience starts paused behind the loading screen (`#loading-screen`), which doubles as the start gate. After assets load, a "begin experience" prompt appears inside the loading screen button. This serves two purposes:

1. **Mobile audio context unlock:** The first user gesture enables the AudioContext via Howler's internal unlock.
2. **LCP optimization:** The `.loading-title--main` text serves as the Lighthouse LCP element. On mobile (≤480px), the title-emerge animation uses a 0.2s delay / 0.8s duration (vs 1.2s / 1.8s desktop) to reduce LCP render delay under throttled conditions. See §15.1 for full analysis.

On click: `togglePause()` → `doResume()` → fade-out loading screen (CSS transition, respects `prefers-reduced-motion`) → `handleFirstPlay()` which triggers narration and auto-advance for the first frame.

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
- Pause text timeline, effects canvas, shimmer
- `autoAdvanceTimer?.pause()` — saves remaining auto-advance time
- `creditsRevealTimer?.pause()` — saves remaining reveal delay (ADR-011)
- `pauseCreditsScroll()` — freezes scroll timeline, sets isPaused flag. Wheel scrub still works; auto-resume blocked until doResume (ADR-011)

**doResume():**
- Restore `pausedFromState`, clear pause
- `creditsRevealTimer?.resume()`, `resumeCreditsScroll()` — clears isPaused, resumes scroll (ADR-011)

```
if deferFrameAudioUntilResume:
  deferFrameAudioUntilResume = false
  scheduleFrameAudio(app, currentFrame)    // first real start after paused hardJump or replay
else:
  resumeAudioCues()                        // resume all audio + pending timers
textTimeline.resume()
```

- Resume effects canvas
- `autoAdvanceTimer?.resume()` — reschedule with saved remaining
- If first interaction: fade out loading screen, `cancelAudioCues()`, then `handleFirstPlay()`.

### 5.8 replayNarration() — ADR-004

Full scene reset — identical to hard-jump navigation. `cleanupCurrentScene` kills all audio, effects, text, captions, analyser. `showFrame` reloads effects, rebuilds text, and schedules all audio fresh.

```
replayNarration(app):
  if TRANSITIONING or LOADING: return

  userHasInteracted = true
  cleanupCurrentScene(app)

  if paused:
    deferFrameAudioUntilResume = true
    showFrame(app, currentIndex)
    state = frameState(frame)
    doPause(app)
  else:
    showFrame(app, currentIndex)
    textTimeline.play(0)
    setupAutoAdvance(app)
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
Scene interaction  │ Click stage          │ Tap stage          │ togglePause()
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

- **Stage click/tap → `togglePause()`** — clicking/tapping the scene stage toggles play/pause. Navigation is exclusively via buttons, dots, and keyboard.
- TRANSITIONING: navigation queued as pendingNavIndex, pause queued as pendingPause
- PAUSED: hardJump — no lock, rapid dot-clicking works
- CREDITS: advance disabled (last frame + CREDITS state)

---

## 7. UI Overlay

### 7.1 HTML Structure

```html
<div id="app" role="application" aria-label="carbon-trace visual narrative">
  <button id="loading-screen" aria-label="carbon-trace, begin experience">
    <!-- SVG trace animation + title + #loading-prompt (hidden until ready) -->
  </button>

  <div id="scene-stage" hidden>
    <canvas id="scene-canvas" aria-hidden="true"></canvas>
    <canvas id="effects-canvas" aria-hidden="true"></canvas>   <!-- PixiJS/WebGL — ADR-007 -->
    <canvas id="trace-overlay" aria-hidden="true"></canvas>    <!-- shimmer dots — ADR-006A -->
    <div id="narration-layer" aria-hidden="true"></div>
    <div id="caption-layer" aria-hidden="true"></div>
    <section id="credits-panel" hidden aria-label="Credits">  <!-- ADR-011, z-index 7 -->
      <div id="credits-backdrop" aria-hidden="true"></div>
      <div id="credits-scroll-content"></div>
    </section>
  </div>

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

- Lines positioned absolutely via `x` (%), `y` (%) relative to the narration layer; left-aligned
- Enter: blur(4px) + y:18 → clear + y:0 (1.2s, power3.out)
- Exit: clear → blur(3px) + y:-10 (0.9s, power2.in)
- Lines enter/exit independently, overlap allowed
- If user navigates mid-drift: kill timeline, transition. Interrupt, not queue
- Scene 8: ghost-drift text with ambient audio (no narration) — auto-advances after holdAfterNarration (16000ms)
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

- **16:9 letterbox:** `#app` enforces 16:9 aspect ratio via `width: min(100%, calc(100vh * 16 / 9)); aspect-ratio: 16/9`. Centered within the viewport using flexbox on `body`. Black bars fill remaining viewport area (letterbox on tall screens, pillarbox on wide screens). All content — canvases, narration, controls — is positioned within the 16:9 box. This ensures masks, effects, and text positioning align with the 16:9 source images across all viewport dimensions.
- ResizeObserver on both canvases (scene, effects). DPR-aware sizing. Redraw on resize. **Resize coordination (ADR-007):** scene-canvas resizes via its own ResizeObserver callback (Canvas 2D). effects-canvas resize calls `app.renderer.resize()` on the PixiJS Application — do NOT create a second ResizeObserver for PixiJS. One observer, one resize call, avoids double-resize flicker.
- `clamp()` font sizes: narration text, captions, loading title, loading-screen prompt
- 320px minimum functional width
- `viewport-fit=cover` + `env(safe-area-inset-bottom)` for notched devices

---

## 12. Deployment

See `Dockerfile` and `nginx.conf` at repo root for the canonical deployment configuration. Key design points:

- **Two-stage build:** `node:22-alpine` builder → `nginx:1-alpine` production image
- **Non-root runtime:** runs as `nginx` user with `chown` on `/run` and cache directories
- **Port 8080:** Cloud Run requirement
- **Health check:** `wget` against localhost for container orchestrator liveness
- **Caching strategy:** all `/assets/` content gets 1-year immutable cache (content-hashed filenames guarantee freshness); HTML is no-cache; favicon is 7 days. Audio gets the same 1-year immutable rule plus `Accept-Ranges: bytes` for streaming. Security headers in nginx.
- **Gzip:** enabled for text-based assets (JS, CSS, JSON, SVG)

CSP in `index.html`:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self'; media-src 'self' data:; font-src 'self';
connect-src 'none'; object-src 'none'; base-uri 'self'
```

`style-src` keeps `'unsafe-inline'` because narration positioning is set through
runtime style attributes in `text.js` (per-line x/y coordinates).

**Note:** `connect-src: 'none'` is safe because Howler uses `html5: true` mode (streaming via `<audio>` elements → `media-src`), not XHR/fetch (`connect-src`). Verify across Safari/Chrome/Firefox.

---

## 13. Accessibility

- Canvas: `aria-hidden="true"` on all three canvases (scene, effects, trace-overlay)
- DOM: `aria-live="polite"` narration region populated from caption text
- Keyboard: Arrow ←/→ navigate, Space toggle pause, Escape pause, Enter advance, Tab to controls
- Play/pause button satisfies WCAG 2.2.2 (Pause, Stop, Hide)
- `prefers-reduced-motion`: ghost-drift → opacity fade, transitions → instant, effects static (no displacement/animation, audioReactive ignored — see ADR-007, ADR-008), loading animation disabled
- All buttons: `aria-label`, `aria-pressed` where stateful, `aria-disabled` when inactive
- Focus-visible outlines on all interactive elements
- Captions available as alternative to audio narration

---

## 14. Edge Cases

```
CASE                                │ BEHAVIOR
────────────────────────────────────┼──────────────────────────────
Muted audio                         │ 'end' still fires. Auto-advance works.
No narration audio (Scene 8)        │ holdAfterNarration (16s) used as scene duration.
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
Replay while paused                 │ Full scene reset via cleanupCurrentScene +
                                    │ showFrame. Audio deferred until resume.
                                    │ State stays PAUSED. (ADR-004)
Image load failure                  │ Fallback solid color. Evict from cache.
Audio load failure                  │ onloaderror/onplayerror call onend.
                                    │ Auto-advance chain continues.
Narration buffer stall              │ .buffering CSS spinner. Text timeline pauses.
                                    │ Recovery: nudge-seek → reload → give up.
Scene 11 music + narration          │ End song (type: ambient) scheduled via anchor
                                    │ (ref: narration, offset: -5000). Crescendo from 0
                                    │ to 0.25 over 45s. Both play simultaneously.
                                    │ Terminal — no advance.
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
Total masks         │ ~3.3MB (24 gray+alpha PNG scene masks + 1 noise sprite)
Total audio         │ TBD (narration .m4a + end song .mp3)
JS bundle (vendor)  │ ~150KB gzipped PixiJS v8 + tree-shaken pixi-filters (GlowFilter,
                    │ ShockwaveFilter) (ADR-007). Verify final size during profiling.
Canvas render       │ 60fps during effects, <2ms/frame on baseline hardware
Transition          │ ~0.6-0.75s (half of transition duration, each direction)
```

Progressive loading: first frame blocks, background assets load sequentially by scene, narration pre-buffered one scene ahead.

### 15.1 Mobile LCP Analysis (2026-03-31)

Mobile Lighthouse scores 0.86 under simulated Slow 4G + 4x CPU throttle (approved temporary target: 0.85). Desktop meets target at ≥0.90.

**LCP element:** `.loading-title--main` ("Carbon Trace" text)
**LCP breakdown:** TTFB 451ms (11%) → Render Delay 3,676ms (89%)

Root cause: the initial JS module graph (~175KB uncompressed: GSAP 69KB, Howler 36KB, entry bundle 71KB) blocks the main thread under 4x CPU throttle, preventing the browser from painting the LCP text element. PixiJS is already deferred via dynamic `import()` and does not contribute to LCP.

On viewports ≤480px, the `.loading-title` CSS animation uses a shortened delay (0.2s vs 1.2s desktop) and faster duration (0.8s vs 1.8s) to reduce mobile render delay.

**Resolution path:** Defer GSAP and Howler behind dynamic `import()` in `app.js`, similar to the existing PixiJS lazy-load pattern. This is a moderate refactor — GSAP is used immediately for text timelines and Howler for audio cues, so the deferred imports must resolve before the first scene plays (after the user clicks "begin experience").

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
- Scene 8: holdAfterNarration (16s), ghost-drift text, ambient audio (no narration)
- Replay-while-paused: hard jump reset, stay paused (ADR-004)
- Narration buffer stall detection and recovery
- Accessibility: aria-live, reduced-motion, keyboard, WCAG 2.2.2, captions
- Cloud Run deploy with CI/CD
- Effects registry active: water, heat, dust, glow, shockwave via PixiJS DisplacementFilter (ADR-007)
- End song on Scene 11 using type: ambient with anchor-based entry and 45s crescendo
- Audio-reactive effect modulation on Scene 11 shockwave (ADR-008) — bass-driven amplitude
- Trace shimmer overlays with pixel-walking dots on circuit masks (ADR-006A)

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
  ✓ scene-canvas (Canvas 2D) = static image plane
  ✓ effects-canvas (PixiJS/WebGL) = pixel displacement effects (ADR-007)
  ✓ DOM overlay = semantic plane (text, buttons, a11y)
  ✓ both canvases are aria-hidden="true"
  ✓ only one WebGL context (effects-canvas) — scene stays Canvas 2D
  ✓ GSAP animates DOM elements
  ✓ PixiJS ticker animates effects canvas
  ✓ transitions via GSAP opacity fade on scene-stage container
  ✓ NEVER getImageData() in a render loop for compositing (preserved — PixiJS handles effects on GPU, no exception granted)

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
  ☑ Vite content-hashes assets; nginx serves hashed assets with immutable 1y cache
  ☑ connect-src: 'none' CSP verified — Howler html5:true uses <audio> (media-src),
    E2E test asserts CSP header present
  ☑ All 5 effect types registered (water, heat, dust, glow, shockwave) — no unimplemented warnings
  ☑ WebGL fallback — webglAvailable flag + try/catch; effects degrade to static, no crash
  □ Profile effects <2ms/frame on baseline hardware (manual verification needed)
  □ Verify PixiJS bundle size after tree-shake (target ~150KB gzipped — manual gzip check needed)
  ☑ All 23 mask assets present for scenes with effects — no broken refs
  ☑ Textures loaded via new Image() + Texture.from(), not Assets.load() — CSP-safe
```
