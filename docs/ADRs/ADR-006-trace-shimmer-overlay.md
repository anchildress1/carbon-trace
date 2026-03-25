# carbon-trace — ADR-06: Trace Shimmer Overlay System

**Supersedes:** §4.5 (Circuit Trace Overlay Progression), §13 v2 bullet "Circuit traces baked in images + canvas shimmer" of `carbon-trace-system-design-v3-final.md`, v5 §5.4 line 594 (`<div id="trace-overlay">`), v5 §4.1 line 239 (opacity-only traceOverlay schema)
**Date:** March 19, 2026
**Author:** Ashley Childress (@anchildress1)
**Status:** Deferred — architecture and engine spec are normative but implementation is deferred post-v1. Runtime code was removed from the codebase; this ADR preserves the design for future implementation.
**Decision:** Promote canvas shimmer overlay from v2 to v1; define shimmer engine architecture

---

## 06.1 Decision Record

### Problem

The v3 design deferred all canvas shimmer work to v2 (§13), placing it after competition deadline. The circuit trace motif is the visual spine of the entire narrative — coal to diamond to circuit to light. Without shimmer, the traces exist only as static paint in the Leonardo AI images. They're beautiful, but they're dead. The progression from "you probably don't even see it" on the title screen to "full sparkle" on scene 11 is the visual embodiment of the diamond's awakening. Shipping without it leaves the central metaphor inert.

The shimmer must:

1. Run on all 12 frames (00–11), including the black title screen
2. Scale in intensity from near-invisible to full presence across the experience
3. Shimmer constantly — ambient, like breath, not triggered by events
4. Not interfere with image crossfades, ghost-drift text, audio, or navigation
5. Not fight the painterly texture of the images
6. Embody "less is more" — warmth, not spectacle

### Options Evaluated

```
OPTION                              │ VERDICT   │ REASON
────────────────────────────────────┼───────────┼──────────────────────────────────
1. Separate shimmer canvas layer    │ ACCEPTED  │ Isolated rendering context.
   with traced-path shimmer engine  │           │ Does not touch image pixels,
   + per-scene authored geometry    │           │ DOM overlay, or GSAP. Authored
                                    │           │ polyline paths with layered
                                    │           │ glow strokes + traveling
                                    │           │ highlights. Additive blend
                                    │           │ adds light without muddying
                                    │           │ paint texture.
────────────────────────────────────┼───────────┼──────────────────────────────────
2. Shimmer on same canvas as        │ REJECTED  │ Couples shimmer to image
   images via pixel compositing     │           │ crossfade pipeline. Every
                                    │           │ crossfade must save/restore
                                    │           │ shimmer state. effects.js
                                    │           │ pixel manipulation (v2) would
                                    │           │ collide. Violates "each module
                                    │           │ does one thing."
────────────────────────────────────┼───────────┼──────────────────────────────────
3. CSS/DOM shimmer with             │ REJECTED  │ DOM shimmer means screen readers
   animated elements                │           │ see decorative noise. CSS
                                    │           │ animations can't do per-path
                                    │           │ phase-offset oscillation without
                                    │           │ dozens of elements. GSAP is for
                                    │           │ text — adding shimmer elements
                                    │           │ to DOM overlay muddies the
                                    │           │ semantic/visual separation.
────────────────────────────────────┼───────────┼──────────────────────────────────
4. WebGL shader shimmer             │ REJECTED  │ GPU shader pipeline for soft
                                    │           │ glowing dots is a cannon for a
                                    │           │ sparrow. Adds a rendering
                                    │           │ context type. Overkill.
```

### Decision

**Option 1 — Separate shimmer canvas with traced-path engine.** A dedicated `<canvas>` element layered between the image canvas and DOM overlay. New `shimmer.js` module with a standalone `requestAnimationFrame` loop. Per-scene polyline trace paths authored by Ashley, stored inline in `scenes.json`. Static glow rendered to offscreen canvas; traveling highlights animated per frame. Global intensity curve from 0 → 1 across scenes 00 → 11. Additive compositing via `globalCompositeOperation: "lighter"` inside canvas + CSS `mix-blend-mode: screen` on the element. No coupling to crossfade, text, audio, or effects pipelines.

---

## 06.2 Architecture Changes

### 06.2.1 Layer Stack — Current vs. Changed

Two HTML changes to `#trace-overlay`: (1) convert `<div>` to `<canvas>`, (2) move above `#effects-canvas` in DOM order so shimmer renders on top of pixel effects (ADR-007 swapped the z-order).

```html
<!-- BEFORE (current index.html) -->
<canvas id="scene-canvas" aria-hidden="true"></canvas>
<div class="trace-overlay" id="trace-overlay"></div>
<canvas id="effects-canvas" aria-hidden="true"></canvas>

<!-- AFTER (ADR-006 + ADR-007) -->
<canvas id="scene-canvas" aria-hidden="true"></canvas>
<canvas id="effects-canvas" aria-hidden="true"></canvas>
<canvas class="trace-overlay" id="trace-overlay" aria-hidden="true"></canvas>
```

Full layer stack inside `#scene-stage`:

```
┌──────────────────────────────────────────────────┐
│  #scene-stage (GSAP fades this entire container) │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  #caption-layer  (DOM)                   │    │
│  │  #narration-layer (DOM)                  │ ◄── text, captions, a11y
│  │  GSAP animates text here                 │    │
│  ├──────────────────────────────────────────┤    │
│  │  #trace-overlay   (Canvas 2D) ← CHANGED │ ◄── glowing trace paths
│  │  aria-hidden="true"                      │    independent rAF loop
│  │  mix-blend-mode: screen                  │    │
│  ├──────────────────────────────────────────┤    │
│  │  #effects-canvas  (PixiJS/WebGL)         │ ◄── pixel effects (ADR-007)
│  │  aria-hidden="true"                      │    │
│  ├──────────────────────────────────────────┤    │
│  │  #scene-canvas    (Canvas 2D)            │ ◄── images, cover-fit
│  │  aria-hidden="true"                      │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  GSAP fades #scene-stage opacity 0→1 during      │
│  transitions. ALL children fade together.        │
│  Shimmer does NOT need its own fade logic.       │
└──────────────────────────────────────────────────┘
```

Because GSAP fades the parent container during scene transitions, the shimmer canvas fades in/out automatically with everything else. No separate shimmer fade-out/fade-in is needed.

### 06.2.2 Dependency Graph (supersedes §5.2)

```
                     main.js
                       │
                       │ imports + wires event listeners
                       │
               ┌───────┴───────┐
               │               │
             app.js        loader.js
               │
     ┌─────────┼──────────┬──────────┐
     │         │          │          │
  canvas.js  audio.js   text.js  shimmer.js
     │         │          │          │
  effects.js   │       overlay.js    │
               │                     │
          no cross-imports           │
          between leaf modules ──────┘

app.js → shimmer (one call site: shimmer.loadScene() inside showFrame())
shimmer → nothing (receives config, draws to its own canvas)
```

shimmer.js is a leaf module. It does not import from app, canvas, audio, text, effects, or overlay. It receives a config object and draws to its own canvas. Period.

### 06.2.3 Integration with app.js

Shimmer integrates at one call site: `showFrame()`.

**Current code (app.js line 337):**
```js
app.els.traceOverlay.style.opacity = frame.traceOverlay?.opacity ?? 0;
```

**Replaced with:**
```js
shimmer.loadScene(frame.traceOverlay);
```

`shimmer.loadScene()` sets the path geometry and intensity for the new scene. The shimmer rAF loop picks up the new data on its next frame. No other app.js changes needed for normal transitions because:

1. GSAP fades `#scene-stage` to opacity 0
2. `showFrame()` runs (calls `shimmer.loadScene()` with new config)
3. GSAP fades `#scene-stage` back to opacity 1

The shimmer rAF loop runs continuously but must pause with the app.

**Hard cut (paused navigation):**

Hard cut already calls `showFrame()` directly (app.js line 472). `shimmer.loadScene()` inside `showFrame()` handles the instant swap. No additional hard cut logic needed.

**Pause/resume:**

Shimmer MUST pause. `doPause()` and `doResume()` call `shimmer.pause()` and `shimmer.resume()` respectively. WCAG 2.2.2 (Pause, Stop, Hide) requires that auto-updating content lasting longer than 5 seconds must have a pause mechanism. When the user pauses the experience, all visual storytelling — including ambient shimmer — freezes.

---

## 06.3 Schema Changes

### 06.3.1 scenes.json — extending traceOverlay

The `traceOverlay` key already exists on every frame with an `opacity` field. This ADR extends it with a required `paths` array. All path data is inline in scenes.json — no external JSON files, no fetching. The key is NOT renamed — `traceOverlay` is already used in scenes.json and app.js.

**Current schema:**
```jsonc
"traceOverlay": { "opacity": 0.05 }
```

**Extended schema:**
```jsonc
"traceOverlay": {
  "opacity": 0.05,
  "paths": [
    { "points": [[0.1, 0.3], [0.2, 0.35], [0.4, 0.32]], "width": 2 }
  ]
}
```

`opacity` retains its existing meaning (scene intensity 0–1). `paths` defines the circuit trace lines.

### 06.3.2 Path schema

Each path is a polyline (array of [x, y] normalized coordinate pairs) with a stroke width.

```
FIELD  │ TYPE              │ DESCRIPTION
───────┼───────────────────┼─────────────────────────────────────
points │ [[x,y], ...]      │ Ordered vertices, normalized 0–1
width  │ float (1–6)       │ Core stroke width in CSS px (before DPR)
phase  │ float (0–2π)      │ Optional. Offsets shimmer timing per path.
       │                   │ Default 0. Spread across paths to desync.
```

All coordinates normalized (0–1). No absolute pixel values.

### 06.3.3 Config rules (extends §4.3)

```
DO:
  ✓ traceOverlay: null = no shimmer on this frame (consistent with all other optional keys)
  ✓ when present, traceOverlay must have both opacity AND paths
  ✓ paths is always an array (empty [] for scenes not yet authored)
  ✓ opacity is a float 0.0 – 1.0
  ✓ all coordinates normalized 0.0 – 1.0

DON'T:
  ✗ pixel-based coordinates
  ✗ external JSON files (CSP is connect-src 'none'; all data inline)
  ✗ opacity-only frames without paths key (no backward compat per AGENTS.md)
  ✗ opacity values outside 0.0 – 1.0
```

**No backward compatibility.** Per AGENTS.md: "Do not maintain backwards compatibility in this codebase for any reason." When traceOverlay is present (not null), it must have the full schema. Existing scenes.json frames will be updated when this ADR is implemented.

---

## 06.4 Shimmer Engine (shimmer.js)

### 06.4.1 Responsibilities

```
shimmer.js DOES:
  • create and manage the shimmer <canvas> element
  • run a standalone rAF loop (independent of canvas.js rAF)
  • render glowing circuit-trace paths with layered strokes
  • animate traveling specular highlights along each path
  • pulse ambient brightness per path using sin(time + phase)
  • scale all drawing by scene opacity
  • pause/resume rAF loop (WCAG 2.2.2 compliance)
  • handle resize (re-derive pixel positions from normalized coords)

shimmer.js DOES NOT:
  • know what frame number is showing
  • touch the image canvas
  • import from app, canvas, audio, text, effects, or overlay
  • modify the DOM overlay
  • fetch anything (all data received inline via loadScene)
```

### 06.4.2 State

```js
let canvas, ctx;           // #trace-overlay canvas + context
let offscreen, offCtx;     // offscreen canvas for cached static glow
let observer = null;        // ResizeObserver
let paths = [];             // current scene's path array
let opacity = 0;            // current scene's intensity (0–1)
let rafId = null;           // for cancelAnimationFrame on destroy
let paused = false;         // true when app is paused (WCAG 2.2.2)
let glowDirty = true;      // true → rebuild offscreen glow cache
```

### 06.4.3 Public API

```
shimmer.init(canvasEl)    — acquire context, start rAF, setup ResizeObserver
shimmer.loadScene(config) — swap paths + intensity synchronously
shimmer.pause()           — stop rAF loop (called by doPause)
shimmer.resume()          — restart rAF loop (called by doResume)
shimmer.destroy()         — cancelAnimationFrame, disconnect observer
```

No `fadeOut()` or `fadeIn()` exports. GSAP container fade handles transitions. ResizeObserver triggers internal redraw.

### 06.4.4 Rendering — Three Layers

The shimmer effect is built from three visual layers composited each frame:

**Layer 1 — Static glow (cached to offscreen canvas on scene load)**

Each path is stroked 3 times at decreasing widths with `globalCompositeOperation: "lighter"` and `shadowBlur`. This creates a warm core with soft halo — like hot metal. Drawn once on `loadScene()` and on resize. Composited via `drawImage()` each frame.

**Layer 2 — Traveling shimmer highlight**

A bright point moves along each path at a slow constant speed. Position is computed by walking the polyline segments parametrically (t from 0→1, wraps). Each path gets 1–2 highlights at different phase offsets. The highlight is a small radial gradient drawn at the sampled point — bright core, fast falloff.

**Layer 3 — Ambient pulse**

Slow `sin(time * FREQ + path.phase)` modulates `globalAlpha` on the entire composited result. ~4s period. Breathing, not blinking.

### 06.4.5 Render Loop

```
EACH rAF FRAME:
  1. Clear canvas
  2. If opacity ≤ 0 or paths.length === 0 → return early
  3. If glowDirty → rebuild offscreen glow cache (layer 1)
  4. Set globalAlpha = opacity * pulse(time)
  5. drawImage(offscreen) → composites cached glow
  6. For each path:
     a. Walk polyline to find highlight position at t(time, path.phase)
     b. Draw small bright radial gradient at that point
  7. Reset globalAlpha
```

The key optimization: step 5 is one `drawImage()` call per frame regardless of path count. Only the traveling highlights (step 6) require per-path work each frame, and each is a single gradient fill.

### 06.4.6 Constants

```
CONSTANT        │ VALUE     │ WHY
────────────────┼───────────┼──────────────────────────────────
FREQ            │ 0.0015    │ ~4.2s full pulse cycle. Warmth, not flicker.
HIGHLIGHT_SPEED │ 0.00008   │ Highlight traverses full path in ~12s.
BASE_ALPHA      │ 0.6       │ Peak opacity at intensity=1.0. Never fully opaque.
GLOW_COLOR      │ #D4A853   │ Warm amber sampled from Leonardo AI traces.
HIGHLIGHT_COLOR │ #F0D890   │ Slightly brighter/warmer for specular pop.
SHADOW_BLUR     │ 12        │ Glow spread in px. Tunable per feel.
STROKE_WIDTHS   │ [6, 3, 1] │ Outer → inner glow layers. Halo, body, core.
STROKE_ALPHAS   │ [.15,.3,.8]│ Outer dim, inner bright. Natural falloff.
```

Colors are starting points — sample directly from scene images during dev.

### 06.4.7 Why layered strokes + "lighter" composite

`shadowBlur` alone looks soft but flat. Adding `globalCompositeOperation: "lighter"` (additive blending) where strokes overlap creates authentic glow — brighter at intersections, natural falloff at edges. This is the standard Canvas 2D technique for neon/hot-metal effects. Combined with the offscreen cache, it costs one `drawImage()` per frame instead of re-stroking every path.

The traveling highlight adds life without the cost of animating the glow itself. The glow is static warmth; the highlight is the shimmer.

---

## 06.5 Intensity Curve

Ashley authors exact intensity values per scene. The following is a reference curve — actual values will be tuned during authoring.

```
SCENE  │ ID              │ INTENSITY │ SHIMMER NOTES
───────┼─────────────────┼───────────┼──────────────────────────────────
00     │ title           │ 0.02–0.05 │ Dark field. Almost subliminal.
       │                 │           │ One or two faint traces.
───────┼─────────────────┼───────────┼──────────────────────────────────
01     │ seam            │ 0.05–0.08 │ Coal seam wall, diamond barely
       │                 │           │ visible. Faintest warmth in rock.
02     │ travel          │ 0.06–0.10 │ Mine tunnel, coal car. Traces
       │                 │           │ catch lamplight on edges.
03     │ reach           │ 0.08–0.12 │ Coke oven mouth, hand reaching in.
       │                 │           │ Heat makes traces visible.
───────┼─────────────────┼───────────┼──────────────────────────────────
04     │ pocket          │ 0.05–0.08 │ Diamond in coal grit with denim.
       │                 │           │ Regression, not progression.
───────┼─────────────────┼───────────┼──────────────────────────────────
05     │ rinse           │ 0.12–0.18 │ Hands under water, circuitry on
       │                 │           │ diamond. First true seeing.
06     │ storage         │ 0.18–0.25 │ Tin open, diamond among coins.
       │                 │           │ Glowing from within.
───────┼─────────────────┼───────────┼──────────────────────────────────
07     │ empty           │ 0.30–0.40 │ Daughter at mother's painting,
       │                 │           │ golden traces on wall.
08     │ stillness       │ 0.40–0.55 │ Tin on shelf, PCB traces
       │                 │           │ radiating across wall.
───────┼─────────────────┼───────────┼──────────────────────────────────
09     │ return          │ 0.55–0.70 │ Daughter walking with tin,
       │                 │           │ traces on walls and floor.
10     │ building        │ 0.70–0.85 │ Woman on floor with tools, diamond
       │                 │           │ glowing. Traces on walls.
───────┼─────────────────┼───────────┼──────────────────────────────────
11     │ music           │ 0.85–1.0  │ Record player, diamond blazing,
       │                 │           │ circuitry everywhere. Full sparkle.
```

Note: intensity at scene 04 intentionally dips below scene 03. The diamond is wrapped in a miner's coat, hidden. The shimmer recedes. This is not a monotonic ramp — it follows the narrative.

---

## 06.6 Transition Behavior

All transition behavior is inherited from the existing `showFrame()` + GSAP container fade architecture. Shimmer has no transition-specific code.

### Scene-to-scene (normal navigation)

```
1. GSAP fades #scene-stage to opacity 0    ← shimmer invisible (parent hidden)
2. showFrame() runs:
   - canvas draws new image
   - shimmer.loadScene(traceOverlayConfig)  ← swap paths + intensity
   - effects restart
   - text rebuilds
3. GSAP fades #scene-stage to opacity 1    ← shimmer visible with new config
```

The shimmer rAF loop runs through all of this. It renders the new paths immediately on loadScene(). The parent container's opacity hides the swap — the user sees a clean fade.

### Hard cut (paused navigation)

Hard cut calls `showFrame()` directly (no GSAP fade). `shimmer.loadScene()` inside `showFrame()` performs an instant swap. No additional logic needed.

### Multi-frame jump (dot bar skip)

Same as normal scene-to-scene. Only the destination frame matters.

---

## 06.7 Reduced Motion

When `prefers-reduced-motion: reduce` is active:

1. Traveling highlights stop — no moving specular points
2. Ambient pulse stops — glow renders at static brightness (0.5)
3. Intensity curve still applies — static glowing traces at scene-appropriate brightness
4. The visual effect becomes: warm trace lines that exist but don't shimmer

Satisfies the spirit (warmth, presence, progression) without motion.

---

## 06.8 Performance

```
CONCERN             │ MITIGATION
────────────────────┼─────────────────────────────────────────────
rAF cost per frame  │ One drawImage() for cached glow + N small
                    │ radial gradients for highlights (N = path
                    │ count, ≤ ~50 on scene 11). No re-stroking
                    │ paths each frame. Budget: < 1ms per frame.
────────────────────┼─────────────────────────────────────────────
Glow cache rebuild  │ Happens on loadScene() and resize only —
                    │ NOT every frame. Multi-pass stroke with
                    │ shadowBlur on offscreen canvas. ~5–15ms
                    │ one-time cost, hidden behind GSAP fade.
────────────────────┼─────────────────────────────────────────────
Multiple render loops│ scene-canvas has no rAF (static drawImage).
                    │ effects-canvas has PixiJS ticker (active — ADR-007).
                    │ Shimmer rAF runs continuously but is light.
                    │ FAIL gate: if combined p95 frame time > 16.6ms
                    │ on baseline hardware, consolidate per ADR-007
                    │ profiling method (move shimmer into PixiJS
                    │ ticker or reduce to 30fps frame-skip).
────────────────────┼─────────────────────────────────────────────
Canvas memory       │ Two canvases: visible + offscreen glow cache.
                    │ At 1920×1080 × 4 bytes = ~16MB total.
────────────────────┼─────────────────────────────────────────────
Early exit          │ If opacity === 0 or paths.length === 0,
                    │ rAF clears and returns. ~0.1ms.
```

---

## 06.9 v1 / v2 Boundary Update

### Supersedes §13 of v3-final

**Moved from v2 to v1:**

- Canvas shimmer overlay (this ADR)
- Per-scene authored trace path geometry
- Layered glow + traveling shimmer highlights
- Global intensity curve
- shimmer.js module

**Remains v2 (UPDATED by ADR-007 — effects.js promoted to v1 via PixiJS):**

- ~~Runtime procedural effects via Canvas pixel ops (effects.js)~~ → Superseded by ADR-007: effects.js is now a PixiJS factory registry, active in v1
- ~~Per-scene canvas pixel effects (ripple, dust, bloom)~~ → Superseded by ADR-007: water, heat, dust-glow effects via PixiJS DisplacementFilter in v1
- Hover-responsive parallax
- Extended credits animation
- Per-scene ambient audio loops

### Why this is safe for v1 deadline

shimmer.js is a leaf module with zero coupling to existing code. It adds one canvas element, one rAF loop, and one call site in `showFrame()` (`shimmer.loadScene()`). The path geometry is authored data, not generated — no algorithm to debug. The render loop is ~60 lines of canvas stroke/gradient drawing. Implementation estimate: 1 day code, 1–2 days tuning path placement.

---

## 06.10 What This Does NOT Change

```
UNCHANGED:
  ✓ canvas.js — untouched
  ✓ effects.js — untouched by ADR-006 (superseded by ADR-007: now PixiJS factory registry)
  ✓ effects-canvas.js — untouched by ADR-006 (superseded by ADR-007: now PixiJS/WebGL lifecycle)
  ✓ text.js — untouched
  ✓ audio.js — untouched
  ✓ overlay.js — untouched
  ✓ captions.js — untouched
  ✓ pausable-timer.js — untouched
  ✓ GSAP transition logic in app.js — untouched
  ✓ app.js state machine — untouched (no new states)
  ✓ Keyboard/accessibility — shimmer is decorative, aria-hidden
  ✓ Deployment — no new dependencies

CHANGED (not yet applied to code — implementation pending path authoring):
  ✓ index.html — #trace-overlay: <div> → <canvas>, move above #effects-canvas (ADR-007 z-swap)
  ✓ app.js showFrame() — one line: style.opacity → shimmer.loadScene()
  ✓ app.js createApp() — add shimmer.init(app.els.traceOverlay) call
  ✓ app.js doPause()/doResume() — add shimmer.pause() and shimmer.resume()
  ✓ app.js imports — add shimmer.js import
  ✓ scenes.json — update all traceOverlay objects to full schema with paths
  ✓ styles.css — replace .trace-overlay rules (see §06.10.1 below)
  ✓ docs/accessibility.md — update trace overlay reduced-motion description
```

### 06.10.1 styles.css delta

`.trace-overlay` currently has `opacity: 0` and `transition: opacity 0.6s ease`. These existed because app.js was driving CSS opacity per scene. With shimmer.js owning intensity via canvas alpha, those lines are dead weight.

Set `opacity: 1`. An empty canvas with no drawn pixels is already invisible — there is no FOUC risk. `#scene-stage` starts `hidden` and only shows after `initApp()`, so nothing renders before shimmer is initialized. Remove both `transition` rules (main + reduced-motion). Add `mix-blend-mode: screen`.

---

## 06.11 Authoring Workflow

Ashley authors trace paths per scene:

1. Open scene image at full size
2. Trace circuit lines as a series of [x, y] points along the path (normalized 0–1)
3. Assign width (thinner = subtler, thicker = more presence)
4. Assign phase offset (spread across paths to desynchronize highlights)
5. Add to scenes.json (all paths inline, no external files)
6. View in browser, tune opacity and path positions live

A dev overlay (keyboard shortcut toggle) showing paths as visible colored strokes with vertex handles would speed this up. Optional for v1 but strongly recommended.

---

## 06.12 Constitution Addendum

Extends §16 of v3-final:

```
RENDERING (updated):
  ✓ image canvas = visual plane (static scene images, cover-fit)
  ✓ trace-overlay canvas = additive light plane (glowing trace paths + shimmer)
  ✓ DOM overlay = semantic plane (text, buttons, a11y)
  ✓ all three layers are independent rendering contexts
  ✓ trace-overlay canvas is aria-hidden="true"
  ✓ shimmer uses requestAnimationFrame (consistent with canvas rendering rules)
  ✓ globalCompositeOperation: "lighter" for additive glow inside canvas
  ✓ mix-blend-mode: screen on trace-overlay element — additive over image

SHIMMER:
  ✓ shimmer is ambient but respects WCAG 2.2.2 pause state
  ✓ shimmer intensity follows narrative, not a linear ramp
  ✓ trace paths are authored data, not procedural
  ✓ static glow cached to offscreen canvas, only highlights animate per frame
  ✓ shimmer.js is a leaf module with no cross-imports
  ✓ shimmer transitions ride the parent container GSAP fade — no shimmer-specific transition code

NEVER (shimmer-specific — does not constrain effects-canvas / ADR-007):
  ✗ particles on the shimmer canvas (dots that spawn, move, or die)
  ✗ CSS glow filters (box-shadow, filter: blur — fights paint texture)
  ✗ white shimmer (always warm amber)
  ✗ shimmer that responds to mouse/touch (v2 parallax territory)
  ✗ shimmer coupled to audio events
  ✗ shimmer drawn on the image canvas
  ✗ re-stroking all paths every frame (use offscreen cache)
```

---

## 06.13 Test Matrix

Per AGENTS.md: "Every new module or utility must ship with positive, negative, and edge-case tests."

```
CATEGORY          │ CASES
──────────────────┼────────────────────────────────────────────
init/destroy      │ acquires context, starts rAF, cleanup cancels rAF
loadScene         │ valid config, null config, empty paths [], mid-frame swap
pause/resume      │ rAF stops on pause, resumes on resume, no drift
reduced motion    │ static glow at 0.5, no highlights, no pulse
resize            │ offscreen cache rebuilds, positions re-derive
malformed data    │ missing points, NaN coords, negative width
opacity boundary  │ opacity 0 → early exit, opacity 1 → full draw
```
