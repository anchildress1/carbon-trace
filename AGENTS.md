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
- Include required RAI footer adding your name in place of Claude and valid email instead of anthropic:
  ```
  Co-authored-By: Claude <noreply@anthropic.com>
  ```

## Project: carbon-trace

Immersive visual narrative for WeCoded 2026 Frontend Art Entry. Vite + vanilla JS with
Canvas 2D rendering, GSAP text/transition animation, and Howler.js audio. 12 frames
(title + 10 scenes + credits) with ghost-drift text, per-scene visual effects, ambient
audio, and recorded narration. Deployed via Cloud Run + nginx.

Full system design: `docs/design_decisions/*.md`

## Architecture: two rendering layers

- **Canvas 2D** (`<canvas>`, `aria-hidden="true"`): scene images drawn via
  `ctx.drawImage()` with cover-fit, plus pixel effects and traces.
  Animated via `requestAnimationFrame`. Required for `getImageData`/`putImageData`
  pixel manipulation (ripple, dust, bloom) and v2 runtime trace rendering.
- **DOM overlay** (position: absolute over canvas): narration text, captions,
  controls, a11y. GSAP animates this layer. Screen readers see only this layer.

### Module responsibilities

| Module              | Job                                                             | Does NOT know about   |
| ------------------- | --------------------------------------------------------------- | --------------------- |
| `app.js`            | State machine, orchestrator                                     | Pixel rendering       |
| `canvas.js`         | Canvas 2D — image drawing, cover-fit, resize                    | Frame ordering, audio |
| `effects-canvas.js` | Canvas 2D effects overlay, render loop                          | Frame ordering, audio |
| `effects.js`        | Effect registry, `runEffect`/`clearEffects` API                 | Canvas internals      |
| `audio.js`          | Howler — ambient crossfade, narration, music, buffer monitoring | DOM, canvas           |
| `text.js`           | Ghost-drift GSAP timelines from config                          | Audio, canvas         |
| `captions.js`       | Timed captions, localStorage persistence                        | Audio, canvas         |
| `overlay.js`        | DOM controls — dot bar, buttons, progress                       | Canvas, audio         |
| `loader.js`         | Audio metadata preloading, frame-aware sequencing               | DOM, app state        |

### Rules

- Each module does ONE thing. No cross-imports between leaf modules.
- `app.js` is the only module that knows frame ordering.
- Scene differences = config data in `scenes.json`, not if-blocks.
- Effects receive canvas and scene canvas elements; cleanup is handled by `clearEffects()`.
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
- Background preloading uses `Promise.all` to parallelize image and audio streams; within each stream, assets load sequentially. Audio metadata preloading uses native `Audio` elements; Howler handles actual playback.
- Canvas render target: 60fps during effects (rAF loop).

## Accessibility

- Canvas is `aria-hidden="true"`. All semantic content lives in DOM overlay.
- Stable DOM narration via `aria-live="polite"` for screen readers.
- `prefers-reduced-motion` swaps ghost-drift for simple fade or static text.
  Canvas effects minimal/none under reduced motion.
- Keyboard navigation: Space toggles play/pause, Enter/ArrowRight advances,
  ArrowLeft retreats, Tab to replay/mute.
- Narration panel meets WCAG AA contrast.

## Documentation

- Keep docs in `docs/` aligned with the codebase — update them whenever code changes affect architecture, audio system, or accessibility behavior.
- Prefer Mermaid diagrams whenever a visual would clarify architecture, data flow, or state machines.
- System design docs are authoritative for architectural decisions: `docs/design_decisions/*.md`

## Security

- Before committing any changes, follow all rules in `.github/instructions/sonarqube_mcp.instructions.md`.
