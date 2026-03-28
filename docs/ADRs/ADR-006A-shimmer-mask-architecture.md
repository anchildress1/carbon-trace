# carbon-trace — ADR-06A: Trace Shimmer — Mask-Based Architecture (Addendum)

**Supersedes:** ADR-006 §06.3 (Schema), §06.4.2 (State), §06.4.3 (Public API), §06.4.4 (Rendering), §06.4.5 (Render Loop), §06.4.6 (Constants), §06.4.7 (Layered Strokes Rationale), §06.11 (Authoring Workflow), §06.12 (Constitution — partial)
**Date:** March 28, 2026
**Author:** Ashley Childress (@anchildress1)
**Status:** Active — documents the implemented shimmer engine
**Amends:** ADR-006 (Trace Shimmer Overlay System)

---

## 06A.1 Decision Record

### Problem

ADR-006 specified a polyline-based shimmer engine: hand-authored [x, y] vertex arrays in scenes.json, layered glow strokes via `globalCompositeOperation: "lighter"` + `shadowBlur`, traveling parametric highlights along polylines. The implementation proved wrong in practice. Authoring polyline vertices by hand is tedious and error-prone — coordinates don't correspond to visible features in the scene images. The rendering model (multi-pass stroked polylines cached to an offscreen canvas) is overengineered for the visual effect needed.

A mask-based approach emerged: Ashley authors circuit trace PNGs in an image editor (painting directly over the scene image), shimmer.js pixel-reads the mask at runtime to derive walkable regions, and autonomous dots navigate the mask using pixel-level pathfinding. This is faster to author, visually superior, and mechanically simpler.

### Decision

**Replace the polyline engine with a mask-based pixel-walking engine.** Circuit geometry is defined by PNG mask images (dark traces on light/transparent background), not coordinate arrays. The shimmer effect is produced by: (1) drawing the mask as a color-tinted trace image, and (2) spawning dots that walk the mask's walkable pixels using 8-compass direction pathfinding. The rest of ADR-006 (layer stack, module isolation, transition behavior, GSAP integration, reduced motion spirit, performance architecture) remains normative.

---

## 06A.2 What ADR-006 Sections This Supersedes

```
SECTION           │ STATUS       │ REASON
──────────────────┼──────────────┼─────────────────────────────────────────
§06.2.1 Layer     │ UNCHANGED    │ Separate canvas layer, z-order correct
§06.2.2 Deps      │ UNCHANGED    │ shimmer.js remains a leaf module
§06.2.3 Integrate │ UNCHANGED    │ One call site in showFrame(), pause/resume
§06.3 Schema      │ SUPERSEDED   │ Mask reference replaces paths array
§06.4.1 Respon.   │ AMENDED      │ Spirit unchanged, details differ
§06.4.2 State     │ SUPERSEDED   │ Entirely different internal state
§06.4.3 API       │ SUPERSEDED   │ loadScene is now async
§06.4.4 Rendering │ SUPERSEDED   │ Mask + pixel-walking dots, not layered strokes
§06.4.5 Loop      │ SUPERSEDED   │ drawImage(trace) + stepDot(), not parametric walks
§06.4.6 Constants │ SUPERSEDED   │ Different constant set
§06.4.7 Rationale │ SUPERSEDED   │ Layered strokes + lighter composite not used
§06.5 Intensity   │ UNCHANGED    │ Values need tuning, concept holds
§06.6 Transitions │ UNCHANGED    │ GSAP container fade still handles it
§06.7 Reduced mot.│ AMENDED      │ Spirit correct: static traces, frozen dots at 0.6α
§06.8 Performance │ AMENDED      │ Same architecture (cached static + cheap per-frame)
§06.9 v1/v2       │ UNCHANGED    │
§06.10 Unchanged  │ UNCHANGED    │ mix-blend-mode: screen still applies
§06.11 Authoring  │ SUPERSEDED   │ PNG masks in image editor, not vertex arrays
§06.12 Constitut. │ AMENDED      │ Two NEVER rules violated by design (see §06A.9)
§06.13 Test matrix│ AMENDED      │ Categories hold, cases need new API
```

---

## 06A.3 Schema Changes (supersedes §06.3)

### 06A.3.1 scenes.json — traceOverlay

The `traceOverlay` key references a mask image instead of containing inline path geometry. All coordinate authoring is eliminated.

**ADR-006 schema (superseded):**
```jsonc
"traceOverlay": {
  "opacity": 0.05,
  "paths": [
    { "points": [[0.1, 0.3], [0.2, 0.35]], "width": 2 }
  ]
}
```

**Implemented schema:**
```jsonc
"traceOverlay": {
  "opacity": 0.05,
  "mask": "assets/masks/mask-01-seam-circuit.png",
  "color": [180, 155, 100],
  "dotCount": 15
}
```

| Field      | Type         | Required | Default           | Description                                      |
|------------|--------------|----------|-------------------|--------------------------------------------------|
| `opacity`  | float 0–1    | yes      | —                 | Scene intensity (scales trace image and dot alpha)|
| `mask`     | string       | yes      | —                 | Relative URL to mask PNG in `assets/masks/`       |
| `color`    | `[r, g, b]`  | no       | `[232, 200, 120]` | Per-scene glow color (trace tint + dot fill)      |
| `dotCount` | integer      | no       | `DOT_COUNT` (15)  | Number of walking dots for this scene             |

`paths` is removed entirely. `mask` references a dark-on-light PNG where dark pixels (luminance < 128) define circuit trace geometry. `color` enables per-scene warm palette variation — most scenes use amber, but scene 03 (reach/coke oven) uses red-orange `[220, 110, 50]`.

### 06A.3.2 Mask image specification

```
FIELD        │ DESCRIPTION
─────────────┼──────────────────────────────────────────────────────
Format       │ PNG, dark-on-light (dark = trace, light/transparent = empty)
Threshold    │ Luminance < 128 AND alpha > 128 → walkable pixel
Dimensions   │ Match scene image dimensions or scale proportionally
Authoring    │ Painted in image editor over scene image reference
Runtime use  │ Pixel-read to build walkability map + color-tinted for static trace
```

### 06A.3.3 Config rules (supersedes §06.3.3)

```
DO:
  ✓ traceOverlay: null = no shimmer on this frame
  ✓ when present, traceOverlay must have both opacity AND mask
  ✓ opacity is a float 0.0 – 1.0
  ✓ mask is a relative URL to a PNG in assets/masks/
  ✓ color is optional [r, g, b] — warm palette only (amber through red-orange)
  ✓ dotCount is optional integer override for per-scene dot density

DON'T:
  ✗ inline path coordinates (use mask images)
  ✗ external JSON geometry files
  ✗ opacity-only frames without mask key
  ✗ opacity values outside 0.0 – 1.0
  ✗ JPEG or lossy formats for masks (binary precision matters for walk map)
  ✗ white or cool-toned color values (warm palette constraint)
```

---

## 06A.4 Shimmer Engine (supersedes §06.4.2–06.4.7)

### 06A.4.1 Responsibilities (amends §06.4.1)

```
shimmer.js DOES:
  • create and manage the shimmer <canvas> element
  • run a standalone rAF loop (independent of canvas.js / effects-canvas.js)
  • load mask PNG asynchronously, pixel-read it into a walkability map
  • render color-tinted mask pixels as the static trace image (cached)
  • apply per-scene color from config (defaults to warm amber)
  • spawn and step autonomous dots that walk the mask via 8-compass pathfinding
  • pulse dot brightness individually via sin()
  • scale all drawing by scene opacity
  • pause/resume rAF loop (WCAG 2.2.2 compliance)
  • handle resize (update canvas dimensions; walk map and trace image are
    at mask resolution and scale via drawImage — no rebuild needed)

shimmer.js DOES NOT:
  • know what frame number is showing
  • touch the image canvas or effects canvas
  • import from app, canvas, audio, text, effects, or overlay
  • modify the DOM overlay
  • author or store coordinate geometry
```

### 06A.4.2 State (supersedes §06.4.2)

```js
let canvas, ctx;           // #trace-overlay canvas + context
let observer;              // ResizeObserver — triggers handleResize on canvas resize
let walkMap;               // Uint8Array — binary walkability (1 = dark pixel)
let mapW, mapH;            // walk map dimensions
let dots = [];             // array of dot state objects (see shape below)
let traceImage;            // offscreen canvas — color-tinted mask cached on load
let opacity = 0;           // current scene's intensity (0–1)
let activeColor;           // [r, g, b] — current scene's glow color
let rafId = null;          // for cancelAnimationFrame on destroy
let paused = false;        // true when app is paused
let motionQuery;           // MediaQueryList for prefers-reduced-motion
let reducedMotion = false; // true when reduced motion is active
let loadGeneration = 0;    // monotonic counter — guards against stale async loads
```

**Dot state shape:**

```js
{
  x, y,           // current position in mask-space pixels
  dx, dy,         // normalized direction vector (from DIRS_NORM)
  speed,          // DOT_SPEED × random(0.5–1.5) — per-dot speed variation
  phase,          // random 0–2π — desynchronizes sin() pulse per dot
  life,           // frames since spawn (incremented by stepDot)
  maxLife,        // 800–2000 frames — dot respawns when life ≥ maxLife
  stuckCount,     // unused legacy field (stuck dots respawn immediately)
}
```

Key differences from ADR-006: no `paths[]`, no `glowDirty` flag, no `offscreen`/`offCtx` glow cache. The walk map replaces polyline geometry. The trace image replaces the multi-pass stroke cache. Dots replace parametric highlight walkers.

### 06A.4.3 Public API (supersedes §06.4.3)

```
shimmer.init(canvasEl)          — acquire context, setup ResizeObserver
shimmer.loadScene(config)       — ASYNC: load mask PNG, build walk map,
                                  create trace image, spawn dots, start rAF
shimmer.pause()                 — stop rAF loop
shimmer.resume()                — restart rAF loop
shimmer.destroy()               — cancelAnimationFrame, disconnect observer
```

**Breaking change from ADR-006:** `loadScene()` is now **async** because it loads an external PNG image. ADR-006 specified synchronous `loadScene()` because all data was inline JSON. The call site in `showFrame()` stores the returned promise (`app.shimmerReady`) and the transition gates on it (alongside `app.effectsReady`) before fading in. A monotonic generation counter inside `loadScene()` guards against stale async completions — if a newer `loadScene()` is called while an older mask is still loading, the older load's post-await work is silently discarded.

**Config validation:** When config is non-null, `loadScene()` validates per §06A.3.3: `opacity` is required (float 0–1), `mask` is required (string), `color` must be warm-toned (R dominant, B < 0.65 × R), `dotCount` must be a positive integer. Invalid config throws — no silent degradation.

### 06A.4.4 Rendering — Two Layers (supersedes §06.4.4)

ADR-006 described three layers (static glow cache, traveling parametric highlights, ambient global pulse). The implementation uses two:

**Layer 1 — Static trace image (cached on scene load)**

The mask PNG is loaded, then each dark pixel (walkable) is redrawn with the scene's `activeColor` (default `[232, 200, 120]`) at `TRACE_ALPHA` opacity onto a cached offscreen canvas. This is drawn to the visible canvas via `drawImage()` each frame. Equivalent in purpose to ADR-006's offscreen glow cache, but produced by pixel-tinting a mask rather than multi-pass path stroking.

**Layer 2 — Pixel-walking dots**

Autonomous dots spawn at random walkable positions on the mask and navigate using 8-compass direction pixel lookups against the binary walk map. Each dot:

- Moves at `DOT_SPEED` pixels per frame
- Uses `LOOKAHEAD` pixels of forward scanning to pick valid directions
- Chooses from the 8 cardinal + diagonal compass directions
- Checks `WALK_RADIUS` pixels around its position for walkability
- Has individual phase-offset pulsing via `sin(time + dot.phase)`
- Has a finite lifespan (`maxLife` = 800–2000 frames); respawns at a new random walkable position on expiry
- Respawns immediately when stuck (no direction has 4+ pixels of runway)
- Uses grid-distributed spawning (`spawnDistributed`) to ensure even coverage across the mask

This is fundamentally different from ADR-006's parametric polyline walking. Dots are particles — they spawn, move, make local navigation decisions, and die/respawn. They don't follow authored geometry parametrically; they explore the mask stochastically.

**No Layer 3 — No global ambient pulse**

ADR-006's Layer 3 (global `sin(time)` modulating `globalAlpha` on the entire result) is replaced by per-dot pulsing. Individual dots pulse via `sin()`, but there is no whole-canvas alpha modulation.

### 06A.4.5 Render Loop (supersedes §06.4.5)

```
EACH rAF FRAME:
  1. Clear canvas
  2. If opacity ≤ 0 or no walk map → return early
  3. Set globalAlpha = opacity
  4. drawImage(traceImage) → composites cached color-tinted trace
  5. Reset globalAlpha to 1
  6. For each dot:
     a. If not reducedMotion: stepDot() — 8-compass pixel-walk pathfinding
     b. Calculate pulse alpha: reducedMotion ? 0.6 : 0.1 + 0.9 × sin(time + phase)
     c. Scale alpha by scene opacity
     d. Draw glow halo: radial gradient (DOT_RADIUS × 7 × scale) — activeColor fading to transparent
     e. Draw bright core: radial gradient (DOT_RADIUS × 2 × scale) — white center fading through activeColor
```

Each dot is rendered as two overlapping radial gradients: a large soft glow halo and a smaller bright core. This produces the characteristic orb-with-halo look. The key optimization carries over from ADR-006's spirit: step 4 is one `drawImage()` call per frame regardless of mask complexity. Dot rendering (step 6) requires two `createRadialGradient` + `fillRect` calls per dot.

### 06A.4.6 Constants (supersedes §06.4.6)

```
CONSTANT       │ VALUE            │ WHY
───────────────┼──────────────────┼──────────────────────────────────
DOT_COUNT      │ 15               │ Default simultaneous walking dots
DOT_RADIUS     │ 4                │ Base radius for glow halo (×7) and core (×2)
DOT_SPEED      │ 0.8              │ Base pixels per frame (×random 0.5–1.5 per dot)
DEFAULT_COLOR  │ [232, 200, 120]  │ Fallback amber tint when scene has no color
TRACE_ALPHA    │ 0.12             │ Alpha for static trace image pixels
PULSE_FREQ     │ 0.0015           │ sin() frequency for dot brightness (~4.2s cycle)
WALK_RADIUS    │ 3                │ Pixel tolerance for staying on thin 1-2px lines
LOOKAHEAD      │ 25               │ Forward scan distance for direction picking
SPAWN_ATTEMPTS │ 500              │ Max random tries to find a walkable spawn position
```

**Removed from ADR-006:** `HIGHLIGHT_SPEED`, `SHADOW_BLUR`, `STROKE_WIDTHS`, `STROKE_ALPHAS`, `HIGHLIGHT_COLOR`, `HIGHLIGHT_RADIUS`, `FREQ`. These belonged to the polyline + layered-stroke model.

### 06A.4.7 Why mask-based pixel-walking (supersedes §06.4.7)

ADR-006's rationale ("layered strokes + lighter composite") described a specific Canvas 2D technique for neon/hot-metal glow via `shadowBlur` and additive blending inside the canvas context. The implementation does not use any of this.

Instead: `mix-blend-mode: screen` is set on the `<canvas>` CSS (not inside the canvas context). This achieves additive blending at the element level — light adds to the scene image underneath without muddying paint texture. No `globalCompositeOperation: "lighter"`, no `shadowBlur`, no multi-pass strokes.

The pixel-walking approach emerged from the authoring model. Once geometry is defined by a mask image rather than polylines, parametric walking (interpolate t along a polyline) becomes impossible — there are no polylines. Pixel-level pathfinding is the natural traversal method for a bitmap mask. The dots' stochastic navigation produces organic, alive movement that feels more like "circuitry thinking" than a highlight marching along a rail.

---

## 06A.5 Authoring Workflow (supersedes §06.11)

**ADR-006 workflow (superseded):**
> Ashley hand-authors polyline vertex arrays: open scene image, trace [x, y] points, assign width and phase, add to scenes.json.

**Implemented workflow:**

1. Open scene image in image editor (Photoshop, Procreate, etc.)
2. Create new layer over the scene image
3. Paint circuit trace lines in dark strokes on light/transparent background
4. Export as PNG mask (e.g., `mask-09-return-circuit.png`)
5. Place in `public/assets/masks/`
6. Reference in scenes.json: `"mask": "assets/masks/mask-09-return-circuit.png"`
7. Tune `opacity` and optional `color` / `dotCount` values in browser

No coordinate authoring. No vertex arrays. No phase offsets. The image editor IS the authoring tool — Ashley paints directly where she sees traces in the scene. shimmer.js pixel-reads the result at runtime.

This is categorically faster and more intuitive than the ADR-006 workflow. It also produces higher-fidelity geometry — brush strokes in an image editor follow the visual contours of the scene far more naturally than manually plotted normalized coordinates.

---

## 06A.6 Compositing Model (clarifies §06.10.1)

ADR-006 described two compositing layers:

1. `globalCompositeOperation: "lighter"` — additive blending **inside** the canvas context for stroke overlap glow
2. `mix-blend-mode: screen` — additive blending of the canvas **element** over the scene image

The implementation uses only #2. There is no `globalCompositeOperation: "lighter"` inside the canvas. The `mix-blend-mode: screen` CSS property on the `<canvas>` element handles all additive blending. Amber trace pixels and dot fills are drawn with normal compositing inside the canvas; the screen blend mode composites the whole canvas additively over the scene image below.

---

## 06A.7 Reduced Motion (amends §06.7)

Spirit is unchanged from ADR-006. Implementation details differ:

When `prefers-reduced-motion: reduce` is active:

1. **Dots render but freeze** — `stepDot()` is skipped, so dots remain at their initial spawn positions. They are still drawn (glow halo + core) but do not move. (ADR-006: "traveling highlights stop")
2. **Per-dot pulse stops** — instead of `sin()` brightness modulation, all dots render at a static alpha of `0.6 × opacity`. (ADR-006: "ambient pulse stops")
3. **Static trace image renders** at scene-appropriate opacity (ADR-006: "static glow at half brightness")
4. **Intensity curve still applies** — warm trace lines and stationary dot glows visible, proportional to scene

The visual result: warm trace lines with soft stationary glows that exist but don't shimmer or move.

---

## 06A.8 Performance (amends §06.8)

```
CONCERN             │ MITIGATION
────────────────────┼──────────────────────────────────────────────
rAF cost per frame  │ One drawImage() for cached trace image +
                    │ 2N radial gradient fills for dots (N = DOT_COUNT).
                    │ No path re-stroking, no shadowBlur. Budget: < 1ms.
────────────────────┼──────────────────────────────────────────────
Walk map build      │ Happens on loadScene() only. Pixel-read mask
                    │ image into Uint8Array. One-time cost hidden
                    │ behind GSAP fade.
────────────────────┼──────────────────────────────────────────────
Dot pathfinding     │ 8-direction pixel lookup per dot per frame.
                    │ O(DOT_COUNT × 8) array reads — trivial.
────────────────────┼──────────────────────────────────────────────
Mask image loading  │ Async image load on scene transition. Cached
                    │ after first load. Network cost: one PNG per
                    │ scene (same as existing effect masks).
────────────────────┼──────────────────────────────────────────────
Canvas memory       │ One visible canvas + trace image cache.
                    │ Walk map is Uint8Array (mapW × mapH bytes).
                    │ Lighter than ADR-006's two full canvases.
────────────────────┼──────────────────────────────────────────────
Early exit          │ If opacity === 0 or no walk map → clear and
                    │ return. ~0.1ms.
```

---

## 06A.9 Constitution Amendments (amends §06.12)

Two rules from ADR-006's NEVER list are violated by the implemented design. These violations are intentional and load-bearing.

### Violation 1: "✗ particles on the shimmer canvas (dots that spawn, move, or die)"

**The code does exactly this.** Dots are particles. They spawn at random walkable positions, move via pixel-pathfinding, and respawn when stuck. This IS the shimmer effect — the organic, stochastic dot movement is what makes the traces feel alive.

**Amendment:** Remove this NEVER rule. Replace with:

```
✓ pixel-walking dots on the shimmer canvas — bounded by DOT_COUNT,
  movement constrained to walkable mask pixels, individually pulsed
```

### Violation 2: "✗ re-stroking all paths every frame (use offscreen cache)"

**Partially applicable.** The trace image IS cached — `drawImage(traceImage)` is one call per frame, consistent with the rule's intent. But dots are drawn fresh each frame (small circle fills, not path strokes). The framing of this rule assumed polyline strokes; dots are a different rendering primitive.

**Amendment:** Rewrite as:

```
✓ static trace layer cached (drawImage per frame, not re-rendered)
✗ re-rendering the full trace/mask tint every frame (use cached trace image)
```

### Updated Constitution — SHIMMER section

```
SHIMMER:
  ✓ shimmer is ambient but respects WCAG 2.2.2 pause state
  ✓ shimmer intensity follows narrative, not a linear ramp
  ✓ trace geometry is authored PNG masks, not procedural or coordinate-based
  ✓ static trace image cached on scene load, composited via drawImage per frame
  ✓ pixel-walking dots navigate binary walk map derived from mask
  ✓ shimmer.js is a leaf module with no cross-imports
  ✓ shimmer transitions ride the parent container GSAP fade
  ✓ mix-blend-mode: screen on the element (CSS, not inside canvas context)

NEVER (shimmer-specific):
  ✗ CSS glow filters (box-shadow, filter: blur — fights paint texture)
  ✗ white or cool-toned shimmer (warm palette only — amber through red-orange)
  ✗ shimmer that responds to mouse/touch (v2 parallax territory)
  ✗ shimmer coupled to audio events
  ✗ shimmer drawn on the image canvas
  ✗ re-rendering the full trace tint every frame (use cached trace image)
  ✗ globalCompositeOperation: "lighter" inside canvas (use CSS mix-blend-mode)
  ✗ polyline vertex arrays or inline coordinate geometry in scenes.json
```

---

## 06A.10 Test Matrix (amends §06.13)

Categories from ADR-006 hold. Cases updated for new API:

```
CATEGORY          │ CASES
──────────────────┼────────────────────────────────────────────
init/destroy      │ acquires context, starts rAF, cleanup cancels rAF,
                  │ disposes walk map and trace image
loadScene         │ valid config with mask, null config, missing mask URL,
                  │ mid-frame swap (generation counter discards stale load),
                  │ async cancellation on rapid navigation, validation rejects
                  │ missing opacity / out-of-range opacity / cool-toned color /
                  │ non-integer dotCount
pause/resume      │ rAF stops on pause, resumes on resume, dots freeze
                  │ in place (no position drift on resume)
reduced motion    │ static trace image at scene opacity, dots frozen at 0.6α
resize            │ canvas dimensions update; rendering scales via drawImage
                  │ (walk map and trace image stay at mask resolution)
dots              │ spawn at walkable positions, respect WALK_RADIUS,
                  │ respawn when stuck, DOT_COUNT honored, individual
                  │ pulse phase offsets produce desynchronized breathing
walk map          │ binary threshold correct, non-walkable pixels rejected,
                  │ 8-compass directions resolve correctly at edges
opacity boundary  │ opacity 0 → early exit (no drawImage, no dots),
                  │ opacity 1 → full draw
malformed masks   │ zero-dimension image, all-black mask (no walkable
                  │ pixels → no dots, trace image empty), all-white mask
```

---

## 06A.11 What Remains Unchanged from ADR-006

For clarity, these sections of ADR-006 remain normative and are NOT amended by this addendum:

- **§06.2.1** Layer stack and z-order (shimmer canvas between effects and DOM)
- **§06.2.2** Dependency graph (shimmer.js is a leaf module, no cross-imports)
- **§06.2.3** Integration with app.js (one call site in `showFrame()`, pause/resume)
- **§06.5** Intensity curve concept (scene 04 dip, narrative-following values)
- **§06.6** Transition behavior (GSAP container fade handles all transitions)
- **§06.9** v1/v2 boundary update
- **§06.10** What this does not change (canvas.js, effects.js, etc. untouched)
- **§06.10.1** `mix-blend-mode: screen` on the element (confirmed in CSS)
