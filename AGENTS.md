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

### Commit format (when committing is requested)

- Use Conventional Commits.
- Include required RAI footer:
  ```
  Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
  ```

## Project: carbon-trace

Immersive visual narrative for WeCoded 2026 Frontend Art Entry. Vite + vanilla JS with
GSAP animations and Howler.js audio. 12 frames (title + 10 scenes + credits) with
ghost-drift text, per-scene visual effects, ambient audio, and recorded narration.
Deployed as a static site to GitHub Pages.

## Code Style

- Vanilla JavaScript (ES modules, no TypeScript).
- Prettier for formatting, ESLint for linting.
- No class hierarchies — flat modules with focused functions.
- One orchestrator (`app.js`) manages state; other modules are pure utilities.

## Test Standards

- **Coverage thresholds**: 85% lines/functions/statements, 80% branches (enforced in vitest.config.js).
- Every new module or utility must ship with positive, negative, and edge-case tests.
- GSAP and Howler are mocked in unit tests; E2E tests exercise the real DOM.

## Performance / Lighthouse

- **Targets**: 100% desktop performance, 90%+ mobile performance, 95%+ accessibility/best-practices/SEO.
- Images are WebP, 16:9, 2x resolution. Total asset budget <35MB.
- Preloading uses `Promise.all` on image loads + Howler preloads.

## Accessibility

- Stable DOM narration via `aria-live="polite"` for screen readers.
- `prefers-reduced-motion` swaps ghost-drift for simple fade or static text.
- Keyboard navigation: Space/Enter advances, Tab to replay/mute.
- Narration panel meets WCAG AA contrast.

## Documentation

- Do not add docs to project unless specifically asked.
