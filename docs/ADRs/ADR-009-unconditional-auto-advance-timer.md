# ADR-009: Unconditional Auto-Advance Timer

**Status:** Accepted
**Date:** March 23, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Supersedes:** ADR-002 auto-advance timing mechanism (not its UX model)

## Context

ADR-002 established narration-driven auto-advance as the correct UX model.
The implementation used two distinct timing paths:

- **Non-narration scenes:** `setupAutoAdvance` sets a `PausableTimer` directly.
  This path always works.
- **Narration scenes:** `setupAutoAdvance` sets NO timer. It relies entirely on
  Howler's `'end'` event firing an `onNarrationEnd` callback, which then calls
  `scheduleAutoAdvance`. This path is fragile.

### Bug: race condition between `onNarrationEnd` and `landOnFrame`

The narration audio cue is scheduled in `showFrame()` (during the GSAP fade-out
completion), but the auto-advance setup happens in `landOnFrame()` (after the
GSAP fade-in). There is a ~600ms window between these two calls.

If Howler fires `loaderror`, `playerror`, or buffer-exhaustion during this
window, `onNarrationEnd` fires early and calls `scheduleAutoAdvance()` to set a
timer. Then `landOnFrame()` → `setupAutoAdvance()` → `clearAutoAdvance()`
cancels that timer. Narration has already ended. No mechanism remains to advance
the scene. The experience is permanently stuck.

### Bug: `doResume` dead-end for non-narration scenes

If the user pauses during a transition to Scene 08 (no narration), `landOnFrame`
calls `doPause()` instead of `setupAutoAdvance()`. The auto-advance timer is
never created. On resume, `autoAdvanceTimer?.resume()` is `null?.resume()` — a
no-op. Scene 08 is permanently stuck.

## Decision

Unify both paths into a single unconditional timer. `setupAutoAdvance` ALWAYS
sets a PausableTimer for every scene:

- **Non-narration:** `holdAfterNarration` (unchanged)
- **Narration:** `enterDelay + maxNarrationDurationMs + holdAfterNarration`

`onNarrationEnd` remains wired in `audio.js`. When narration ends normally, it
calls `scheduleAutoAdvance(holdAfterNarration)`, which replaces the long timer
with a short one. This is an optimization — not a requirement.

If `onNarrationEnd` never fires, the full-duration timer fires and advances the
scene. No event dependency. No race window.

`doResume` is updated to call `setupAutoAdvance(app)` when `autoAdvanceTimer`
is null, covering the pendingPause edge case.

## Consequences

**What becomes easier:**

- Auto-advance is guaranteed for all scenes — no event dependency
- Pause/resume works for all scenes without edge case logic
- No timing race between Howler events and GSAP callbacks

**What becomes harder:**

- If `maxNarrationDurationMs` is inaccurate (audioDurations not yet loaded),
  the fallback timer may be longer than needed. All narration scenes have
  caption data (Tier 2), so the floor value (60s) is never reached in practice.

**Unchanged from ADR-002:**

- Narration is still the pacing clock (onNarrationEnd shortens the timer)
- holdAfterNarration per-scene config
- Credits don't auto-advance (shouldAutoAdvance bounds check)
- Hard cut on paused navigation
- Play/pause controls and WCAG 2.2.2 compliance
