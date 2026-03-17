# carbon-trace — System Design v3 (Final)

**Project:** WeCoded 2026 Frontend Art Entry
**Author:** Ashley Childress (@anchildress1)
**Deadline:** April 5, 2026 @ 11:59 PM PDT
**Judged on:** Creativity, Effective Use of Frontend Technology, Aesthetic Outcome

---

## 1. What This Is

An immersive, click-to-advance visual narrative told from the awareness of a diamond trapped in a coal seam. 12 frames (title + 10 scenes + credits). Canvas 2D-rendered painterly art with GSAP-driven ghost-drift text in a DOM overlay, per-scene visual effects via pixel manipulation, ambient audio layers, recorded narration in Ashley's voice, and a circuit trace motif that becomes legible as the story progresses. Not a gallery — an empathy engine.

---

## 2. Tech Stack

```
LAYER        │ TOOL         │ WHY
─────────────┼──────────────┼──────────────────────────────────────────
Build        │ Vite         │ Fast HMR, ES modules, tree-shakes GSAP/Howler.
             │              │ Already known — no learning curve during deadline.
─────────────┼──────────────┼──────────────────────────────────────────
Rendering    │ Canvas 2D    │ Direct pixel read/write via getImageData /
             │              │ putImageData. Required for v2 runtime trace
             │              │ rendering. Pixel effects (ripple, dust, light
             │              │ bloom) impossible with CSS — CSS moves boxes,
             │              │ not pixels. Start with the renderer you need
             │              │ later so you don't switch mid-project.
─────────────┼──────────────┼──────────────────────────────────────────
Animation    │ GSAP         │ Ghost-drift text (DOM overlay), scene transition
             │              │ orchestration, zoom. Timeline API = workflow
             │              │ orchestrator. CSS keyframes can't sequence across
             │              │ elements or fire callbacks mid-animation.
             │              │ GSAP animates DOM overlay. Canvas uses rAF.
─────────────┼──────────────┼──────────────────────────────────────────
Audio        │ Howler.js    │ Simultaneous ambient + narration with crossfade.
             │              │ Mobile autoplay unlock. .fade(), .loop(), .volume().
             │              │ Raw Web Audio API = wiring gain nodes by hand.
             │              │ HTML5 <audio> = single track, no mixing.
─────────────┼──────────────┼──────────────────────────────────────────
Overlay      │ Vanilla HTML │ ~20 DOM elements on top of canvas. Narration text,
             │              │ dot bar, buttons, accessibility. Screen readers
             │              │ see the DOM layer, not the canvas. No framework.
─────────────┼──────────────┼──────────────────────────────────────────
Images       │ Leonardo AI  │ Painterly/impressionistic, circuit traces baked in,
             │              │ consistent style across all frames.
─────────────┼──────────────┼──────────────────────────────────────────
Deploy       │ Cloud Run    │ Vite builds to dist/. nginx serves static assets.
             │ + nginx      │ Deployed on existing verified domain. CI/CD via
             │ + GitHub     │ GitHub Actions. Container-based, production-grade.
             │   Actions    │
```

**Why Canvas 2D over DOM+CSS:** v2 trace rendering needs pixel access. Switching renderers mid-project is worse than starting with the right one. Pixel effects (ripple, dust particles, light bloom) require getImageData() / putImageData() — CSS operates on element boxes, not pixels. The cost is accessibility (canvas is a black box to screen readers) which is handled by a DOM overlay layer on top.

**Why Canvas 2D over WebGL:** WebGL is a GPU shader pipeline — massive overkill for 2D image rendering and pixel manipulation. No 3D, no scene graphs, no shader compilation needed.

**Why no framework:** No component reuse justifies React. Linear path, one page, minimal DOM overlay. GSAP animates DOM text, Canvas handles visuals. Adding React for ~20 overlay elements is overhead.

---

## 3. Project Structure

```
carbon-trace/
├── index.html                  # Single page — canvas + DOM overlay shell
├── vite.config.js
├── package.json
│
├── src/
│   ├── main.js                 # Entry — load config, init modules, bind events
│   ├── scenes.json             # All 12 frame definitions (§4)
│   ├── navigator.js            # State machine + navigate(from, to) router
│   ├── canvas.js               # Canvas 2D — image drawing, crossfade, resize
│   ├── audio.js                # Howler — ambient crossfade, narration, replay
│   ├── text.js                 # Ghost-drift text — GSAP timelines from config
│   ├── effects.js              # v2 — placeholder with no-op handling
│   ├── overlay.js              # DOM controls — dot bar, replay, mute, progress
│   └── loader.js               # Image preloading into cache, loading state
│
├── public/
│   └── assets/
│       ├── images/             # Leonardo AI scenes (WebP, 16:9, 2x)
│       │   ├── frame-00-title.webp
│       │   ├── scene-01-buried.webp
│       │   ├── scene-02-moved.webp
│       │   ├── scene-03-oven-threshold.webp
│       │   ├── scene-04-pocket.webp
│       │   ├── scene-05-keeper.webp
│       │   ├── scene-06-stillness.webp
│       │   ├── scene-07-return.webp
│       │   ├── scene-08-device.webp
│       │   ├── scene-09-activation.webp
│       │   ├── scene-10-gathering.webp
│       │   └── frame-11-credits.webp
│       ├── overlays/           # Circuit trace overlay images (v2 if needed)
│       ├── audio/
│       │   ├── ambient/        # Per-scene loops (subliminal level)
│       │   ├── narration/      # Ashley's recorded narration per scene
│       │   └── sfx/            # Transition SFX (minimal, if any)
│       └── fonts/
│
├── Dockerfile                  # nginx + dist/ for Cloud Run
├── nginx.conf                  # Static serve config
├── .github/
│   └── workflows/
│       └── deploy.yml          # Build → push image → deploy Cloud Run
└── README.md
```

**Rule:** each file does one job. canvas.js never touches audio.
audio.js never touches DOM. navigator.js calls them all.

---

## 4. Frame & Scene Configuration

### 4.1 Frame Types

```
TYPE     │ BEHAVIOR
─────────┼─────────────────────────────────────────────────────
title    │ Static or slow-animated. Click/tap begins + unlocks audio.
scene    │ Interactive narrative. Click/dot/keyboard advances.
         │ Ghost-drift text. Ambient audio. Effects.
credits  │ Terminal. No advance. Music persists. Bio, RAI, links.
```

### 4.2 Schema

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
      "image": "assets/images/frame-00-title.webp",
      "advanceMode": "click",
      "textMode": "static",
      "narration": null,
      "ambient": null,
      "effects": { "idle": null, "entry": null },
      "traceOverlay": null,
      "transition": { "type": "fade", "duration": 1500 }
    },
    {
      "id": "scene-01-buried",
      "index": 1,
      "frameType": "scene",
      "image": "assets/images/scene-01-buried.webp",
      "advanceMode": "click",

      "textMode": "ghost-drift",
      "narration": {
        "lines": [
          { "text": "The world had already decided what everything was.", "enter": 500, "exit": 4000 },
          { "text": "Pressure was not a problem. Pressure was the address.", "enter": 2000, "exit": 6000 }
        ],
        "audio": "assets/audio/narration/scene-01-buried.mp3",
        "delay": 500
      },

      "ambient": {
        "src": "assets/audio/ambient/scene-01-buried.mp3",
        "volume": 0.15,
        "loop": true
      },

      "effects": {
        "idle": null,
        "entry": null
      },

      "transition": {
        "type": "zoom-in",
        "duration": 1200,
        "scale": { "from": 1.0, "to": 1.15 }
      },

      "traceOverlay": {
        "opacity": 0.05,
        "animation": "shimmer"
      }
    },

    // Scene 6 — THE STILLNESS (one scene, no phases)
    {
      "id": "scene-06-stillness",
      "index": 6,
      "frameType": "scene",
      "image": "assets/images/scene-06-stillness.webp",
      "advanceMode": "click",
      "textMode": "ghost-drift",
      "narration": {
        "lines": [
          { "text": "It is too silent.", "enter": 1000, "exit": 5000 }
        ],
        "audio": null,
        "delay": 0
      },
      "ambient": null,
      "effects": { "idle": null, "entry": null },
      "traceOverlay": { "opacity": 0.2, "animation": "tin-glow" },
      "transition": { "type": "fade", "duration": 1500 }
    },

    // Credits — terminal frame
    {
      "id": "frame-11-credits",
      "index": 11,
      "frameType": "credits",
      "image": "assets/images/frame-11-credits.webp",
      "advanceMode": "disabled",
      "textMode": "static",
      "persistentVisualState": "machine-running",
      "narration": null,
      "ambient": { "src": "assets/audio/ambient/end-song.mp3", "volume": 0.6, "loop": false }
    }
  ]
}
```

### 4.3 Config Rules

```
DO:
  ✓ every frame has the SAME shape — same keys, same types
  ✓ null means "skip this feature" — audio checks for null, does nothing
  ✓ scene differences expressed as DATA not LOGIC
  ✓ add new per-scene behavior by adding a config key, not an if-block
  ✓ explicit full asset paths — never construct from scene id

DON'T:
  ✗ if (frame.id === 'stillness') anywhere outside effects.js
  ✗ optional keys that only exist on some frames
  ✗ different schema shapes for different frame types
```

### 4.4 Ghost-Drift Text Behavior

```
line 1:  ░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░
line 2:  ░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░
line 3:  ░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░

- Lines pour in and blow out independently — overlap allowed
- enter/exit: ms after scene starts when line begins appearing/disappearing
- GSAP drives opacity + subtle Y drift on DOM overlay (not on canvas)
- Lines do NOT wait for each other
- Some phrases vanish before others fully arrive
- If user advances mid-drift: kill text timeline, run transition. Interrupt, not queue.

Special scenes:
- Scene 6: text present but minimal — stillness with context
- Scene 8: brief narration only — image does the work
- Scene 10: single-pass, spare — one last line

Reduced motion: prefers-reduced-motion swaps ghost-drift for simple
fade-in/out or static. Same content, no spatial drift.
```

### 4.5 Circuit Trace Overlay Progression

All traces baked into Leonardo AI images. Runtime overlay adds shimmer/emphasis only.

```
SCENE              │ BAKED        │ RUNTIME        │ DESCRIPTION
───────────────────┼──────────────┼────────────────┼──────────────────────
01 Buried          │ hairline     │ faint shimmer  │ Part of the rock
02 Moved           │ catches      │ brief light    │ Conveyor reveals edges
03 Oven Threshold  │ stress-bright│ heat-pulse     │ First legibility
04 Pocket          │ residue only │ near-still     │ Almost invisible
05 Keeper          │ clean read   │ water-clarity  │ First true seeing
06 Stillness       │ tin-glow     │ persistence    │ Endures through time
07 Return          │ reflexive    │ light-crack    │ Light activates trace
08 Device          │ converging   │ assembly-micro │ Prior traces converge
09 Activation      │ purposeful   │ illum-spread   │ Intentional, not chaotic
10 Gathering       │ diffusing    │ room-carry     │ Traces become the light
11 Credits         │ stable       │ machine-steady │ Persistent, running
```

**v1:** Baked traces in images + canvas-drawn shimmer overlay per scene.
**v2:** Runtime procedural trace rendering via Canvas pixel ops — why we start with Canvas now.

---

## 5. Architecture

### 5.1 Two Rendering Layers

```
┌──────────────────────────────────────────────────┐
│              WHAT THE USER SEES                  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │      DOM OVERLAY (position: absolute)    │ ◄── text, buttons, dots, a11y
│  │      GSAP animates this layer            │    screen readers see THIS
│  ├──────────────────────────────────────────┤    │
│  │      CANVAS 2D                           │ ◄── images, pixel effects, traces
│  │      rAF animates this layer             │    screen readers see NOTHING here
│  └──────────────────────────────────────────┘    │
│                                                  │
│  canvas = visual data plane (pixels)             │
│  DOM = control/accessibility plane (semantics)   │
└──────────────────────────────────────────────────┘
```

Canvas is aria-hidden="true". All semantic content lives in DOM overlay.

### 5.2 Dependency Graph

```
                     main.js
                       │
                       │ imports + wires event listeners
                       │
               ┌───────┴───────┐
               │               │
           navigator.js    loader.js
               │
     ┌─────────┼──────────┐
     │         │          │
  canvas.js  audio.js   text.js
     │         │          │
  effects.js   │       overlay.js (dot bar, controls)
               │
          no cross-imports
          between leaf modules

scenes.json ← imported by navigator, loader, audio (init)

main → navigator, loader
navigator → canvas, effects, audio, text, overlay, scenes
loader → scenes (reads image list), canvas (image cache)
canvas → nothing (receives config, draws pixels)
effects → canvas (reads/writes pixels via canvas API)
audio → nothing (receives config, returns Howl refs)
text → nothing (receives config + container, returns timeline)
overlay → nothing (receives state, updates DOM)

NO CYCLES. effects.js may call canvas functions for pixel access.
No other cross-calls between leaf modules.
```

### 5.3 Navigator — the router (navigator.js)

```
┌──────────────────────────────────────────────────────────────┐
│                        NAVIGATOR                             │
│                                                              │
│  state:                                                      │
│    currentFrame = 0           ← which frame is showing       │
│    transitioning = false      ← rate limiter                 │
│                                                              │
│  inputs (ALL resolve to one function):                       │
│    dot click      → navigate(currentFrame, clickedIndex)     │
│    forward btn    → navigate(currentFrame, currentFrame + 1) │
│    back btn       → navigate(currentFrame, currentFrame - 1) │
│    keyboard →     → navigate(currentFrame, currentFrame + 1) │
│    keyboard ←     → navigate(currentFrame, currentFrame - 1) │
│    click on stage → navigate(currentFrame, currentFrame + 1) │
│                                                              │
│  navigate(from, to):                                         │
│    if (transitioning) return          ← 429                  │
│    if (to === from) return            ← no-op                │
│    if (to < 0 || to >= len) return    ← 404                  │
│    if (frames[from].advanceMode       ← credits = dead end   │
│        === 'disabled') return                                │
│    transitioning = true               ← acquire lock         │
│    buildAndRunTimeline(from, to)      ← GSAP + canvas        │
│    onComplete → {                                            │
│      currentFrame = to                ← commit               │
│      overlay.updateDotBar(to)         ← update UI            │
│      transitioning = false            ← release lock         │
│    }                                                         │
│                                                              │
│  LOCK RELEASED IN GSAP onComplete ONLY. NEVER BEFORE.        │
└──────────────────────────────────────────────────────────────┘
```

**One function. Five callers.** Do NOT write separate next() / prev() / jumpTo().

Transition sequence inside navigate():

```
time ──────────────────────────────────────────────►

kill text tl   █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
text exit      ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
kill effects   █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
canvas xfade   ░░░░░████████████░░░░░░░░░░░░░░░░░░░  ← rAF-driven dissolve
audio xfade    ░░░░░████████████░░░░░░░░░░░░░░░░░░░  ← parallel with canvas
entry effect   ░░░░░░░░░░░░░████████░░░░░░░░░░░░░░░  ← canvas pixel effect
text enter     ░░░░░░░░░░░░░░░░░████████░░░░░░░░░░░  ← GSAP on DOM overlay
lock release   ░░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░░░░  ← onComplete

total: ~1.2 - 1.8 seconds per transition
```

### 5.4 Canvas (canvas.js)

```
┌──────────────────────────────────────────────────────────┐
│                    CANVAS MODULE                          │
│                                                          │
│  responsibilities:                                       │
│    • draw an image to canvas (cover-fit, centered)       │
│    • crossfade from current image to new image           │
│    • expose ctx for effects.js pixel manipulation        │
│    • resize handling (maintain 16:9, letterbox)           │
│                                                          │
│  does NOT know:                                          │
│    • what frame number it's on                           │
│    • what audio is playing                               │
│    • what text is showing                                │
│    • whether navigation is locked                        │
│                                                          │
│  key functions:                                          │
│    drawImage(img)                                        │
│    crossfade(fromImg, toImg, duration, onComplete)       │
│    getContext() → exposes ctx for effects.js             │
│    handleResize() → recalculate dims, redraw current     │
└──────────────────────────────────────────────────────────┘
```

**Crossfade:** Capture current canvas as ImageData. Draw new image. Blend frames over duration using globalAlpha in a requestAnimationFrame loop. Call onComplete when done.

**Resize:** ResizeObserver on container. Recalculate canvas dimensions maintaining 16:9. Handle devicePixelRatio for retina. Letterbox with black. Redraw current image — don't re-transition.

**Image cache:** Map<string, Image> populated by loader.js at startup.

### 5.5 Audio (audio.js)

```js
// State
let currentAmbient = null;
let currentNarration = null;
let muted = false;

// Functions
crossfadeAudio(fromConfig, toConfig, ms)  // fade out FROM, fade in TO
playNarration(config)                      // one-shot, returns Howl ref for replay
stopNarration()                            // kill current narration if playing
setMuted(bool)                             // toggle all audio
```

**Arbitrary jumps:** crossfade takes fromConfig and toConfig. When jumping frame 2 → frame 9: fade out frame 2's ambient, fade in frame 9's ambient, stop frame 2's narration. Do NOT play frames 3-8.

**Credits song:** Lives in credits frame's ambient config slot. crossfadeAudio fades it in like any other ambient. Navigate away = fades out. Return = restarts. No special channel.

**Ambient deferred for v1:** All scene ambient config slots are null except credits. Architecture ready — when ambient assets exist, drop in paths, everything works.

```
Audio hierarchy (enforced by volume levels in config):
  1. Narration (loudest)
  2. Emotional silence (ambient: null)
  3. Ambient texture (0.08–0.20)
  4. End song (ambient slot, 0.6, loop: false)
```

**Mobile autoplay:** First click on title frame unlocks AudioContext via Howler.

**Instance lifecycle:** Create all Howl instances at init from config. Preload: true. Pool — not constructed per transition.

### 5.6 Ghost-Drift Text (text.js)

Builds a GSAP timeline per scene from narration.lines config:

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

Lines overlap naturally based on enter/exit timing. No queue. No wait.

**On navigate:** Kill active text timeline. Hard-set all narration line elements to opacity: 0 (prevents stale mid-tween DOM artifacts). Clear container. Then run exit animation.

Stable DOM narration for accessibility in separate aria-live="polite" region.

### 5.7 Effects (effects.js) — v2, placeholder in v1

**v2 scope. Ships as a no-op placeholder with handling so navigator doesn't need to change when effects are added.**

```js
// effects.js — v1 placeholder

export function startEffect(effectName, ctx, width, height) {
  if (!effectName) return null;
  // v2: dispatch to effect functions here
  return null; // cleanup fn — null = nothing to clean up
}

export function stopEffect(cleanupFn) {
  if (cleanupFn) cleanupFn();
}
```

Navigator calls `startEffect()` and `stopEffect()` in v1. They do nothing. When v2 effects are built, navigator code doesn't change — only this file does.

```
v2 MODULE CONTRACT:
  - receives canvas context + dimensions
  - runs effect in a requestAnimationFrame loop
  - returns a cleanup function that stops the loop

v2 CONFIG SLOT (per frame in scenes.json):
  "effects": { "idle": "effect-name" | null, "entry": "effect-name" | null }
  null = no effect for that slot
```

### 5.8 Input Handling

Handled in main.js, routed to navigator.navigate():

```
INPUT              │ DESKTOP              │ MOBILE
───────────────────┼──────────────────────┼──────────────
Advance            │ Click on stage       │ Tap on stage
Navigate to scene  │ Click dot            │ Tap dot
Forward            │ Click ► / Arrow →    │ Tap ►
Back               │ Click ◄ / Arrow ←    │ Tap ◄
Replay narration   │ Click replay btn     │ Tap replay btn
Mute/unmute        │ Click mute btn       │ Tap mute btn
Advance (alt)      │ Space / Enter        │ —
Tab to controls    │ Tab                  │ —
```

All inputs → navigate(currentFrame, targetIndex).
Locked during TRANSITIONING.
Credits: advance disabled.

---

## 6. UI Overlay

### 6.1 Design Constraints (AI has creative latitude within these)

**Overall feel:** The controls belong to the art, not on top of it. They should feel like they emerged from the same visual world as the scenes — not like a media player bolted onto a painting.

```
CONSTRAINT                     │ RULE
───────────────────────────────┼─────────────────────────────────────────
Visual integration             │ Controls feel atmospheric, not chrome.
                               │ Semi-transparent, subtle, present but
                               │ not competing with the scene image.
───────────────────────────────┼─────────────────────────────────────────
One unified bar                │ All controls live in ONE cohesive bar.
                               │ Nav dots, forward/back, replay, mute —
                               │ one element, one visual treatment.
                               │ No separate floating control groups.
───────────────────────────────┼─────────────────────────────────────────
Icons                          │ SVG icon library (Lucide, Phosphor, or
                               │ similar). No emoji. No Unicode symbols.
                               │ Icons must be styleable via CSS.
───────────────────────────────┼─────────────────────────────────────────
Accessibility                  │ WCAG AA contrast on interactive elements.
                               │ Visible focus outlines (styled, not
                               │ browser default). Minimum 44×44px tap
                               │ targets on mobile. aria-labels on all
                               │ buttons. role="tablist" on dot bar.
───────────────────────────────┼─────────────────────────────────────────
Responsive                     │ Bar works at 320px. Dots shrink or
                               │ truncate gracefully. Controls don't
                               │ wrap to a second line.
───────────────────────────────┼─────────────────────────────────────────
Transitions                    │ Bar fades with scene transitions.
                               │ Controls don't pop/jump during scene
                               │ changes. Hover/focus states are smooth.
───────────────────────────────┼─────────────────────────────────────────
Modern                         │ This is a frontend art competition.
                               │ The control bar should look like it was
                               │ designed in 2026, not 2015. Backdrop
                               │ blur, refined spacing, contemporary
                               │ icon weight, considered typography.
```

### 6.2 Functional Requirements

```
ELEMENT          │ FUNCTION                        │ NOTES
─────────────────┼─────────────────────────────────┼────────────────────
Back button      │ navigate(current, current - 1)  │ Icon: chevron/arrow left
Forward button   │ navigate(current, current + 1)  │ Icon: chevron/arrow right
Dot bar          │ 12 dots, click any to jump       │ Active dot visually distinct
Replay button    │ Re-trigger current narration     │ Icon: replay/rotate
Mute button      │ Toggle all audio on/off         │ Icon: volume / volume-off
                 │                                 │ Swaps icon on state change
```

### 6.3 Structural Requirements

```html
<div id="app">
  <canvas id="scene-canvas" aria-hidden="true"></canvas>

  <div id="overlay">
    <div id="narration-layer">
      <!-- ghost-drift lines injected by text.js -->
    </div>

    <nav id="control-bar" aria-label="Scene navigation and controls">
      <!-- ONE unified bar. Internal layout is AI's decision.
           All buttons + dots + controls in this single container.
           Suggested order: back, dots, forward, replay, mute
           but AI can rearrange within the bar if it makes
           better visual/UX sense. -->
    </nav>
  </div>

  <div id="a11y-narration" class="sr-only" aria-live="polite"></div>
  <div id="loading" aria-live="assertive"></div>
</div>
```

### 6.4 What AI Decides (within constraints)

- Exact layout within the bar (spacing, grouping, separators)
- Backdrop treatment (blur amount, opacity, color)
- Icon library choice and specific icons
- Icon size, weight, color
- Dot size, active state treatment (color, scale, glow, etc.)
- Hover and focus state styling
- Bar position (bottom, bottom-inset, etc.)
- Whether bar is full-width or centered
- Transition behavior (fade timing, delay)

### 6.5 What AI Does NOT Decide

- Which controls exist (defined above)
- That it's one bar (non-negotiable)
- That icons come from a library, not emoji/Unicode
- Accessibility requirements (contrast, tap targets, aria)
- That narration layer is separate from the control bar

---

## 7. Asset Pipeline

### 7.1 Images

- Leonardo AI, consistent painterly/impressionistic style
- 16:9 aspect ratio, all frames
- 2x resolution (3840×2160) for retina, exported as WebP
- Circuit traces baked into each image at scene-appropriate visibility
- Naming: {frame-type}-{index}-{slug}.webp
- Originals in /originals/ (git-ignored)

### 7.2 Audio

```
TYPE       │ FORMAT        │ LEVEL              │ NOTES
───────────┼───────────────┼────────────────────┼────────────────────────
Ambient    │ MP3, 128kbps  │ Subliminal         │ Deferred for v1 except
           │               │ (0.08–0.20)        │ credits song. null = silence.
───────────┼───────────────┼────────────────────┼────────────────────────
Narration  │ MP3, 192kbps  │ Primary            │ Ashley's voice, southern
           │               │                    │ Appalachian cadence
───────────┼───────────────┼────────────────────┼────────────────────────
SFX        │ MP3, 128kbps  │ Incidental         │ Minimal, if any.
```

### 7.3 Preloading

```
Strategy: preload ALL images on init, show loading state

- 12 webp images ≈ 2-5MB
- Dot bar = random access = can't predict next scene
- Promise.all on Image objects → populate cache Map
- Howler preloads audio on construction
- Block on images only, audio can stream
```

---

## 8. Responsive

```
CONCERN        │ APPROACH
───────────────┼──────────────────────────────────────────────
Aspect ratio   │ 16:9 locked. Canvas letterboxed with black.
Canvas sizing  │ ResizeObserver on container. Recalculate
               │ canvas width/height. Handle devicePixelRatio.
               │ Redraw current image on resize.
Text scaling   │ clamp() font sizes on DOM overlay
Mobile layout  │ Same layout. Text adjusts. Dots shrink.
Min width      │ 320px functional
```

---

## 9. Deployment

### 9.1 Build
Vite → dist/. Static assets only.

### 9.2 Container

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

### 9.3 CI/CD

```yaml
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: |
          gcloud builds submit --tag gcr.io/$PROJECT_ID/carbon-trace
          gcloud run deploy carbon-trace \
            --image gcr.io/$PROJECT_ID/carbon-trace \
            --region us-east1 \
            --platform managed \
            --allow-unauthenticated
```

---

## 10. Performance Budget

```
METRIC              │ TARGET
────────────────────┼────────────────────────────────────
First paint         │ <2s (loading state immediately)
Interactive         │ <10s (all images loaded, title shown)
Total asset size    │ <35MB
Canvas render       │ 60fps during effects (rAF loop)
Transition time     │ ~1.2-1.8s per scene change
```

---

## 11. Accessibility

```
REQUIREMENT        │ IMPLEMENTATION
───────────────────┼──────────────────────────────────────────────
Screen reader      │ Canvas: aria-hidden="true".
                   │ DOM: aria-live="polite" narration region.
───────────────────┼──────────────────────────────────────────────
Keyboard           │ Arrow ←/→ navigate. Space/Enter advance.
                   │ Tab to replay/mute. Focus outlines.
───────────────────┼──────────────────────────────────────────────
Reduced motion     │ prefers-reduced-motion: ghost-drift → simple
                   │ fade or static. Canvas effects → minimal/none.
                   │ Transitions → instant or simple fade.
───────────────────┼──────────────────────────────────────────────
Captions           │ Narration text always in DOM (animated +
                   │ stable hidden layer). Not dependent on audio.
───────────────────┼──────────────────────────────────────────────
Contrast           │ Narration panel meets WCAG AA
───────────────────┼──────────────────────────────────────────────
Scene 6            │ Silence + minimal text preserved.
───────────────────┼──────────────────────────────────────────────
Sensory framing    │ Alt modes preserve story beats at different
                   │ intensity. Not "less" — different.
```

---

## 12. Trade-offs

```
DECISION                        │ REJECTED              │ WHY THIS
────────────────────────────────┼───────────────────────┼──────────────────────
Canvas 2D over DOM+CSS         │ DOM + CSS filters     │ Need pixel access for
                                │                       │ effects now and runtime
                                │                       │ trace rendering in v2.
                                │                       │ Switching renderers
                                │                       │ mid-project is worse
                                │                       │ than starting right.
────────────────────────────────┼───────────────────────┼──────────────────────
Canvas 2D over WebGL           │ GPU shader pipeline   │ Overkill for 2D.
────────────────────────────────┼───────────────────────┼──────────────────────
DOM overlay for text/UI        │ Canvas text drawing   │ Canvas text invisible
                                │                       │ to screen readers.
                                │                       │ DOM gives a11y + GSAP.
────────────────────────────────┼───────────────────────┼──────────────────────
Flat modules over class         │ Engine hierarchy      │ 12 frames. One
hierarchy                       │                       │ orchestrator + functions.
────────────────────────────────┼───────────────────────┼──────────────────────
navigate(from, to) over        │ Separate next/prev/   │ Dot bar = random access.
separate nav functions          │ jump functions        │ One function, five callers.
────────────────────────────────┼───────────────────────┼──────────────────────
Baked traces + canvas shimmer   │ Runtime procedural    │ Baked looks better.
(v1)                            │                       │ Same renderer for v2.
────────────────────────────────┼───────────────────────┼──────────────────────
Ghost-drift over typewriter     │ Character-by-char     │ Atmospheric, not
                                │                       │ mechanical.
────────────────────────────────┼───────────────────────┼──────────────────────
Cloud Run + nginx              │ GH Pages, Vercel      │ Existing domain on GCS.
                                │                       │ Already known infra.
────────────────────────────────┼───────────────────────┼──────────────────────
Vanilla JS over React           │ Component model       │ ~20 DOM elements.
                                │                       │ No reuse. No benefit.
────────────────────────────────┼───────────────────────┼──────────────────────
Vite                            │ No build tool         │ Tree-shaking. HMR.
                                │                       │ Already known.
────────────────────────────────┼───────────────────────┼──────────────────────
Preload all over lazy           │ Per-scene lazy        │ Random access. 3s once
                                │                       │ > 0.5s per jump.
────────────────────────────────┼───────────────────────┼──────────────────────
Per-scene authored effects       │ Generic effect system │ Effects serve story.
                                │                       │ Specifics TBD after
                                │                       │ images finalized.
```

---

## 13. v1 vs v2 Boundary

### v1 (ships by April 5)

- All 12 frames with Canvas 2D transitions
- Ghost-drift text (DOM overlay + GSAP)
- Narration audio + replay
- End song on credits via ambient slot
- Dot bar random-access + forward/back + keyboard
- Scene 6 stillness (text present, no audio, no effects)
- Accessibility: aria-live, reduced-motion, keyboard
- Cloud Run deploy with CI/CD
- Blog post submitted
- Ambient audio deferred (null slots, architecture ready)

### v2 (post-competition)

- Circuit traces baked in images + canvas shimmer
- Per-scene canvas effects
- Zoom transitions
- Runtime procedural trace rendering via Canvas pixel ops
- Per-scene ambient audio loops
- Hover-responsive parallax
- Effect polish
- Extended credits animation

---

## 14. Open Items

- [x] Write narration fragments per scene
- [x] Record voiceover
- [ ] Define ghost-text drift timing rules
- [ ] Finalize scene art (Leonardo AI, parallel with code)
- [ ] Finalize device/signal machine design language
- [ ] RAI statement + credits content
- [x] Source/create end song
- [ ] Write Frontend Art submission post
- [x] Domain mapping: Cloud Run → subdomain

---

## 15. Build Order

**Phase 1 — Skeleton (Days 1-3)**
1. Scaffold Vite project, scenes.json with all 12 frames
2. canvas.js: image drawing, cover-fit, resize, image cache
3. navigator.js: navigate(from, to), transition lock, dot bar routing
4. DOM overlay: dot bar, forward/back, keyboard input

**Phase 2 — Core Experience (Days 4-8)**
5. Ghost-drift text (text.js): GSAP timelines, overlap, cleanup
6. Audio (audio.js): Howler init, narration playback + replay, mute
7. Canvas crossfade: rAF dissolve between images
8. Scene 6: null config, text present, silence

**Phase 3 — Polish (Days 9-14)**
9. End song on credits
10. Accessibility: aria-live, prefers-reduced-motion, keyboard
11. Control bar design + styling
12. Mobile testing

**Phase 4 — Assets & Deploy (Days 15-20)**
14. Finalize images (parallel from Day 1)
15. Record/finalize narration
16. Dockerfile + nginx + CI/CD
17. Domain mapping

**Phase 5 — Submission (Days 21-25)**
18. Frontend Art submission post
19. Echoes of Experience blog post
20. Final device testing
21. Submit

**Hard rule:** Assets parallel with code from Day 1.

---

## 16. Global Rules — The Constitution

```
ARCHITECTURE:
  ✓ each module does ONE thing
  ✓ navigator is the ONLY module that knows frame ordering
  ✓ all other modules receive config objects, not frame indices
  ✓ no module imports from navigator (one-direction dependency)
  ✓ scenes.json is single source of truth
  ✓ scene differences = config data, not if-blocks

RENDERING:
  ✓ canvas = visual plane (images, traces in v2)
  ✓ DOM overlay = semantic plane (text, buttons, a11y)
  ✓ canvas is aria-hidden="true"
  ✓ GSAP animates DOM elements
  ✓ requestAnimationFrame animates canvas

STATE:
  ✓ two variables: currentFrame (int), transitioning (bool)
  ✓ lock released ONLY in GSAP onComplete

DATA FLOW (v1):
  user event
    → main.js handler
      → navigate(from, to)
        → kill active text timeline + hard-reset elements
        → GSAP orchestration timeline:
          → canvas.crossfade(fromImg, toImg)
          → audio.crossfadeAudio(fromConfig, toConfig)
          → text.animateEnter(toConfig)
        → onComplete: commit state, update dots, release lock

DATA FLOW (v2 adds):
  → effects.cleanup(fromConfig) before crossfade
  → effects.start(toConfig, ctx) after crossfade

NEVER:
  ✗ hardcoded frame indices in if/else
  ✗ multiple functions for the same navigation action
  ✗ audio for intermediate frames on multi-frame jump
  ✗ text drawn on canvas
  ✗ cross-imports between leaf modules
  ✗ global GSAP timelines
  ✗ releasing locks before async completes
  ✗ constructing Howl instances on the fly
  ✗ framework for 20 DOM elements
```
