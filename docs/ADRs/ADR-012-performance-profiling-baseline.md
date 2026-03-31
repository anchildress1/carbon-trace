# carbon-trace — ADR-012: Performance Profiling Baseline

**Status:** Accepted
**Date:** March 30, 2026
**Author:** Ashley Childress (@anchildress1)
**Deciders:** Ashley Childress
**Supersedes:** None. Establishes quantitative performance baselines and documents optimizations applied to meet Lighthouse CI gates.

---

## 012.1 Context

Desktop Lighthouse CI gates at 90% performance and passes in CI. Mobile Lighthouse config existed but had **no assertions** — mobile scores were unknown. No baseline profiling existed for runtime functional flows beyond scene transition latency and credits FPS.

This ADR documents:
1. Baseline performance profiling infrastructure for all major functional flows
2. Optimizations applied to push both desktop and mobile Lighthouse performance above 90%
3. Measured impact of each optimization
4. How to run profiling

---

## 012.2 Pre-Optimization Baseline

### Lighthouse Scores (before any changes)

| Category         | Desktop | Mobile |
|------------------|---------|--------|
| Performance      | 99%     | 79%    |
| Accessibility    | 100%    | 100%   |
| Best Practices   | 100%    | 100%   |
| SEO              | 100%    | 100%   |

### Mobile Performance Bottleneck Analysis

Mobile Lighthouse applies simulated throttling: **4x CPU slowdown**, slow 4G network (1.6 Mbps download, 150ms RTT).

The primary bottleneck was **LCP (Largest Contentful Paint) at 4.4s**, with 90% of that time in "Render Delay." Root causes:

1. **Font critical chain depth:** The italic Lora font (LCP element's font) was 3 levels deep in the critical chain: HTML → CSS → font file. Under slow 4G, each hop adds ~150ms RTT + transfer time.

2. **Font format:** TTF fonts (219 KB italic, 211 KB normal = 430 KB total) lack internal compression. Under 1.6 Mbps, transferring 430 KB takes ~2.1s.

3. **`font-display: swap` interaction:** Lighthouse measures LCP at the font swap time (when the real font replaces the fallback), not when fallback text first paints. This makes font download time a direct component of LCP.

4. **JavaScript payload:** PixiJS shipped all three renderers (WebGL + Canvas + WebGPU = ~188 KB unnecessary code). App code, GSAP, and Howler were bundled in a single 173 KB chunk, preventing parallel download/parse.

---

## 012.3 Optimizations Applied

### 1. PixiJS Tree-Shaking to WebGL-Only (commit `2af98bd`)

**Problem:** `autoDetectRenderer` dynamically imports CanvasRenderer (84 KB) and WebGPURenderer (38 KB), neither of which this app uses.

**Solution:** Vite plugin (`pixiWebGLOnly`) intercepts module loading for CanvasRenderer and WebGPURenderer paths, replacing them with `export const XRenderer = null;` stubs. Combined with `preference: 'webgl'` in `Application.init()`.

**Impact:** CanvasRenderer and WebGPURenderer chunks reduced from ~122 KB to 0.18 KB total (stubs only).

**Files:** `vite.config.js`, `src/effects-canvas.js`

### 2. Vendor Chunk Splitting (commit `f1a6b1e`)

**Problem:** App code + GSAP + Howler in a single 173 KB `index-*.js` chunk. Serial parse/compile on throttled mobile CPU.

**Solution:** `manualChunks` function in Vite config splits GSAP and Howler into separate chunks.

**Result:**
- `gsap-*.js`: 69 KB (gzip: 27 KB)
- `howler-*.js`: 36 KB (gzip: 10 KB)
- `index-*.js`: 70 KB (gzip: 23 KB)

**Impact:** Browser can download and parse chunks in parallel. Vendor chunks get long-term caching via content hashes.

**Files:** `vite.config.js`

### 3. Font Preload Hint (commit `f51551a`)

**Problem:** Italic Lora font (LCP-critical) discovered only after CSS is parsed — 3 levels deep in the critical chain.

**Solution:** `<link rel="preload">` in `<head>` for the italic WOFF2 font. Browser begins downloading immediately at HTML parse time, eliminating one chain hop.

**Impact:** Reduced critical chain depth from 3 to 2 for the LCP element's font.

**Files:** `index.html`

### 4. CSS Containment (commit `2e337de`)

**Problem:** No `contain` properties. Browser considers entire DOM for layout/paint calculations during canvas animations.

**Solution:**
- `contain: strict` on `.scene-stage`, `.scene-canvas`, `.effects-canvas`, `.trace-overlay` (fixed-size, no overflow)
- `contain: layout style` on `.narration-layer`, `.overlay-controls` (flow content but isolated layout)

**Impact:** Reduced layout/paint scope during 60fps animation loops.

**Files:** `src/styles.css`

### 5. TTF to WOFF2 Font Conversion (commit `e85f85c`)

**Problem:** TTF fonts lack compression. 430 KB total font payload under 1.6 Mbps slow 4G = ~2.1s transfer time.

**Solution:** Converted both Lora variable fonts from TTF to WOFF2 (internal Brotli compression). Updated `@font-face` declarations to use `format('woff2-variations')`.

**Result:**
- Italic: 219 KB → 91 KB (58% reduction)
- Normal: 211 KB → 85 KB (60% reduction)
- Total: 430 KB → 176 KB (59% reduction)

**Impact:** Font transfer time under slow 4G: ~2.1s → ~0.9s. This was the single highest-impact change for mobile LCP.

**Files:** `public/assets/fonts/`, `src/styles.css`, `index.html`

### 6. Deferred PixiJS Import and Effects/Shimmer Init (commit `ec9faf5`)

**Problem:** The dynamic `import('./effects-canvas.js')` fired at top-level module evaluation, putting ~330 KB of PixiJS JS on the critical rendering path. `initEffectsCanvas()` and `initShimmer()` ran at the start of `initApp()`, adding TBT before LCP.

**Solution:** The dynamic import is deferred until after the loading prompt becomes visible (post-LCP). `initEffectsCanvas()` and `initShimmer()` are moved to the same post-LCP point. Frame 0 has no effects or shimmer, so nothing visual is lost. The import begins while the user reads the prompt and is ready before they advance to frame 1.

**Impact:** Mobile TBT reduced from ~50ms to 0-19ms under simulated throttling.

**Files:** `src/app.js`

---

## 012.4 Post-Optimization Results

### Lighthouse Scores (after all optimizations)

| Category         | Desktop | Mobile | Target | Status |
|------------------|---------|--------|--------|--------|
| Performance      | 99%     | 90%    | ≥ 90%  | Pass   |
| Accessibility    | 100%    | 100%   | ≥ 95%  | Pass   |
| Best Practices   | 100%    | 100%   | ≥ 95%  | Pass   |
| SEO              | 100%    | 100%   | ≥ 90%  | Pass   |

Mobile performance verified across 3 consecutive runs at 90%.

### Build Size Comparison

| Chunk | Before | After | Change |
|-------|--------|-------|--------|
| CanvasRenderer | 84 KB | 0.09 KB (stub) | -99.9% |
| WebGPURenderer | 38 KB | 0.09 KB (stub) | -99.8% |
| index (app bundle) | 173 KB | 70 KB | -60% |
| gsap (split out) | — | 69 KB | new chunk |
| howler (split out) | — | 36 KB | new chunk |
| Fonts (total) | 430 KB | 176 KB | -59% |

---

## 012.5 Baseline Profiling Infrastructure

### Test Suite

`tests/perf/baseline-profiles.spec.js` profiles 7 functional flows:

| Flow | Metrics Captured |
|------|-----------------|
| Page load → loading prompt | FCP, LCP, long tasks, CLS |
| Click-to-begin → scene 1 | Transition latency, long tasks |
| Forward navigation (3 advances) | Per-transition latency, long tasks |
| Backward navigation (3 retreats) | Per-transition latency, long tasks |
| Effects steady-state FPS | Avg FPS, p95 frame time, dropped frame % |
| Pause/resume responsiveness | Keypress-to-state-change latency |
| Full navigation cycle memory | JS heap size, cumulative long tasks |

Each test attaches a JSON artifact via `testInfo.attach()` for cross-run comparison. No thresholds are enforced — this is observational profiling for tracking regressions over time.

FPS and memory tests are chromium-only (skip on mobile-chrome project).

### Shared Helpers

`tests/perf/helpers.js` provides reusable utilities extracted from existing perf specs:

- `dismissLoadingScreen(page)` — click through loading screen
- `measureAdvanceLatencyMs(page)` / `measureRetreatLatencyMs(page)` — scene transition timing
- `injectLongTaskObserver(page)` / `collectLongTasks(page)` — PerformanceObserver for long tasks
- `collectPaintMetrics(page)` — FCP/LCP extraction
- `sampleRafStats(page, durationMs)` — rAF-based FPS sampling
- `percentile(arr, p)` — statistical percentile calculation
- `emulatePixelClassProxy(page)` — CSS class proxy for pixel-ratio-dependent tests

### Running Profiling

```bash
# Full perf suite (Lighthouse + baseline + runtime)
make perf

# Baseline profiling only
pnpm perf:baseline

# Desktop Lighthouse only
pnpm perf:lighthouse:desktop

# Mobile Lighthouse only
pnpm perf:lighthouse:mobile
```

The `scripts/run-perf.mjs` orchestrator runs all suites in sequence: desktop Lighthouse → mobile Lighthouse → baseline profiling → runtime flow tests.

---

## 012.6 Remaining Limitations

### Mobile Performance Hard Ceiling: CSS Animation Delay

Mobile is at the 90% threshold. The remaining LCP time (3.5s, 87% "Render Delay") is **not caused by fonts, JS, or network** — it's caused by the intentional CSS animation on `.loading-title`:

```css
.loading-title {
  color: rgba(232, 220, 195, 0);           /* starts fully transparent */
  animation: title-emerge 1.8s ease 1.2s forwards;  /* 1.2s delay + 1.8s fade */
}
```

The LCP element ("Carbon Trace" title) is invisible for ~3s due to the 1.2s animation delay plus the time for opacity to reach a measurable level. Under 4x CPU throttle, Lighthouse measures LCP at the point the text becomes visually present — which is the animation timing, not any resource bottleneck.

**To push above 90%, the title animation would need to start visible or have a shorter delay.** This is a UX decision — the slow fade-in is an intentional part of the immersive loading experience.

### Evaluated and Rejected: `font-display: optional`

`font-display: optional` was tested but provides no benefit here. Since the LCP text is invisible for 3s due to the CSS animation, the font loading strategy doesn't affect when LCP is measured. Additionally, `optional` risks permanently showing the Georgia fallback font instead of Lora italic on slow connections — unacceptable for an art piece.

---

## 012.7 CI Enforcement

Both desktop and mobile Lighthouse are enforced in CI:

- **Desktop:** `pnpm exec lhci autorun` (uses `.lighthouserc.json`)
- **Mobile:** `pnpm exec lhci autorun --config=.lighthouserc.mobile.json`

Both configs assert the same thresholds: 90% performance, 95% accessibility, 95% best practices, 90% SEO. Reports are uploaded as CI artifacts for debugging regressions.
