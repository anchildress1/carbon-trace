# AGENTS.md

Canonical instruction source for this repository. Treat this file as authoritative.

## Scope

- Apply these rules when changing code in this repo.
- If a local instruction file conflicts with this file, prefer this file.

## Non-Negotiable Constraints

- Goal is long-term maintainable and reliable solutions only.
- Do not implement quick fixes in this codebase for any reason.
- Do not maintain backwards compatibility in this codebase for any reason.
- Any test files introduced for local validation must be removed, not committed.

### User approval for behavior decisions

- Never unilaterally decide that a known limitation, degraded behavior, or
  quality tradeoff is "acceptable." If a decision affects user experience or
  technical excellence — even when replying to a PR review comment — you MUST
  stop and ask the user before committing to a position.
- This includes: deferring fixes as "post-launch," accepting degraded
  audio/visual/interaction quality, choosing not to fix a real issue, or
  characterizing a bug as a feature.
- When in doubt, surface the tradeoff and let the user decide.

### Spec compliance

- All implementation MUST follow `docs/carbon-trace-system-design.md` and
  `docs/ADRs/*.md` as the authoritative source of truth.
- If a deviation from the spec is warranted, you MUST:
  1. Stop implementation.
  2. Present the deviation and its rationale to the user.
  3. Update the relevant spec and/or create a new ADR document to reflect the approved change noting the replacement in the original version.
  4. Only then proceed with implementation.
- Never silently diverge from the spec. Undocumented drift creates rework.

### Port management

- Never kill ports or processes listening on ports (e.g., `lsof -ti | xargs kill`, `kill` on a PID bound to a port).
- If a port conflict arises, report it to the user and let them decide how to resolve it.

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
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

## Project: carbon-trace

Immersive visual narrative for WeCoded 2026 Frontend Art Entry. Vite + vanilla JS with
Canvas 2D rendering, GSAP text/transition animation, and Howler.js audio. 12 frames
(title + 10 scenes + credits) with ghost-drift text, per-scene visual effects, ambient
audio, and recorded narration. Deployed via Cloud Run + nginx.

Full system design: `docs/carbon-trace-system-design.md` and `docs/ADRs/*.md`

## Architecture: two rendering layers

- **Canvas 2D** (`<canvas>`, `aria-hidden="true"`): scene images drawn via
  `ctx.drawImage()` with cover-fit, plus pixel effects and traces.
  Animated via `requestAnimationFrame`. Required for `getImageData`/`putImageData`
  pixel manipulation (ripple, dust, bloom) and v2 runtime trace rendering.
- **DOM overlay** (position: absolute over canvas): narration text, captions,
  controls, a11y. GSAP animates this layer. Screen readers see only this layer.

### Module responsibilities

| Module              | Job                                                              | Does NOT know about   |
| ------------------- | ---------------------------------------------------------------- | --------------------- |
| `app.js`            | State machine, orchestrator                                      | Pixel rendering       |
| `canvas.js`         | Canvas 2D — image drawing, cover-fit, resize                     | Frame ordering, audio |
| `effects-canvas.js` | PixiJS WebGL effects overlay, render loop (imports effects.js)   | Frame ordering, audio |
| `effects.js`        | Effect factory registry, `registerEffect`/`createEffect` API     | Canvas internals      |
| `audio.js`          | Howler — ambient crossfade, narration, buffer monitoring         | DOM, canvas           |
| `text.js`           | Ghost-drift GSAP timelines from config                           | Audio, canvas         |
| `captions.js`       | Timed captions, localStorage persistence                         | Audio, canvas         |
| `keyboard.js`       | Declarative key-action map, document listener, button guard      | App state, DOM, audio |
| `overlay.js`        | DOM controls — dot bar, roving-tabindex dots, progress           | Canvas, audio         |
| `loader.js`         | Audio metadata preloading, frame-aware sequencing                | DOM, app state        |
| `shimmer.js`        | Trace shimmer overlay — mask-based pixel-walking dots (ADR-006A) | Frame ordering, audio |
| `credits.js`        | Credits overlay — GSAP scroll, focus/hover pause (ADR-011)       | Frame ordering, audio |
| `pausable-timer.js` | Pause-aware timer — used by audio.js and app.js                  | Everything else       |

### Rules

- Each module does ONE thing. No cross-imports between leaf modules
  (exception: `effects-canvas.js` imports from `effects.js` — directed
  dependency per ADR-007).
- `app.js` is the only module that knows frame ordering.
- Scene differences = config data in `scenes.json`, not if-blocks.
- Effects receive canvas and scene canvas elements; cleanup is handled by `clearEffects()`.
- Canvas effects use `requestAnimationFrame`; GSAP animates DOM only.

## Code Style

- Vanilla JavaScript (ES modules, no TypeScript).
- Prettier for formatting, ESLint for linting.
- No class hierarchies — flat modules with focused functions.
- One orchestrator (`app.js`) manages state; other modules are pure utilities.
- `src/scenes.json` narration text is written in Appalachian dialect — never correct spelling, grammar, or phrasing in this file.

## Development Commands

| Command          | Description                                      |
| ---------------- | ------------------------------------------------ |
| `make unit`      | Run unit tests with coverage                     |
| `make e2e`       | Build, then run Playwright E2E tests             |
| `make test`      | Run all tests (unit + E2E + performance)         |
| `make build`     | Production build                                 |
| `make lint`      | Lint source and test files                       |
| `make ai-checks` | Run secret-scan, format check, and lint (for AI) |
| `make deploy`    | Deploy to Cloud Run via `deploy.sh`              |

## Test Standards

- **Coverage thresholds**: 97% lines, 98% functions, 95% statements, 88% branches (enforced in vitest.config.js).
- Every new module or utility must ship with positive, negative, and edge-case tests.
- GSAP and Howler are mocked in unit tests; E2E tests exercise the real DOM.
- Canvas context is mocked in unit tests via a `getContext('2d')` stub.

## Performance / Lighthouse

- **Targets** (enforced in `.lighthouserc.json` and `.lighthouserc.mobile.json`):
  Desktop: ≥90% performance, 100% accessibility, ≥95% best-practices, ≥90% SEO.
  Mobile: ≥85% performance (approved temporary exception), 100% accessibility, ≥95% best-practices, ≥90% SEO.
- **Mobile performance known gap**: Mobile Lighthouse scores 0.86 under simulated
  Slow 4G + 4x CPU throttle (approved threshold 0.85). Root cause is a 3.7s LCP render delay —
  the initial JS module graph (~175KB uncompressed: GSAP, Howler, entry bundle) blocks
  the main thread from painting the `.loading-title` LCP element. PixiJS is already
  lazy-loaded via dynamic `import()`. Restoring mobile to ≥0.90 requires deferring GSAP/Howler
  behind dynamic imports — a moderate refactor of `app.js` import structure. Desktop
  scores ≥0.90.
- **Mask textures**: Gray+alpha (2-channel, 16bpp) PNG format. Total mask payload ~3.3MB.
- Images are WebP, 16:9, 2x resolution. Total asset budget <35MB.
- All asset filenames in `public/assets/` carry an 8-char SHA-256 content
  hash suffix for cache busting (ADR-010). When adding or updating any asset,
  generate the hash (`shasum -a 256 <file> | cut -c1-8`), include it in the
  filename, and update all references (`scenes.json`, `styles.css`, etc.).
- Background preloading uses `Promise.all` to parallelize image and audio streams; within each stream, assets load sequentially. Audio metadata preloading uses native `Audio` elements; Howler handles actual playback.
- Canvas render target: 60fps during effects (rAF loop).

## Accessibility

- Canvas is `aria-hidden="true"`. All semantic content lives in DOM overlay.
- Stable DOM narration via `aria-live="polite"` for screen readers.
- `prefers-reduced-motion` swaps ghost-drift for simple fade or static text.
  Canvas effects minimal/none under reduced motion.
- Keyboard navigation: Space toggles play/pause, Escape pauses,
  Enter/ArrowRight advances, ArrowLeft retreats, Tab to replay/mute.
- Narration panel meets WCAG AA contrast.

## Documentation

- Keep docs in `docs/` aligned with the codebase — update them whenever code changes affect architecture, audio system, or accessibility behavior.
- Prefer Mermaid diagrams whenever a visual would clarify architecture, data flow, or state machines.
- System design docs are authoritative for architectural decisions: `docs/carbon-trace-system-design.md` and `docs/ADRs/*.md`

## Security

- Before committing any changes, follow all rules in `.github/instructions/sonarqube_mcp.instructions.md`.
- After modifying source files, use the SonarQube MCP `analyze_code_snippet` tool to
  scan each changed file for new issues before committing. Fix any issues found.
  Use `search_sonar_issues_in_projects` with the PR ID to check for open issues
  on the current branch.
