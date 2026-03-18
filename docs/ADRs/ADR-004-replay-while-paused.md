# ADR-004: Replay-While-Paused Behavior

**Status:** Accepted
**Date:** March 18, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Resolves:** ADR-002 open item: "Replay-while-paused behavior (auto-un-pause vs. cue-and-wait) — test both, pick what feels right"
**Affects:** v5 §5 (replayNarration), §12 (edge cases)

## Context

ADR-002 established narration-driven auto-advance and deferred the replay-while-paused behavior as an open question. The implementation shipped with auto-resume (Option A below), but testing revealed a UX problem: replay silently clears the user's pause state AND re-arms auto-advance. A viewer who paused to study an image, then tapped replay to re-hear the narration, finds themselves carried to the next scene after narration ends — a control action (pause) was overridden by a content action (replay).

The core tension: replay is a content intent ("play this again"). Pause is a control intent ("stop everything"). When the user expresses both simultaneously, which intent wins?

Three patterns exist in comparable media:

- **Podcast/audiobook apps:** Replay (rewind 15s) auto-resumes regardless of pause. Replay IS play. But podcasts have no auto-advance — there's no "next episode starts in 5s" behavior to worry about.
- **E-learning tools (Articulate Storyline):** Replay while paused stays paused with content cued. Two-step: replay → play. Prioritizes control. But e-learning is utilitarian — friction is acceptable.
- **Museum audioguides:** Press the button, hear the narration, stay in front of the painting. No auto-advance to the next exhibit. Content plays immediately, but nothing happens when it ends.

## Options Considered

### Option A: Auto-Resume + Replay (current implementation)

Replay clears pause, plays narration + text from the top, re-arms auto-advance.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — already implemented |
| Feedback | Immediate — audio plays |
| Control preservation | None — pause state lost, auto-advance re-armed |
| Surprise risk | High — scene changes unexpectedly after narration ends |

**Pros:** Instant audio feedback. One tap to hear content. Simple mental model.

**Cons:** User's pause intent silently overridden. Auto-advance re-arms without consent. Accidental replay while paused = runaway scene progression. No undo back to paused state.

### Option B: Stay Paused + Hard Jump Reset

Replay while paused treats the action like paused navigation — a hard jump that resets the scene content to its initial state without unpausing. Narration is cued (loaded, not playing). Text timeline is rebuilt (paused at time 0). The scene is ready to play from the top when the user presses play. No transition animation.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — reuses existing cueOnly + hardCut patterns, one resume-path flag |
| Feedback | Visual — text elements reset to initial state. No audio. |
| Control preservation | Full — pause state untouched, no auto-advance |
| Surprise risk | None — nothing moves until user presses play |

**Pros:** Pause is inviolable — replay cannot override it. Consistent with hardCut pattern already used for paused navigation. No edge cases around auto-advance suppression. Simple mental model: while paused, everything is a hard jump. User presses play when ready.

**Cons:** No audio feedback on tap — user must press play to hear the replay. Two-step interaction. Text elements reset visually (opacity 0 at time 0) which may look like "nothing happened" unless the user was watching the text.

### Option C: Auto-Resume + Replay, Suppress Auto-Advance

Replay clears pause and plays narration + text immediately, but does NOT schedule auto-advance. Scene plays its content and holds.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low-Medium — new `replayFromPause` flag, guard in onend callback |
| Feedback | Immediate — audio plays |
| Control preservation | Partial — pause cleared, but no scene change |
| Surprise risk | Low — scene holds, but pause state is technically lost |

**Pros:** Instant audio feedback. No surprise scene advancement. Museum audioguide model.

**Cons:** Pause state technically lost (now playing). New state flag (`replayFromPause`) that must be cleared on navigation and resume. Partial control preservation — user didn't ask to unpause, but they're now unpaused.

## Decision

**Option B: Stay Paused + Hard Jump Reset.**

When replay is triggered from a paused state:

1. Pause state is preserved — `app.paused` remains `true`, `app.state` remains `PAUSED`
2. Stop current narration audio (`stopNarration()`)
3. Clear narration timer (if delayed narration was pending)
4. Cue narration audio (loaded, seeked to 0, not playing) via `cueNarration()`
5. Rebuild text timeline (paused at time 0) — text elements exist in DOM at initial opacity
6. Clear and rebuild caption entries
7. Set `replayPending = true` — signals `doResume()` to schedule fresh narration instead of resuming a paused Howl
8. No auto-advance timer. No state change. No transition.
9. When user presses play → `doResume()` sees `replayPending`, calls `scheduleNarrationAudio()` (which wires `onend` for auto-advance), plays text from 0, sets up auto-advance

This is the same pattern as paused navigation via dot bar (hardCut) — the scene resets to its starting state and waits for the user to press play. Replay while paused IS a hard jump to the same scene.

### Why Option B over Option A

Option A is the current implementation and the specific bug. It overrides the user's pause intent and re-arms auto-advance. This was identified as a P0 issue: the code doesn't match any accepted ADR behavior.

### Why Option B over Option C

Option C is clever but introduces unnecessary complexity. It requires a new state flag (`replayFromPause`), guards in the `onend` callback, and flag cleanup on navigation and resume. It also puts the experience in an ambiguous state — technically playing but without auto-advance, which is a mode that doesn't exist anywhere else in the state machine.

Option B reuses the existing `cueOnly` pattern that hardCut already uses for paused navigation, with one lightweight addition: `replayPending`, a resume-path hint that tells `doResume()` to schedule fresh narration (with `onend` wired for auto-advance) instead of resuming a paused Howl. This is simpler than Option C's `replayFromPause` because it doesn't change runtime behavior — it only affects the resume path. While paused, everything is a hard jump — navigation, replay, all of it. One rule, no exceptions.

The "no audio feedback" concern from Option B is real but acceptable in this context. The user explicitly paused. They know the experience is frozen. Tapping replay while paused is a setup action ("get ready to replay") not a playback action ("play now"). The play button is right there. One tap away.

## Consequences

**What becomes easier:**

- One lightweight flag (`replayPending`) — a resume-path hint, not a runtime behavior modifier
- Replay-while-paused follows the same rule as navigate-while-paused: hard jump, stay frozen
- No edge cases around auto-advance suppression — `replayPending` is cleared on navigation (`cleanupCurrentScene`) and on resume (`doResume`)
- Testing is straightforward: assert state is still PAUSED after replay

**What becomes harder:**

- User gets no audio feedback on replay tap while paused — must press play
- If the scene had no visible text changes (e.g., Scene 8 with two short lines), the visual feedback of "replay worked" is subtle

**What to revisit:**

- If user testing shows people are confused by the silent replay, consider adding a brief visual indicator (e.g., replay icon pulse) to confirm the tap registered

## Implementation

In `replayNarration()`:

```
replayNarration(app):
  if TRANSITIONING or LOADING: return

  userHasInteracted = true

  if paused:
    // Hard jump reset — same pattern as paused navigation
    stopNarration()
    clear narration timer

    clearAutoAdvance()
    autoAdvanceTimerRemaining = null

    frame = frames[currentIndex]

    cueOnly = true
    buildNarration(app, frame)      // cues audio, builds timeline (paused)
    cueOnly = false

    replayPending = true            // doResume will schedule fresh narration
    if textTimeline: textTimeline.pause(0)   // reset to start, stay paused

    // Stay paused. No state change. User presses play to hear.
    return

  // --- Playing path (unchanged) ---
  clearAutoAdvance()
  clear narration timer
  buildNarration(app, frame)        // plays audio immediately
  if textTimeline: textTimeline.play(0)
  setupAutoAdvance(app)
  run entry effect
```

## Edge Cases

```
CASE                                │ BEHAVIOR
────────────────────────────────────┼──────────────────────────────
Replay while playing                │ Unchanged — restart narration + text,
                                    │ clear timer, 'end' re-arms auto-advance
Replay while paused                 │ Hard jump reset. Narration cued, text
                                    │ timeline at 0, paused. Press play to hear.
Replay while paused, then play      │ doResume() sees replayPending, calls
                                    │ scheduleNarrationAudio() (wires onend),
                                    │ plays text from 0, sets up auto-advance.
Replay while paused, then navigate  │ Normal hardCut to new scene. replayPending
                                    │ cleared by cleanupCurrentScene.
Replay while paused on Scene 8      │ Text reset to start. No audio to cue.
                                    │ holdUntilClick prevents auto-advance anyway.
Replay while paused on credits      │ Narration cued, text reset. No advance
                                    │ possible (holdUntilClick: null).
Multiple replays while paused       │ Each replay re-cues from top. replayPending
                                    │ stays true. Idempotent. No leaked timers.
```

## Schema Changes

None. This is a behavioral change in `app.js` only.

## State Changes

One addition: `replayPending` (boolean, default `false`). Set in `replayNarration()` when paused, checked in `doResume()` to schedule fresh narration with `onend` callback instead of resuming a paused Howl. Cleared on resume and on navigation (`cleanupCurrentScene`). This is a resume-path hint, not a runtime behavior modifier — it does not affect any code path while the app is paused or playing.
