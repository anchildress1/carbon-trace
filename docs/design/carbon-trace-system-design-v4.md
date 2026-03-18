# carbon-trace — System Design v4

**Project:** WeCoded 2026 Frontend Art Entry
**Author:** Ashley Childress (@anchildress1)
**Deadline:** April 5, 2026 @ 11:59 PM PDT

---

## 1. Tech Stack

- **Build:** Vite
- **Rendering:** Canvas 2D (GSAP animates DOM, rAF animates canvas)
- **Animation:** GSAP
- **Audio:** Howler.js
- **Overlay:** Vanilla HTML/CSS (~20 DOM elements, no framework)
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
│   ├── audio.js                # Howler — ambient, narration, replay
│   ├── text.js                 # Ghost-drift text — GSAP timelines
│   ├── captions.js             # Timed captions, localStorage persistence
│   ├── effects.js              # Effect registry — no-op skeleton (v2)
│   ├── overlay.js              # DOM controls — dot bar, buttons
│   └── loader.js               # Audio metadata preloading
├── public/
│   └── assets/
│       ├── images/             # 12 WebP scenes (16:9, 1536×824)
│       ├── audio/ambient/
│       ├── audio/narration/
│       ├── audio/sfx/
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
loadImage(src)             → cached Promise<Image>, evicts on failure
getSceneContext()          → exposes ctx
```

DPR-aware sizing via ResizeObserver. Redraws current image on resize.

### effects-canvas.js

```
initCanvas(el)             → throws on context failure
resume() / pause()         → render loop control
clearAll()                 → pause + clear canvas
```

DPR-aware. Respects `prefers-reduced-motion`.

### audio.js

```
scheduleAudioCues(cues)    → schedule all cues for a frame
cancelAudioCues()          → clear all pending timers + stop all cues
pauseAudioCues()           → freeze all active/pending cues, save elapsed
resumeAudioCues()          → resume from pause point
crossfadeAmbient(fromCues, toCues, ms) → fade out old ambient, schedule new
cueAllAudio(cues)          → load + seek to 0, do NOT play (for hardCut)
getNarrationCue()          → returns active narration Howl (for replay)
setMuted(bool)
```

All Howl instances created at init from config. Preload: true. Never constructed per transition.

`type: "narration"` cue's 'end' event wired once at construction:
```js
howl.on('end', () => onNarrationEnd(frameIndex));
```

Mute affects volume, not playback. 'end' events still fire when muted.

**Cue scheduling:** Each cue's `enter` is scheduled via `setTimeout` + Howler `.fade()`. Anchor references (`enter.ref` + `enter.offset`) resolved at schedule time using preloaded duration metadata from loader.js. If anchor duration is unknown, falls back to `enter: 0`.

**Scene transitions:** `crossfadeAmbient` fades out only `type: "ambient"` cues from the old scene and schedules new ambient cues for the incoming scene. Narration cues are stopped, not crossfaded.

### text.js

```js
function buildTextTimeline(lines, container) {
  const tl = gsap.timeline();
  lines.forEach(line => {
    const el = createLineElement(line.text, container);
    tl.fromTo(el,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" },
      line.enter / 1000
    );
    tl.to(el,
      { opacity: 0, y: -6, duration: 0.6, ease: "power2.in" },
      line.exit / 1000
    );
  });
  return tl;
}
```

Lines overlap based on enter/exit timing. On navigate: kill timeline, hard-set all elements to opacity: 0, clear container.

Reduced motion: swap drift for simple fade. Same content, no spatial movement.

### effects.js (v2 placeholder)

```js
export function startEffect(effectName, ctx, width, height) {
  if (!effectName) return null;
  return null; // cleanup fn
}

export function stopEffect(cleanupFn) {
  if (cleanupFn) cleanupFn();
}
```

app.js calls these in v1. They do nothing. When v2 effects are built, only this file changes.

---

## 4. Frame Configuration

### 4.1 Schema

Every frame has identical shape. `null` = skip feature.

```jsonc
{
  "meta": {
    "title": "carbon-trace",
    "author": "Ashley Childress",
    "aspectRatio": "16:9",
    "defaultTransition": { "type": "fade", "duration": 1200 }
  },
  "frames": [
    {
      "id": "frame-00-title",
      "index": 0,
      "frameType": "title",
      "image": "",
      "holdUntilClick": true,
      "holdAfterNarration": null,
      "textMode": "static",
      "text": null,
      "audioCues": null,
      "effects": { "idle": null, "entry": null },
      "traceOverlay": null,
      "transition": { "type": "fade", "duration": 1500 }
    },
    {
      "id": "scene-01-seam",
      "index": 1,
      "frameType": "scene",
      "image": "assets/images/scene-01-seam.webp",
      "holdUntilClick": false,
      "holdAfterNarration": 2000,
      "textMode": "ghost-drift",
      "text": {
        "lines": [
          { "text": "The world had already decided what everything was.", "enter": 500, "exit": 4000 },
          { "text": "Pressure was not a problem. Pressure was the address.", "enter": 2000, "exit": 6000 }
        ]
      },
      "audioCues": [
        {
          "id": "narration",
          "src": "assets/audio/narration/scene-01-seam.mp3",
          "type": "narration",
          "enter": 500,
          "volume": 1.0,
          "loop": false,
          "fadeIn": 0,
          "fadeOut": 0
        },
        {
          "id": "ambient-01",
          "src": "assets/audio/ambient/scene-01-seam.mp3",
          "type": "ambient",
          "enter": 0,
          "volume": 0.15,
          "loop": true,
          "fadeIn": 1000,
          "fadeOut": null
        }
      ],
      "effects": { "idle": null, "entry": null },
      "transition": { "type": "zoom-in", "duration": 1200, "scale": { "from": 1.0, "to": 1.15 } },
      "traceOverlay": { "opacity": 0.05, "animation": "shimmer" }
    },

    // Scene 8 — holdUntilClick, ghost-drift text, no audio
    {
      "id": "scene-08-stillness",
      "index": 8,
      "frameType": "scene",
      "image": "assets/images/scene-08-stillness.webp",
      "holdUntilClick": true,
      "holdAfterNarration": null,
      "textMode": "ghost-drift",
      "text": {
        "lines": [{ "text": "It is too silent.", "enter": 1000, "exit": 5000 }]
      },
      "audioCues": null,
      "effects": { "idle": null, "entry": null },
      "traceOverlay": { "opacity": 0.2, "animation": "tin-glow" },
      "transition": { "type": "fade", "duration": 1500 }
    },

    // Scene 11 — terminal. Narration + end song. Song fades in under narration.
    {
      "id": "scene-11-music",
      "index": 11,
      "frameType": "credits",
      "image": "assets/images/scene-11-music.webp",
      "holdUntilClick": null,
      "holdAfterNarration": null,
      "textMode": "ghost-drift",
      "persistentVisualState": "machine-running",
      "text": {
        "lines": [
          // TBD — final narration text
        ]
      },
      "audioCues": [
        {
          "id": "narration",
          "src": "assets/audio/narration/scene-11-music.mp3",
          "type": "narration",
          "enter": 500,
          "volume": 1.0,
          "loop": false,
          "fadeIn": 0,
          "fadeOut": 0
        },
        {
          "id": "end-song",
          "src": "assets/audio/ambient/end-song.mp3",
          "type": "ambient",
          "enter": { "ref": "narration", "offset": -5000 },
          "volume": 0.6,
          "loop": false,
          "fadeIn": 3000,
          "fadeOut": null
        }
      ]
    }
  ]
}
```

### 4.2 holdUntilClick Map

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
11 Music             │ null           │ null (has narration + song)
```

### 4.3 Trace Overlay Progression

Traces baked into images. Runtime overlay adds shimmer/emphasis only.

```
SCENE              │ RUNTIME        │ DESCRIPTION
───────────────────┼────────────────┼──────────────────────
01 Seam            │ faint shimmer  │ Part of the rock
02 Travel          │ brief light    │ Conveyor reveals edges
03 Reach           │ heat-pulse     │ First legibility
04 Pocket          │ near-still     │ Almost invisible
05 Rinse           │ water-clarity  │ First true seeing
06 Storage         │ persistence    │ Endures through time
07 Empty           │ light-crack    │ Light activates trace
08 Stillness       │ assembly-micro │ Prior traces converge
09 Return          │ illum-spread   │ Intentional, not chaotic
10 Building        │ room-carry     │ Traces become the light
11 Music           │ machine-steady │ Persistent, running
```

### 4.4 audioCues Schema

Each cue in the `audioCues` array:

```
FIELD    │ TYPE                        │ DESCRIPTION
─────────┼─────────────────────────────┼──────────────────────────────
id       │ string                      │ Unique within frame. Referenced by anchors.
src      │ string                      │ Asset path.
type     │ "narration"|"ambient"|"sfx" │ Determines behavior (see below).
enter    │ number | { ref, offset }    │ ms after scene entry, OR anchor object.
volume   │ number (0.0–1.0)           │ Target volume.
loop     │ boolean                     │ Loop playback.
fadeIn   │ number                      │ ms fade-in duration from 0 to target volume.
fadeOut  │ number | null               │ ms fade-out duration. null = no auto-fade.
```

**Type behavior:**
- `narration`: fires 'end' event for auto-advance. One per frame max. Replay button targets this.
- `ambient`: crossfades on scene transition. Can overlap with narration.
- `sfx`: one-shot, no crossfade, no replay.

**Anchor (enter as object):**
`{ "ref": "narration", "offset": -5000 }` = begin 5000ms before the referenced cue ends.
Resolved at schedule time using preloaded duration metadata. Falls back to `enter: 0` if unknown.

**null audioCues:** `"audioCues": null` = no audio.

### 4.5 Audio Hierarchy

```
1. Narration (loudest, type: "narration")
2. Emotional silence (audioCues: null)
3. Ambient texture (type: "ambient", 0.08–0.20)
4. End song (type: "ambient", 0.6, loop: false)
```

---

## 5. State Machine (app.js)

### 5.1 State

```js
let currentFrame = 0;
let transitioning = false;   // lock — playing only
let paused = false;
let advanceTimer = null;     // setTimeout ref
```

### 5.2 navigate(from, to)

```
navigate(from, to):
  if (to === from) return
  if (to < 0 || to >= len) return
  if (frames[from].holdUntilClick === null) return   // credits
  clearTimeout(advanceTimer)

  if (paused):
    hardCut(from, to)
  else:
    if (transitioning) return
    transitioning = true
    buildAndRunTimeline(from, to)
```

### 5.3 buildAndRunTimeline(from, to) — playing

```
time ──────────────────────────────────────────────►

kill text tl   █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
text exit      ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
kill effects   █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
canvas xfade   ░░░░░████████████░░░░░░░░░░░░░░░░░░░
audio xfade    ░░░░░████████████░░░░░░░░░░░░░░░░░░░
entry effect   ░░░░░░░░░░░░░████████░░░░░░░░░░░░░░░
text enter     ░░░░░░░░░░░░░░░░░████████░░░░░░░░░░░
lock release   ░░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░░░░
sched advance  ░░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░░░░
pending pause  ░░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░░░░

~1.2 - 1.8 seconds per transition
```

**Canvas crossfade:** Two offscreen canvases as sources, composite onto visible canvas via `drawImage()` + `globalAlpha` in rAF loop. Never `getImageData()` in a render loop.

### 5.4 hardCut(from, to) — paused

```
kill active text timeline       → opacity: 0 all elements
kill active effects
audio.cancelAudioCues()        → stop all + clear pending timers
canvas.drawImage(toImg)         → instant, no crossfade
audio.cueAllAudio(toCues)      → loaded, not playing
text.buildTimeline(toConfig)    → built, not started
currentFrame = to
overlay.updateDotBar(to)
```

No lock. No timer. No animation. Scene lands paused and frozen.

### 5.5 scheduleAdvance / scheduleHoldTimer

```js
function scheduleAdvance(idx) {
  clearTimeout(advanceTimer);
  const frame = frames[idx];
  if (frame.holdUntilClick === null) return;
  if (frame.holdUntilClick === true) return;
  if (paused) return;
  if (frame.audioCues?.find(c => c.type === 'narration')) return;  // wait for 'end' event

  holdStartTime = Date.now();
  advanceTimer = setTimeout(
    () => navigate(idx, idx + 1),
    frame.holdAfterNarration ?? 5000
  );
}

function scheduleHoldTimer(idx) {
  if (paused) return;
  if (idx !== currentFrame) return;
  const frame = frames[idx];
  if (frame.holdUntilClick) return;

  holdStartTime = Date.now();
  advanceTimer = setTimeout(
    () => navigate(idx, idx + 1),
    frame.holdAfterNarration ?? 2000
  );
}
```

### 5.6 togglePause()

```
if (transitioning):
  pendingPause = true
  return

paused = !paused
if paused:
  clearTimeout(advanceTimer)
  saveHoldElapsed()
  pauseNarration()
  pauseTextTimeline()
  pauseEffects()
  pauseAudioCues()
  overlay.showPlayIcon()
else:
  resumeNarration()
  resumeTextTimeline()
  resumeEffects()
  resumeAudioCues()
  overlay.showPauseIcon()
  rescheduleRemainingHold()
```

```js
// Pause/resume hold timer precision:
// On set:    holdStartTime = Date.now()
// On pause:  holdElapsed = Date.now() - holdStartTime
//            holdRemaining = holdAfterNarration - holdElapsed
// On resume: advanceTimer = setTimeout(navigate, holdRemaining)
```

---

## 6. Input Handling

```
INPUT              │ DESKTOP              │ MOBILE             │ EFFECT
───────────────────┼──────────────────────┼────────────────────┼─────────────────────
Scene interaction  │ Click / hover stage  │ Tap on stage       │ trigger visual effects (v2)
Navigate to scene  │ Click dot            │ Tap dot            │ navigate(cur, dot)
Forward            │ Click ► / Arrow →    │ Tap ►              │ navigate(cur, cur+1)
Back               │ Click ◄ / Arrow ←    │ Tap ◄              │ navigate(cur, cur-1)
Play/Pause         │ Click ⏯ / Space      │ Tap ⏯              │ togglePause()
Replay narration   │ Click replay btn     │ Tap replay btn     │ replay current
Mute/unmute        │ Click mute btn       │ Tap mute btn       │ toggle all audio
Tab to controls    │ Tab                  │ —                  │ focus management
Auto-advance       │ (internal)           │ (internal)         │ navigate(cur, cur+1)
```

- Stage click/tap does NOT navigate — reserved for visual effects (hover text, particle triggers, etc.)
- Playing + transitioning: inputs rejected
- Paused: hardCut, no lock, rapid dot-clicking works
- Credits: advance disabled (`holdUntilClick === null`)
- holdUntilClick scenes: no auto-advance, forward button still navigates

---

## 7. UI Overlay

### 7.1 HTML Structure

```html
<div id="app">
  <canvas id="scene-canvas" aria-hidden="true"></canvas>
  <canvas id="effects-canvas" aria-hidden="true"></canvas>

  <div id="overlay">
    <div id="narration-layer">
      <!-- ghost-drift lines injected by text.js -->
    </div>

    <nav id="control-bar" aria-label="Scene navigation and controls">
      <!-- ONE unified bar. All controls in this container. -->
    </nav>
  </div>

  <div id="a11y-narration" class="sr-only" aria-live="polite"></div>
  <div id="loading" aria-live="assertive"></div>
</div>
```

### 7.2 Controls

```
ELEMENT          │ FUNCTION                        │ NOTES
─────────────────┼─────────────────────────────────┼────────────────────
Back button      │ navigate(current, current - 1)  │ SVG icon
Forward button   │ navigate(current, current + 1)  │ SVG icon
Dot bar          │ 12 dots, click any to jump       │ Active dot distinct
Play/Pause btn   │ togglePause()                   │ Swaps icon on state
Replay button    │ Re-trigger current narration     │ SVG icon
Mute button      │ Toggle all audio on/off         │ Swaps icon on state
```

### 7.3 Design Constraints

- Controls feel atmospheric, not chrome — semi-transparent, subtle
- ONE unified bar. No separate floating control groups
- SVG icons from library (Lucide, Phosphor, or similar). No emoji/Unicode
- WCAG AA contrast, 44×44px tap targets, visible focus outlines
- Dot bar: `role="group"` with `aria-label`, dots as `<button>`, `aria-current="step"` on active
- Bar works at 320px. Dots shrink gracefully. No second-line wrap
- Bar fades with scene transitions. No pop/jump during changes
- Backdrop blur, refined spacing, 2026 aesthetic

### 7.4 AI Decides

- Layout within bar, backdrop treatment, icon library/size/weight/color
- Dot styling, hover/focus states, bar position, full-width vs centered

### 7.5 AI Does NOT Decide

- Which controls exist (defined above)
- That it's one bar
- That icons come from a library
- Accessibility requirements
- That narration layer is separate from control bar

---

## 8. Ghost-Drift Text

```
line 1:  ░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░
line 2:  ░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░
line 3:  ░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░
```

- Lines enter/exit independently, overlap allowed
- enter/exit: ms after scene start
- GSAP opacity + subtle Y drift on DOM overlay
- If user advances mid-drift: kill timeline, transition. Interrupt, not queue
- Scene 8: minimal text, no audio
- Reduced motion: simple fade, no spatial drift
- Stable `aria-live="polite"` region mirrors all narration text for screen readers

---

## 9. Responsive

- 16:9 locked. Canvas letterboxed with black
- ResizeObserver. DPR-aware canvas sizing. Redraw on resize
- `clamp()` font sizes on DOM overlay
- 320px minimum functional width

---

## 10. Deployment

```dockerfile
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
```

```nginx
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location ~* \.(webp|mp3|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## 11. Accessibility

- Canvas: `aria-hidden="true"`
- DOM: `aria-live="polite"` narration region
- Keyboard: Arrow ←/→ navigate, Space toggle pause, Tab to controls
- Play/pause button satisfies WCAG 2.2.2
- `prefers-reduced-motion`: ghost-drift → fade, effects → minimal, transitions → instant
- Narration text always in DOM, not dependent on audio
- WCAG AA contrast on narration panel and controls

---

## 12. Edge Cases

```
CASE                                │ BEHAVIOR
────────────────────────────────────┼──────────────────────────────
Muted audio                         │ 'end' still fires. Auto-advance works
No narration cue (v1 gap)           │ holdAfterNarration = total scene duration
Skip mid-narration (playing)        │ cancelAudioCues, crossfade ambient, stop narration
Click during transition (playing)   │ Rejected (transitioning = true)
Navigate while paused               │ hardCut. Lands paused. Play to start
Pause during transition             │ pendingPause. Transition finishes, then freezes
Pause during holdAfterNarration     │ Save elapsed. Resume: reschedule remaining
Scene 8 + paused                    │ No timer. Pause freezes text. Click = hardCut
Scene 8 + playing                   │ No timer. Holds indefinitely. Click = crossfade
Credits via auto-advance            │ scheduleAdvance returns. End song plays. Done
Replay while playing                │ Restart narration + text. Clear timer. 'end' re-arms
Replay while paused                 │ Cue narration + text. Play to hear replay
Image load failure                  │ Evict from cache. Fallback solid color frame
Audio load failure                  │ Degrade gracefully. Timer fallback
Cue enter > 0 + navigate early      │ cancelAudioCues. Cue never starts.
Cue fadeOut fires during pause       │ Frozen. Resumes on un-pause.
Navigate during active cues          │ crossfadeAmbient for ambient cues,
                                    │ cancelAudioCues for rest.
Scene 11 narration + song overlap   │ Both cues play simultaneously. Song
                                    │ anchored to narration via enter.ref.
                                    │ Song continues after narration ends.
                                    │ Terminal — no advance.
Scene 11 skip (user navigates away) │ crossfadeAmbient fades song. Normal.
                                    │ Return = restart all cues from top.
Anchor ref duration unknown          │ Falls back to enter: 0 if metadata missing.
```

---

## 13. Performance Budget

```
First paint         │ <2s
Interactive         │ <10s (all images loaded)
Total assets        │ <35MB
Canvas render       │ 60fps during effects
Transition          │ ~1.2-1.8s
```

Preload ALL 12 images on init (~2-5MB at 1536×824 WebP). Block on images, audio streams.

---

## 14. v1 Scope (ships April 5)

- All 12 frames with canvas crossfade transitions
- Narration-driven auto-advance with play/pause
- Ghost-drift text (DOM overlay + GSAP)
- audioCues system: narration, ambient, anchored cues
- End song on Scene 11 anchored to narration
- Dot bar + forward/back + keyboard
- Scene 8: holdUntilClick, ghost-drift text, no audio
- Accessibility: aria-live, reduced-motion, keyboard, WCAG 2.2.2
- Cloud Run deploy with CI/CD
- Ambient cues deferred for most scenes (audioCues: null, architecture ready)

---

## 15. Build Order

**Phase 1 — Skeleton (Days 1-3)**
1. Scaffold Vite, scenes.json with all 12 frames
2. canvas.js: drawImage, cover-fit, resize, image cache
3. app.js: navigate, transition lock, dot bar routing
4. DOM overlay: dot bar, forward/back, keyboard

**Phase 2 — Core (Days 4-8)**
5. text.js: GSAP timelines, overlap, cleanup
6. audio.js: Howler init, audioCues scheduling, anchor resolution, replay, mute
7. Canvas crossfade: offscreen compositing
8. Auto-advance + play/pause + hardCut
9. Scene 8: holdUntilClick, ghost-drift text, null audio

**Phase 3 — Polish (Days 9-14)**
10. End song on credits
11. Accessibility: aria-live, reduced-motion, keyboard
12. Control bar design + styling
13. Mobile testing

**Phase 4 — Assets & Deploy (Days 15-20)**
14. Finalize images (parallel from Day 1)
15. Record/finalize narration
16. Dockerfile + nginx + CI/CD

**Phase 5 — Submit (Days 21-25)**
17. Frontend Art submission post
18. Final device testing
19. Submit

---

## 16. Rules

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
  ✓ canvas is aria-hidden="true"
  ✓ GSAP animates DOM elements
  ✓ requestAnimationFrame animates canvas
  ✓ crossfade via offscreen canvas + drawImage + globalAlpha
  ✓ NEVER getImageData() in a render loop for compositing

STATE:
  ✓ four variables: currentFrame, transitioning, paused, advanceTimer
  ✓ lock released ONLY in onComplete
  ✓ transitioning lock ONLY when playing — paused = hardCut
  ✓ advanceTimer cleared on EVERY navigate()
  ✓ paused survives navigation
  ✓ togglePause() is the ONLY paused writer
  ✓ pause during transition queued via pendingPause

NEVER:
  ✗ hardcoded frame indices in if/else
  ✗ multiple functions for same navigation action
  ✗ audio cues for intermediate frames on multi-frame jump
  ✗ text drawn on canvas
  ✗ cross-imports between leaf modules
  ✗ global GSAP timelines
  ✗ releasing locks before async completes
  ✗ constructing Howl instances on the fly
  ✗ framework for 20 DOM elements
  ✗ temporarily un-pausing for transitions
  ✗ auto-advancing during pause
  ✗ losing pause state across navigation
  ✗ transitioning lock during paused navigation
  ✗ advanceTimers without clearing previous
  ✗ killing mid-flight GSAP timelines on pause
  ✗ getImageData() in render loop for compositing
  ✗ playing cues immediately when enter > 0 (schedule them)
  ✗ orphaned cue timers after navigate (cancelAudioCues)
  ✗ separate ambient/narration config slots (use audioCues array)

PRE-SHIP CHECKLIST:
  □ Narration 'end' events use generation counter, not just
    frame index, to guard stale events from rapid navigation
  □ Per-image error handling with fallback solid color frame
  □ Audio load failures degrade gracefully
  □ Verify Vite content-hashes assets, or drop "immutable"
    from nginx cache for public/ assets during iteration
  □ Validate holdAfterNarration >= max(text.lines[].exit) when
    no narration cue exists — console.error if violated
  □ Anchor ref resolution tested with preloaded + missing metadata
```
