# ADR-002: Narration-Driven Auto-Advance with Hard Cut on Pause

**Status:** Accepted (timing mechanism superseded by ADR-009)
**Date:** March 17, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Supersedes:** Click-to-advance interaction model (v3 §5.3, §5.8)

## Context

The v3 design specified click-to-advance as the primary interaction model. During implementation, two conflicts emerged:

**Conflict 1 — Dead zone.** Scenes auto-play their content (narration, ghost-drift text, effects) but do NOT auto-advance. The viewer hears narration end, watches text drift away, then stares at a static image until they realize they need to click. That dead zone between "scene done" and "viewer clicks" is where immersion dies.

**Conflict 2 — Pause state vs. transitions.** When paused and jumping via dot bar, the transition needs to un-pause temporarily for GSAP animation to run, but the new scene then lands playing — overriding the user's pause intent. Any solution that temporarily un-pauses for animation is just the `wasPaused` pattern wearing different clothes.

Root cause: click-to-advance is the wrong primary input for narrated, paced, authored content. The narration IS the pacing clock. The click was fighting it.

## Options Considered

### Option A: Narration-driven auto-advance + click as skip + hard cut when paused

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — adds 2 state vars (paused, advanceTimer), hardCut path |
| Risk | Low — additive, doesn't break existing modules |
| UX fit | High — narration drives the experience it was designed for |
| WCAG compliance | Full — play/pause button satisfies 2.2.2 |

**Pros:** Eliminates dead zone. Narration IS the pacing clock. Clean pause semantics. `holdAfterNarration` handles per-scene timing; credits use frame-index bound check.

**Cons:** Adds state (4 vars instead of 2). Paused navigation has no visual transition (hard cut). pendingPause pattern for mid-transition pause adds edge case logic.

### Option B: Click-to-advance + wasPaused memory across transitions

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — add boolean, check after transition |
| Risk | Medium — patches symptom, not cause |
| UX fit | Low — 12 mandatory clicks to experience a story is a slideshow |
| WCAG compliance | Partial — no auto-advance means no 2.2.2 requirement, but also no pacing |

**Pros:** Minimal code change. No new state machine complexity.

**Cons:** Dead zone persists — narration ends, viewer stares, must click. wasPaused is a bandaid on the wrong interaction model. 12 clicks to finish = slideshow.

### Option C: Hybrid per-scene advanceMode (narration OR click)

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — two code paths in app.js for same result |
| Risk | Medium — mode switching increases bug surface |
| UX fit | Medium — solves the problem but overcomplicated |
| WCAG compliance | Partial — only narration-mode scenes trigger 2.2.2 |

**Pros:** Maximum per-scene control.

**Cons:** Only title + Scene 8 need click-hold. Option A's `holdUntilClick` flag achieves this without a full mode system. Two advance code paths are two bug surfaces.

## Decision

**Option A: Narration-driven auto-advance.**

Scenes auto-advance when narration completes plus a configurable hold time (`holdAfterNarration`). Click/tap anywhere skips forward immediately. Play/pause controls the entire flow. Credits do not auto-advance (determined by `shouldAutoAdvance()` checking frame index bounds).

**Hard rule on pause:** If paused, navigation is a hard cut — no crossfade, no GSAP transition, no temporary un-pause. Draw the new scene image, set up content, freeze everything. The viewer presses play to start the scene. This eliminates the entire class of pause-vs-transition state bugs.

### UX research basis

- **NNG carousel research:** Auto-advancing is disruptive for carousels, but carbon-trace is not a carousel. The viewer deliberately enters the experience. Narration is the content, not an interruption.
- **Scrollytelling pattern:** Scroll-pacing works for reading-speed content but breaks for narrated audio. You cannot scroll faster than Ashley's voice.
- **WCAG 2.2.2 (Pause, Stop, Hide):** Any auto-advancing content MUST provide a pause mechanism. Play/pause button satisfies this. Non-negotiable.
- **NNG User Control heuristic:** Control means play/pause, skip, jump, replay — not "click permission to proceed." The viewer controls *whether* the story moves, not *that* it moves.

## Consequences

**What becomes easier:**

- Immersion — narration carries the viewer, no dead zones
- Pause semantics — one boolean, one writer (`togglePause`), clean state
- WCAG compliance — play/pause button required, which is cleaner than no auto-advance at all

**What becomes harder:**

- Paused navigation has no visual transition (hard cut) — acceptable because viewer is navigating, not experiencing
- Timer management — `advanceTimer`, `holdStartTime`, `holdRemaining` must be tracked for pause/resume precision
- Narration 'end' event wiring — must guard against stale events from killed narration with frame index check

**What to revisit:**

- `holdAfterNarration` values are starting points — tune after narration audio is finalized
- Replay-while-paused behavior (auto-un-pause vs. cue-and-wait) — test both, pick what feels right
- If narration 'end' event fires during rapid 3→5→3 navigation, stale guard (`idx === currentFrame`) is necessary but may need a generation counter for robustness

## Schema Changes

**Removed:** `advanceMode` key

**Added:**

```jsonc
{
  "holdAfterNarration": 2000  // ms after narration ends before auto-advance
}
```

Credits auto-advance is suppressed by `shouldAutoAdvance()` checking `currentIndex < frames.length - 1` — no schema field needed.

## State Changes

**Old (v3):** 2 variables — `currentFrame`, `transitioning`

**New:** 4 variables — `currentFrame`, `transitioning`, `paused`, `advanceTimer`

## New Controls

Play/Pause button added to unified control bar. WCAG 2.2.2 compliance. Icon swaps on state change.
