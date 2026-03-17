# AGENTS.md

Canonical instruction source for this repository. Treat this file as authoritative.

## Scope

- Apply these rules when changing code in this repo.
- If a local instruction file conflicts with this file, prefer this file.

## Non-Negotiable Constraints

- Goal is long-term maintainable and reliable solutions only.
- Do not implement quick fixes in this codebase for any reason.
- Any test files introduced for local validation must be removed, not committed.

### Security: file access and path handling

- Reject any user-controlled path input containing `..`.
- Resolve to absolute paths before use.
- Enforce sandbox-root containment after resolution.
- Default to deny on validation failure.

### GitHub Actions: action pinning

- `actions/*` references may use tagged major versions (e.g., `@v6`).
- All other actions must be pinned to a commit SHA with the version in a comment
  (e.g., `@abc123 # v4.1.0`).

### Commit strategy

- Make small, atomic commits as you go — one logical change per commit.
- Do not batch unrelated changes into a single commit.
- Use Conventional Commits.
- Include required RAI footer:
  ```
  Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
  ```

## Project: carbon-trace

Immersive visual narrative for WeCoded 2026 Frontend Art Entry. Vite + vanilla JS with
Canvas 2D rendering, GSAP text/transition animation, and Howler.js audio. 12 frames
(title + 10 scenes + credits) with ghost-drift text, per-scene visual effects, ambient
audio, and recorded narration. Deployed via Cloud Run + nginx.

Full system design: `docs/carbon-trace-system-design-v3-final.md`

## Architecture: two rendering layers

- **Canvas 2D** (`<canvas>`, `aria-hidden="true"`): images, pixel effects, traces.
  Animated via `requestAnimationFrame`. Required for `getImageData`/`putImageData`
  pixel manipulation (ripple, dust, bloom). CSS cannot do this.
- **DOM overlay** (position: absolute over canvas): narration text, controls, a11y.
  GSAP animates this layer. Screen readers see only this layer.

### Module responsibilities

| Module              | Job                                             | Does NOT know about   |
| ------------------- | ----------------------------------------------- | --------------------- |
| `app.js`            | State machine, orchestrator                     | Pixel rendering       |
| `effects-canvas.js` | Canvas 2D lifecycle, render loop, pixel effects | Frame ordering, audio |
| `effects.js`        | Effect registry, `runEffect`/`clearEffects` API | Canvas internals      |
| `audio.js`          | Howler — ambient crossfade, narration, replay   | DOM, canvas           |
| `text.js`           | Ghost-drift GSAP timelines from config          | Audio, canvas         |
| `overlay.js`        | DOM controls — dot bar, buttons, progress       | Canvas, audio         |

### Rules

- Each module does ONE thing. No cross-imports between leaf modules.
- `app.js` is the only module that knows frame ordering.
- Scene differences = config data in `scenes.json`, not if-blocks.
- Effects receive canvas context + dimensions; return cleanup functions.
- Canvas effects use `requestAnimationFrame`; GSAP animates DOM only.

## Code Style

- Vanilla JavaScript (ES modules, no TypeScript).
- Prettier for formatting, ESLint for linting.
- No class hierarchies — flat modules with focused functions.
- One orchestrator (`app.js`) manages state; other modules are pure utilities.

## Test Standards

- **Coverage thresholds**: 85% lines/functions/statements, 80% branches (enforced in vitest.config.js).
- Every new module or utility must ship with positive, negative, and edge-case tests.
- GSAP and Howler are mocked in unit tests; E2E tests exercise the real DOM.
- Canvas context is mocked in unit tests via a `getContext('2d')` stub.

## Performance / Lighthouse

- **Targets**: 100% desktop performance, 90%+ mobile performance, 95%+ accessibility/best-practices/SEO.
- Images are WebP, 16:9, 2x resolution. Total asset budget <35MB.
- Preloading uses `Promise.all` on image loads + Howler preloads.
- Canvas render target: 60fps during effects (rAF loop).

## Accessibility

- Canvas is `aria-hidden="true"`. All semantic content lives in DOM overlay.
- Stable DOM narration via `aria-live="polite"` for screen readers.
- `prefers-reduced-motion` swaps ghost-drift for simple fade or static text.
  Canvas effects minimal/none under reduced motion.
- Keyboard navigation: Space/Enter advances, Tab to replay/mute.
- Narration panel meets WCAG AA contrast.

## Documentation

- Keep docs in `docs/` aligned with the codebase — update them whenever code changes affect architecture, audio system, or accessibility behavior.
- Prefer Mermaid diagrams whenever a visual would clarify architecture, data flow, or state machines.
- System design doc is authoritative for architectural decisions: `docs/carbon-trace-system-design-v3-final.md`
