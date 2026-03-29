# ADR-001: Foundational Architecture for carbon-trace

**Status:** Accepted
**Date:** March 14 2026
**Deciders:** Ashley Childress (@anchildress1)

## Context

carbon-trace is an immersive visual narrative for the WeCoded 2026 Frontend Art competition (deadline April 5, 2026). 12 frames (title + 10 scenes + credits) tell the story of a diamond trapped in a coal seam, rendered as painterly art with ghost-drift text, narration audio, and per-scene visual effects. Judged on: Creativity, Effective Use of Frontend Technology, Aesthetic Outcome.

The architecture must support:

- Pixel-level visual effects (shimmer, ripple, bloom) now, and runtime procedural trace rendering in v2
- Simultaneous audio mixing (ambient loops + narration + crossfade)
- Animated text overlays with overlapping timelines
- Screen reader accessibility despite a visually-driven experience
- Random-access navigation (dot bar) across all 12 frames
- Solo developer, 25-day timeline, existing infrastructure

## Decisions

### 1. Canvas 2D as primary renderer (over DOM+CSS and WebGL)

**Rejected: DOM+CSS.** v2 requires pixel access via `getImageData()`/`putImageData()` for runtime trace rendering. CSS operates on element boxes, not pixels. Switching renderers mid-project is worse than starting with the right one.

**Rejected: WebGL.** GPU shader pipeline is overkill for 2D image rendering and pixel manipulation. No 3D, no scene graphs, no shader compilation needed.

**Cost:** Canvas is a black box to screen readers. Mitigated by DOM overlay layer (Decision #2).

### 2. Two rendering layers (Canvas + DOM overlay)

Canvas handles the visual plane (images, pixel effects, traces). DOM overlay handles the semantic plane (text, buttons, accessibility). Canvas is `aria-hidden="true"`. Screen readers see only the DOM layer.

GSAP animates DOM elements. `requestAnimationFrame` animates canvas. No crossover.

### 3. Vanilla JS (no framework)

~20 DOM elements in the overlay. No component reuse. Linear path, one page. GSAP handles DOM animation. Adding React for this is pure overhead.

### 4. Flat modules with single orchestrator

12 frames, one orchestrator (`app.js`), flat function modules. No class hierarchy.

Module boundary rules:

- `app.js` is the ONLY module that knows frame ordering
- All leaf modules receive config objects, not frame indices
- No module imports from `app.js` (one-direction dependency)
- No cross-imports between leaf modules

### 5. GSAP for DOM animation

Timeline API sequences across elements and fires callbacks mid-animation. CSS keyframes cannot. Ghost-drift text requires overlapping enter/exit timelines with per-line timing. GSAP's `timeline()` is the workflow orchestrator.

### 6. Howler.js for audio

Simultaneous ambient + narration with crossfade. Mobile autoplay unlock. `.fade()`, `.loop()`, `.volume()`. Raw Web Audio API requires manual gain nodes. HTML5 `<audio>` is single-track, no mixing.

### 7. Vite for build

Fast HMR, ES modules, tree-shakes GSAP/Howler. Already known—no learning curve during deadline.

### 8. Cloud Run + nginx + GitHub Actions for deployment

Static site. Vite builds to `dist/`. Container-based deployment on existing verified domain. CI/CD via GitHub Actions. Known infrastructure.

### 9. `navigate(from, to)` as single navigation function

Dot bar enables random-access—the user can jump from frame 2 to frame 9. One function handles all navigation: dots, forward/back buttons, keyboard, click-to-skip, and auto-advance timer. Five+ callers, one code path.

**Rejected: Separate `next()`/`prev()`/`jumpTo()` functions.** Duplicated logic, divergent behavior.

### 10. Preload all images on init (over lazy loading)

Random access via dot bar means any image could be needed next. 12 WebP images at 1536x824 is ~2-5MB total. One 3-second wait on load beats 0.5s stutter on every jump.

### 11. Scene config as data, not logic

All 12 frames share identical schema shape—same keys, same types. `null` means "skip this feature." Scene differences expressed as data in `scenes.json`, not `if`-blocks in code. New per-scene behavior is added by adding a config key, not a conditional.

### 12. Ghost-drift text (over typewriter)

Lines "pour in and blow out" independently on the DOM overlay—overlap allowed. Atmospheric, not mechanical. GSAP drives opacity + subtle Y drift. Reduced motion swaps drift for simple fade.

### 13. Baked traces in images

Circuit traces baked into Leonardo AI images at scene-appropriate visibility.

## Consequences

**What becomes easier:**

- Pixel effects work from day 1—no renderer migration needed for v2
- Screen reader support is clean—DOM overlay is the a11y layer, canvas is invisible
- Navigation logic lives in one place—any new input source just calls `navigate()`
- Adding new scenes is pure data—drop an entry in `scenes.json`

**What becomes harder:**

- Canvas text rendering is off the table—all text must live in DOM overlay
- No component lifecycle management—DOM state is manual (acceptable at this scale)
- Testing visual output requires screenshots, not DOM assertions

**What to revisit as the system grows:**

- If v2 effects need GPU acceleration, Canvas 2D → WebGL migration becomes real cost
- If ambient audio library grows large, lazy-loading audio becomes necessary
- If frame count exceeds ~20, preload-all strategy needs progressive loading

---

## Addendum: Remove Narration Alignment Parameter (March 2026)

**Status:** Accepted

### Motivation

The narration schema carried alignment noise (`align`) that did
not add real expressive power. Each line already has exact placement control
through viewport-relative `x`/`y` percentages, so per-line alignment input is
redundant and increases configuration surface area without benefit.

### Change

- Remove alignment parameter plumbing from narration line creation.
- Remove `align` from narration schema documentation.
- Keep positioned-line visual behavior deterministic via CSS
  (`.narration-line--positioned { text-align: left; }`).

### Consequence

Narration line placement remains precise and predictable, while the config
model is simpler: position drives layout; alignment is fixed presentation.
