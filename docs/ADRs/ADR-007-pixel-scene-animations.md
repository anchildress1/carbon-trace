# ADR-007: Pixel-Level Scene Animations

**Status:** Accepted
**Date:** March 21, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Coexists with:** ADR-006 (trace shimmer overlay — separate system, separate canvas)
**Supersedes:** ADR-006 §06.9 (v1/v2 boundary — effects.js no longer deferred to v2), ADR-006 §06.10 (effects.js listed as "untouched"), v5 §5.4 layer stack order (effects-canvas and trace-overlay swap)
**Affects:** v5 §17 Rules (getImageData restriction), effects.js (no longer no-op), effects-canvas.js (context changes from Canvas 2D to WebGL via PixiJS)

## Context

Every scene image is a static painting. The narrative tells a story of transformation — coal, heat, water, light — but the images don't breathe. ADR-006 adds glowing trace lines, but that's additive light on top of the image. It doesn't make the image itself move.

The goal: make the painted world feel alive. Water that clearly flows. Heat that visibly rises above the furnace. Dust that drifts gently around the diamond. Not overlays pulsing brightness. Not CSS filters. Actual pixel-level animation where the image content appears to move within specific regions.

### Why this needs an ADR

1. v5 Rules say `NEVER getImageData() in a render loop for compositing`. A Canvas 2D approach to pixel displacement would require reading image data per frame, violating this rule. The adopted PixiJS approach avoids this entirely — displacement happens on the GPU — but the technology choice needed an ADR to document why the rule is preserved (not amended) and how WebGL is scoped.
2. effects.js is currently a no-op skeleton. This ADR defines what it becomes.
3. Mask images are a new asset type with CSP and preloading implications.

### What this is NOT

- Not ADR-006. Shimmer is additive light on a separate canvas. This is pixel manipulation on the effects canvas.
- Not CSS overlays, filters, or blend-mode tricks.

### ADR-001 WebGL Revisit

ADR-001 rejected WebGL because "GPU shader pipeline is overkill for 2D image rendering." That was correct for static scene images. Pixel-level animation effects have different requirements — real-time displacement maps, per-pixel masking, and sub-4ms frame budgets. Canvas 2D Perlin displacement was prototyped and failed: too slow at full resolution, heat-shimmer appearance instead of convincing flow, no GPU acceleration.

**PixiJS** is adopted as the effects renderer. It uses WebGL internally but abstracts it as a library call — no manual shader compilation, no scene graphs, no 3D. ADR-001's rejection of raw WebGL still holds. PixiJS is scoped exclusively to the effects canvas; the scene canvas remains Canvas 2D.

---

## Decision

**Mask-based GPU-accelerated effects via PixiJS on the effects canvas.**

Each scene declares one or more effect regions. Each region is defined by a grayscale mask image (white = animate, black = don't) and an effect type (water, heat, dust, or any future type). PixiJS renders the scene image as a sprite, applies displacement maps (scrolling noise textures) masked to the defined regions, and composites the result to the effects canvas at 60fps with GPU acceleration.

**Rendering library:** PixiJS v8 (MIT license, ~150KB gzipped). Bundled via Vite — no CDN in production. CSP is `connect-src 'none'` (ADR-006 §06.3.3); external scripts would violate `script-src`. POC may use CDN for rapid iteration.

---

## How It Works

### Per-frame render (effects-canvas.js + PixiJS)

```
ON SCENE LOAD:
  1. Create PixiJS Application on the effects canvas (or reuse existing)
  2. Load scene image via new Image() → Texture.from() → Sprite
  3. For each effect region:
     a. Load mask image via new Image() → Texture.from() → Sprite (masking)
     b. Load pre-authored displacement noise texture via new Image() → Texture.from()
     c. Create a DisplacementFilter with the noise sprite
     d. Apply mask to constrain effect to region
     e. Add filter to the scene sprite's filter chain

EACH rAF FRAME (managed by PixiJS ticker):
  1. For each active displacement sprite:
     a. Scroll its position based on effect type (direction, speed)
     b. Adjust scale for intensity
  2. PixiJS renders all filters in a single GPU draw call
  3. Effects canvas composites over scene canvas via CSS stacking
```

**Key:** No getImageData at all. PixiJS handles all pixel work on the GPU via displacement maps. Textures are loaded via `new Image()` + `Texture.from()` (not `Assets.load()`) to preserve `connect-src 'none'` CSP. If WebGL is unavailable, effects degrade to static — no Canvas 2D fallback is attempted.

**PixiJS init timing:** `effectsCanvas.init()` is called during `showFrame()` on first use (lazy), aligned to image display. The PixiJS Application is created once and reused across scenes. `loadScene()` swaps sprites/filters per scene; `init()` is not called again. If `frame.effects` is null, `init()` is skipped — no WebGL context created until a scene actually needs effects.

**Error boundary:** `init()` is wrapped in try/catch. If PixiJS Application creation throws (broken driver, blocked WebGL, context creation failure), set `webglAvailable = false`. All subsequent `loadScene()` AND `clearAll()` calls become no-ops — both check `webglAvailable` before touching PixiJS. App continues without effects — scene images display normally. No crash, no retry. app.js does not check this flag; it calls loadScene/clearAll unconditionally and effects-canvas.js handles the guard internally.

**WebGL context loss:** Listen for `webglcontextlost` on `#effects-canvas`. On context loss: call `clearAll()`, set `needsReinit = true`. On next `loadScene()`, re-create the PixiJS Application before loading the scene. If re-init also fails, fall back to `webglAvailable = false` (permanent static). Mobile Safari evicts WebGL contexts under memory pressure — this path must work.

**Context loss error boundary:** `clearAll()` wraps ALL `.destroy()` calls in try/catch. A lost WebGL context can cause PixiJS destroy methods to throw — without the guard, this creates a crash loop instead of graceful degradation. The catch block logs a warning and continues cleanup.

**Null effects:** When `effects` is null or `regions` is empty, app.js calls `clearAll()` instead of `loadScene()`. This destroys any sprites, filters, and textures from the previous scene, leaving the effects canvas transparent (WebGL clear color is transparent black). `loadScene()` is never called with null — the null check lives in app.js (see app.js snippet above).

### Effect types

**water** — Flow displacement (PixiJS DisplacementFilter)
- Noise displacement sprite scrolls continuously in configured flow direction
- PixiJS DisplacementFilter samples source pixels at offset positions each frame — GPU-native
- Mask sprite constrains the displacement to the water region only
- Result: the painted water appears to flow. Direction and speed are visually obvious.
- Parameters: `direction` (degrees), `speed`, `intensity` (displacement magnitude), `scale` (noise frequency)

**heat** — Rising distortion (PixiJS DisplacementFilter)
- Same DisplacementFilter, direction locked upward, larger noise scale (wide wobble)
- Lower intensity than water — subtle shimmer, not a river
- Mask fades at edges via grayscale gradient in the mask image
- Parameters: `speed`, `intensity`, `scale`

**dust** — Gentle drift displacement (PixiJS DisplacementFilter)
- Same DisplacementFilter as water/heat, with multi-directional slow drift
- Very low intensity — subtle movement suggesting floating particles without actual particle sprites
- Mask constrains displacement to the dust region (e.g., around a diamond, in a shaft of light)
- No particle emitter dependency — displacement effect types (water, heat, dust, shockwave) use DisplacementFilter exclusively
- Parameters: `speed`, `intensity`, `scale`

**fog** — Atmospheric haze (PixiJS BlurFilter)
- Soft static blur with gentle pulse for subtle atmospheric drift
- Normal blend mode (not additive) — dims rather than brightens
- No displacement sprite needed (`needsNoise: false`)
- Parameters: `strength`, `quality`, `pulseSpeed`, `pulseRange`

**glow** — Soft bloom (PixiJS BlurFilter)
- Animated blur with additive blend mode — adds warm light to masked region
- Pulses blur strength for organic breathing effect
- No displacement sprite needed (`needsNoise: false`)
- Parameters: `strength`, `quality`, `pulseSpeed`, `pulseRange`

**shockwave** — Radial displacement burst (PixiJS DisplacementFilter)
- Noise sprite scales outward rapidly from center, displacement fades as it expands
- Cycles between burst phase and rest phase for repeating pulse
- Parameters: `speed`, `intensity`, `restScale`, `burstScale`, `cyclePause`

**Future effects** — PixiJS supports:
- Custom GLSL fragment shaders (caustics, refraction, chromatic aberration)
- ColorMatrixFilter (tint shifts, desaturation)
- Any combination of the above, masked to arbitrary regions
- New effects are added by registering a filter factory function — no architecture changes needed

### Audio-Reactive Modulation

Any effect region can optionally react to audio in real time by adding an `audioReactive` key. This modulates an existing effect parameter based on frequency data from the Web Audio API. No new filters, no new render passes — just parameter changes on existing GPU work.

**How it works:**
```
1. audio.js exposes getAnalyserNode() — lazy-creates a Web Audio AnalyserNode
   connected to Howler's master gain node. One shared analyser for the app.
2. app.js wires the bridge: effectsCanvas.setAnalyser(audio.getAnalyserNode())
   Called once when a scene with audioReactive regions loads.
3. effects-canvas.js ticker reads getByteFrequencyData() each frame (~0.1ms).
   For each region with audioReactive config:
     a. Extract the target frequency band (bass/mid/high) from the FFT array
     b. Normalize to 0–1
     c. Smooth via exponential moving average (smoothing factor)
     d. Lerp the target parameter between range[0] and range[1]
```

**Schema:**
```jsonc
{
  "type": "glow",
  "mask": "assets/masks/11-diamond.png",
  "strength": 4,
  "quality": 4,
  "pulseSpeed": 0,
  "pulseRange": [4, 4],
  "audioReactive": {
    "band": "bass",
    "target": "strength",
    "range": [2, 12],
    "smoothing": 0.8
  }
}
```

**`audioReactive` fields:**
```
FIELD     │ TYPE          │ DESCRIPTION
──────────┼───────────────┼────────────────────────────────────────────
band      │ string        │ "bass" (20-250Hz), "mid" (250-2000Hz), "high" (2000-16000Hz)
target    │ string        │ Effect parameter to modulate (e.g. "strength", "intensity", "speed")
range     │ [min, max]    │ Output range for the modulated parameter
smoothing │ float 0–1     │ Exponential moving average factor. 0 = instant (jittery),
          │               │ 0.8 = smooth (recommended), 0.95 = very slow response.
```

**Frequency band mapping (FFT bin indices for 2048-sample AnalyserNode at 44100Hz):**
```
bass:  bins 1–12   (~20–250 Hz)  — kick drums, bass lines, low rumble
mid:   bins 12–93  (~250–2000 Hz) — vocals, instruments, body
high:  bins 93–744 (~2000–16000 Hz) — cymbals, sibilance, air
```
Each band is the average of its bin range, normalized to 0–1.

**Module changes:**

audio.js — one new export:
```
getAnalyserNode()  — lazy-create AnalyserNode on Howler's AudioContext,
                     connect to masterGain. Returns AnalyserNode.
                     Subsequent calls return the same instance.
                     fftSize: 2048, smoothingTimeConstant: 0.8
```

effects-canvas.js — one new method:
```
setAnalyser(analyserNode)  — store reference. Ticker reads frequency data
                             each frame if analyser is set and regions have
                             audioReactive config. Cleared on clearAll().
```

app.js — wiring in showFrame():
```js
if (frame.effects?.regions?.some(r => r.audioReactive)) {
  effectsCanvas.setAnalyser(audio.getAnalyserNode());
}
```

**No cross-imports between leaf modules.** audio.js doesn't know about effects. effects-canvas.js doesn't know about Howler. app.js bridges them.

**Performance:** `getByteFrequencyData()` copies FFT data into a pre-allocated Uint8Array — ~0.1ms. Band averaging is a few additions. Parameter lerp is one multiply. Total audio-reactive overhead per frame: < 0.2ms. Well within the <2ms budget.

**Reduced motion:** `audioReactive` is ignored. The base parameter value is used (e.g., `strength: 4` without modulation). The effect is present but static.

**Pause:** When paused, the ticker is stopped, so no frequency reads happen. On resume, the smoothing catches up naturally — no jump.

**No audio playing:** If `getByteFrequencyData()` returns all zeros (silence, audio not started, muted), the modulated value stays at `range[0]`. The effect is visible at minimum intensity, not invisible.

**Multiple audioReactive regions:** Each reads from the same shared AnalyserNode and FFT data array. One `getByteFrequencyData()` call per frame, not per region.

### Schema

```jsonc
"effects": {
  "regions": [
    {
      "type": "water",
      "mask": "assets/masks/05-rinse-water.png",
      "direction": 180,
      "speed": 0.6,
      "intensity": 8,
      "scale": 0.02
    }
  ]
}
```

Replaces the current `effects: { idle: "dust-drift", entry: "fade-in" }` structure. The named-effect registry pattern in effects.js is replaced by typed regions with inline parameters.

`effects: null` = no effects for this frame. `effects: { "regions": [] }` = equivalent (explicit empty). Both are valid. Convention matches all other optional keys in scenes.json (`narration: null`, `audioCues: null`, `traceOverlay: null`).

### Mask images

- Format: grayscale PNG, same aspect ratio as scene images (16:9)
- Resolution: can be lower than scene images (e.g., 768×432) — scaled up on load. Soft edges are fine and desirable.
- White = full effect. Black = no effect. Gray = partial (used for edge falloff and dust density).
- Stored in `public/assets/masks/`
- **Loaded via `new Image()` + `Texture.from()` inside `loadScene()`** — not preloaded ahead of time. Masks are small (~330KB each) and load behind the GSAP fade during transitions. No changes to loader.js. If profiling shows transition jank from mask loading, promote to browser cache warming in loader.js. **CSP note:** `new Image()` falls under `img-src 'self'`, preserving `connect-src 'none'`. `Assets.load()` is NOT used because some PixiJS code paths use `fetch()` internally, which is blocked by `connect-src 'none'`.

### CSP impact

Mask PNGs are local assets served from same origin. `img-src 'self'` already covers them.

**Decision (adversarial review, March 21 2026):** PixiJS `Assets.load()` is NOT used for texture loading. Some PixiJS code paths use `fetch()` internally, which would be blocked by `connect-src 'none'`. Instead, all textures (scene images, masks, noise) are loaded via `new Image()` + `Texture.from()`, which falls under `img-src 'self'`. This preserves the strict `connect-src 'none'` CSP without amendment. `Assets` is not imported from PixiJS.

---

## Architecture

### Module changes

**effects.js** — no longer a no-op. Becomes the effect factory registry:
```
registerEffect(type, factoryFn)  — register a named effect type
createEffect(type, app, params)  — create PixiJS filter for this type
```

Built-in registrations: `water`, `heat`, `dust`, `fog`, `glow`, `shockwave`. Displacement types return a DisplacementFilter; blur types (fog, glow) return a BlurFilter.

**effects-canvas.js** — gains PixiJS lifecycle:
```
init(canvasEl)                         — create PixiJS Application on the canvas
loadScene(effectsConfig, sceneImageUrl) — load scene sprite, create filters per region
clearAll()                             — destroy sprites/filters/textures via .destroy(true)
                                         (frees GPU backing store — prevents memory leak
                                         across 12 scene transitions). Ticker stays running
                                         (no-op frames, ~0ms). Ticker is only stopped by pause().
pause() / resume()                     — stop/start PixiJS ticker (WCAG 2.2.2)
```

**New dependencies:**
- `pixi.js` v8 — added to package.json (pinned to exact minor version), bundled by Vite (no CDN). ~150KB gzipped. Tree-shake via `import { Application, Sprite, DisplacementFilter, BlurFilter, Texture } from 'pixi.js'`. Also imports `pixi.js/unsafe-eval` for CSP-safe shader compilation.
- No particle emitter package needed — all three effect types use DisplacementFilter exclusively.

**app.js** — showFrame() call site:
```js
// OLD
if (effectExists(frame.effects?.idle)) runEffect(frame.effects.idle, ...);

// NEW
if (frame.effects?.regions?.length) {
  effectsCanvas.loadScene(frame.effects, frame.image);
} else {
  effectsCanvas.clearAll();
}
```

**Null filtering lives in app.js.** `loadScene()` is only called when there are actual regions to render. When `effects` is null or regions is empty, `clearAll()` destroys any leftover content from the previous scene. `loadScene()` also calls `clearAll()` internally as its first step, so the clear is not duplicated when transitioning between two effects-bearing scenes.

`sceneImageUrl` is the canonical second argument — loaded via `new Image()` + `Texture.from()` to create a GPU texture. Do not pass a Canvas 2D element reference.

Pause/resume already wired. No new state variables.

### Layer stack (CHANGED from v5 §5.4 — effects-canvas and trace-overlay swap)

```
caption-layer    (DOM)
narration-layer  (DOM)
trace-overlay    (Canvas 2D)    ← ADR-006 shimmer renders here (mix-blend-mode: screen)
effects-canvas   (PixiJS/WebGL) ← pixel effects render here
scene-canvas     (Canvas 2D)    ← static image
```

**v5 had effects-canvas above trace-overlay.** That was fine when effects-canvas was a no-op. Now that effects-canvas renders opaque displaced pixels in masked regions, it would bury shimmer traces underneath. Swapping the order puts shimmer on top — its `mix-blend-mode: screen` adds glowing traces over both the static scene AND the animated water/heat below. Shimmer is the visual spine of the narrative (ADR-006 §06.1); it must be visible everywhere.

**HTML change:**
```html
<!-- BEFORE (v5 §5.4) -->
<canvas id="scene-canvas" aria-hidden="true"></canvas>
<canvas id="trace-overlay" aria-hidden="true"></canvas>
<canvas id="effects-canvas" aria-hidden="true"></canvas>

<!-- AFTER -->
<canvas id="scene-canvas" aria-hidden="true"></canvas>
<canvas id="effects-canvas" aria-hidden="true"></canvas>
<canvas id="trace-overlay" aria-hidden="true"></canvas>
```

### Context change: effects-canvas is now WebGL

The `#effects-canvas` element previously used `getContext('2d')` via effects-canvas.js. A canvas element can only have ONE rendering context. PixiJS requires `getContext('webgl2')` (or `getContext('webgl')` fallback). The old Canvas 2D calls (`clearRect`, etc.) are replaced by PixiJS API calls. effects-canvas.js no longer calls `getContext('2d')` — PixiJS owns the context entirely.

### Interaction with ADR-006 shimmer

Shimmer and effects are separate systems on separate canvases with separate rendering contexts (Canvas 2D vs WebGL). Shimmer sits above effects in z-order so traces are always visible. Both pause/resume with the app. Both respect reduced motion.

**Constraint: one WebGL context max.** `#effects-canvas` is the only WebGL context in the application. `#trace-overlay` MUST remain Canvas 2D. `#scene-canvas` MUST remain Canvas 2D. Multiple WebGL contexts cause GPU resource contention on low-end devices. If shimmer is ever migrated to PixiJS, it must share the effects-canvas PixiJS Application, not create a second one.

---

## v5 Rule Clarification

```
PRESERVED (no exception granted):
  ✗ NEVER getImageData() in a render loop for compositing
    PixiJS handles displacement on the GPU — getImageData is not used or needed.

ADDED:
  ✓ Effects canvas uses PixiJS (WebGL) instead of Canvas 2D — scoped exception to ADR-001
  ✓ Fallback: if WebGL unavailable, effects degrade to static (no Canvas 2D fallback attempted)
```

---

## Reduced Motion

When `prefers-reduced-motion: reduce` is active:
- Water: static (no displacement)
- Heat: static (no displacement)
- Dust: static (no displacement)
- Fog: static (no blur pulse)
- Glow: static (no bloom pulse)
- Shockwave: static (no burst cycle)

All displacement stops. The masked regions display the static scene image with no movement.

---

## Transition Behavior

All transition behavior rides the existing `showFrame()` + GSAP container fade architecture, mirroring ADR-006 §06.6.

### Scene-to-scene (normal navigation)

```
1. GSAP fades #scene-stage to opacity 0    ← effects invisible (parent hidden)
2. showFrame() runs:
   - canvas draws new image
   - if effects: effectsCanvas.loadScene(frame.effects, frame.image)
     else: effectsCanvas.clearAll()                        ← null-safe
   - shimmer.loadScene(frame.traceOverlay)
   - text rebuilds
3. GSAP fades #scene-stage to opacity 1    ← effects visible with new config
```

`loadScene()` calls `clearAll()` internally first, then creates new sprites/filters from the incoming config. This happens while the parent container is at opacity 0 — the user sees a clean fade, not a pop.

**Ticker lifecycle:** The PixiJS ticker runs continuously — `clearAll()` destroys scene content but does NOT stop the ticker. With no sprites/filters attached, ticker frames are no-ops (~0ms). The ticker is only stopped by `pause()` (user pause) and restarted by `resume()`. This avoids start/stop churn on every scene transition.

### Hard cut (paused navigation)

Hard cut calls `showFrame()` directly (no GSAP fade). `loadScene()` inside `showFrame()` performs an instant swap — old effects destroyed, new effects created in the same frame. No visual glitch because it's a single synchronous swap.

### Multi-frame jump (dot bar skip)

Same as normal scene-to-scene. Only the destination frame matters.

### Pause/resume

`doPause()` calls `effectsCanvas.pause()` which stops the PixiJS ticker. All displacement sprites freeze at their current scroll position. `doResume()` restarts the ticker from the frozen position — no drift, no jump. WCAG 2.2.2 compliance.

---

## Performance

```
CONCERN                  │ MITIGATION
─────────────────────────┼──────────────────────────────────────
PixiJS bundle size       │ ~133KB gzipped. Tree-shake unused modules
                         │ via Vite. Only import Application, Sprite,
                         │ DisplacementFilter, BlurFilter, Texture.
                         │ Also imports pixi.js/unsafe-eval for CSP.
─────────────────────────┼──────────────────────────────────────
GPU memory               │ Scene texture + displacement texture +
                         │ mask texture per region. ~10-20MB GPU
                         │ total for a scene with 3 regions.
─────────────────────────┼──────────────────────────────────────
Per-frame cost           │ GPU-native. DisplacementFilter is a
                         │ single fragment shader pass. Target:
                         │ <2ms per frame on baseline hardware
                         │ (see target matrix below).
─────────────────────────┼──────────────────────────────────────
Mask image memory        │ Grayscale PNGs at 768×432 ≈ 330KB per mask.
                         │ ~12 masks worst case = ~4MB total.
─────────────────────────┼──────────────────────────────────────
WebGL unavailability     │ Graceful degradation: effects disabled,
                         │ static scene image shown. No crash.
─────────────────────────┼──────────────────────────────────────
Audio-reactive overhead  │ getByteFrequencyData() ~0.1ms + band
                         │ averaging + lerp. < 0.2ms total. One FFT
                         │ read shared across all reactive regions.
─────────────────────────┼──────────────────────────────────────
Multiple render loops    │ PixiJS ticker for effects. Shimmer has
                         │ its own rAF. Scene canvas has none.
                         │ If baseline profiling shows >4ms combined
                         │ frame time: (1) move shimmer draw into
                         │ PixiJS ticker as a post-render callback,
                         │ eliminating the second rAF, or (2) reduce
                         │ shimmer to 30fps via frame-skip counter.
                         │ Decision deferred to profiling phase.
```

### Target hardware matrix

Performance targets are validated against these devices. "Baseline" is the floor — if it doesn't hit 60fps here, the effect config is too aggressive.

```
TIER       │ DEVICE / GPU                │ TARGET     │ NOTES
───────────┼─────────────────────────────┼────────────┼────────────────────────
Baseline   │ 2018 MacBook Air (Intel UHD │ 60fps,     │ Integrated GPU, worst
           │ 617), Chromebook (Mali-G72) │ <2ms/frame │ case for competition
───────────┼─────────────────────────────┼────────────┼────────────────────────
Mid-range  │ 2021 MacBook Pro (M1),      │ 60fps,     │ Expected majority of
           │ Windows laptop (GTX 1650)   │ <1ms/frame │ viewers
───────────┼─────────────────────────────┼────────────┼────────────────────────
Mobile     │ iPhone 12+, Pixel 6+        │ 60fps,     │ Mobile Safari WebGL
           │                             │ <2ms/frame │ has stricter limits
───────────┼─────────────────────────────┼────────────┼────────────────────────
No WebGL   │ Older browsers, forced      │ Static     │ Effects disabled,
           │ software rendering          │ fallback   │ no crash, no error
```

If baseline devices can't sustain 60fps, reduce displacement texture resolution (256×256 instead of 512×512) or limit to 1 active region per scene before cutting features.

### Profiling method and pass/fail gates

Profiling is not optional. Run before any PR that adds or changes effects.

```
METHOD:
  1. Chrome DevTools → Performance tab → record 10s of scene with most regions
  2. Filter to "GPU" and "Main" thread
  3. Read frame time from "Frames" lane (green bars)

PASS/FAIL:
  Baseline tier:  p95 frame time < 16.6ms (60fps) AND effects cost < 2ms
                  Measured on 2018 MacBook Air or Chromebook (real device, not throttled)
  Mid-range tier: p95 frame time < 16.6ms AND effects cost < 1ms
  Mobile tier:    p95 frame time < 16.6ms (test on real device via Chrome remote debug)

  FAIL = any of:
    - p95 frame time > 16.6ms on baseline
    - Visible frame drops (yellow/red bars in Frames lane)
    - GPU memory > 50MB (check chrome://gpu → Memory Information)
    - PixiJS ticker callback > 4ms on any device

REMEDIATION ORDER (if FAIL):
  1. Reduce displacement texture to 256×256
  2. Limit to 1 active region per scene
  3. Disable dust effect
  4. Reduce shimmer to 30fps via frame-skip
  5. Last resort: disable effects on baseline tier
```

---

## Authoring Workflow

1. Open scene image in Procreate/Photoshop
2. Paint white over the region to animate (water stream, heat zone, etc.)
3. Feather edges for natural falloff
4. Export as grayscale PNG to `public/assets/masks/`
5. Add region config to `scenes.json`
6. Tune parameters (speed, intensity, scale) in browser

---

## Test Matrix

```
CATEGORY          │ CASES
──────────────────┼────────────────────────────────────────────
loadScene         │ valid config, empty regions [], mask load failure, missing effects key
water effect      │ flow direction, speed 0 (static), varying intensity
heat effect       │ upward distortion, edge falloff
dust effect       │ gentle drift displacement, varying intensity from gray values
fog effect        │ blur without additive blend, gentle pulse
glow effect       │ additive blur bloom, pulse animation
shockwave effect  │ radial burst cycle, rest phase, displacement fade
pause/resume      │ effects freeze on pause, resume without drift
reduced motion    │ all effects static, no displacement
resize            │ PixiJS renderer resizes via existing ResizeObserver callback
                  │ (app.renderer.resize()) — no second observer. Mask sprites
                  │ rescale, filters rebuild.
mask failure      │ missing mask PNG → skip region, warn, don't crash
scene transition  │ old effects cleared before new scene loads
WebGL init fail   │ webglAvailable = false, all loadScene() no-op, app continues
context loss      │ clearAll() on loss, re-init on next loadScene, permanent
                  │ static fallback if re-init also fails
audioReactive     │ modulates target param from FFT band, smoothing works,
                  │ no audio (zeros) → stays at range[0], muted → range[0],
                  │ reduced motion → audioReactive ignored (base param used),
                  │ multiple reactive regions share one FFT read,
                  │ pause → no reads, resume → smooth catchup
```

---

## Open Questions (implementation details — do not affect the accepted architecture)

These are scoped implementation choices, not architectural decisions. The ADR's accepted decision (mask-based GPU effects via PixiJS) is not contingent on these outcomes.

1. ~~**loadScene() second argument — canvas element or image URL?**~~ **Resolved:** `sceneImageUrl` (string) is canonical. Fixed.
2. ~~**Displacement noise texture — generated or loaded?**~~ **Resolved (adversarial review, March 21 2026):** Pre-authored 256×256 PNG noise texture. Simpler than runtime Perlin generation, deterministic across devices, zero init cost. Stored in `public/assets/masks/` alongside region masks. Loaded via `new Image()` + `Texture.from()`. If visual quality proves insufficient for a specific effect, a per-effect noise texture can replace the shared one — no API change needed.
3. ~~**Particle emitter package — `@spd789562/particle-emitter` or `custom-pixi-particles`?**~~ **Resolved (adversarial review, March 21 2026):** Neither. The `dust-glow` effect type is replaced by `dust`, which uses DisplacementFilter (same as water and heat, with different parameters). No particle emitter dependency needed. This eliminates community fork risk and reduces bundle size.

## Implementation Status

**Code is not yet updated.** Current codebase still has: `<div id="trace-overlay">`, `effects.js` as no-op, `effects-canvas.js` with Canvas 2D `getContext('2d')`, old `effects: { idle, entry }` schema in scenes.json, CSS opacity transitions on `.trace-overlay`. All items below are pending implementation.

**Implementation note (adversarial review, March 21 2026):** ADR-007 owns the `<div>` → `<canvas>` conversion for `#trace-overlay` and the layer stack reorder. This is done as the opening commit of ADR-007 implementation, independent of ADR-006 shimmer logic.

## Action Items

1. [ ] Design and author mask images for all scenes (Ashley)
2. [x] Add pixi.js v8.17.1 (pinned) to package.json — no particle emitter package needed
3. [x] Implement effect factory registry in effects.js (water, heat, dust, fog, glow, shockwave)
4. [x] Refactor effects-canvas.js with PixiJS lifecycle (init, loadScene, clearAll, pause/resume)
5. [x] Implement water displacement (DisplacementFilter + scrolling noise sprite + mask)
6. [x] Implement heat displacement (DisplacementFilter, upward, large scale)
7. [x] Implement dust displacement (DisplacementFilter, multi-directional slow drift)
8. [x] Update app.js showFrame() to use new effects API
9. [ ] ~~Add mask preloading to loader.js pipeline~~ Masks loaded lazily via `new Image()` + `Texture.from()` inside loadScene(). No loader.js changes needed.
10. [x] Update scenes.json schema for all 12 frames
11. [x] WebGL fallback: detect unavailability, degrade to static + context loss recovery (re-init on next loadScene)
12. [x] Error boundary: try/catch around init(), webglAvailable flag, loadScene() no-op on failure
13. [ ] Performance profiling — verify <2ms per frame on baseline hardware (see profiling gates)
14. [ ] Update v5 spec §3, §4, §17
15. [ ] Add getAnalyserNode() to audio.js — lazy AnalyserNode on Howler's AudioContext
16. [ ] Add setAnalyser() to effects-canvas.js — store analyser, read FFT in ticker
17. [ ] Wire audio-reactive bridge in app.js showFrame()
18. [ ] Author Scene 11 audioReactive regions (glow + displacement reacting to music)
19. [ ] Test audioReactive: silence, muted, pause/resume, reduced motion, multiple bands
