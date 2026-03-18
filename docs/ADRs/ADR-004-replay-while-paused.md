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

carbon-trace is closest to the audioguide model: an authored, paced experience where the viewer stands in front of each scene. The narration is the emotional content. Auto-advance is the convenience layer.

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

### Option B: Stay Paused + Cue Content (original spec intent)

Replay resets narration and text to start but does NOT unpause. Audio is loaded and seeked to 0 but not playing. Text timeline built but paused at 0. User presses play to hear replay.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — cueOnly path already exists |
| Feedback | None — silent. No visible change on screen |
| Control preservation | Full — pause state untouched |
| Surprise risk | None — nothing happens until user presses play |

**Pros:** Respects pause absolutely. No surprise scene changes. Clean separation of intent.

**Cons:** Zero feedback on tap — user thinks replay is broken. Two-step interaction (replay → play) adds friction in an art piece. All text elements are opacity: 0 after cue, so there's no visual confirmation. Breaks immersion by making the viewer manage playback state.

### Option C: Auto-Resume + Replay, Suppress Auto-Advance (recommended)

Replay clears pause and plays narration + text immediately, but does NOT schedule auto-advance. Scene plays its content and holds. User must manually advance, re-pause, or replay again.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low — remove one function call from replay path |
| Feedback | Immediate — audio plays |
| Control preservation | Partial — pause cleared, but no scene change |
| Surprise risk | None — scene holds after narration ends |

**Pros:** Instant audio feedback — one tap to hear content. No surprise scene advancement. User stays on current scene. Museum audioguide model: press button → hear content → you're still in front of the painting. Minimal code change.

**Cons:** User who replays while paused and expects auto-advance to resume must press play or forward. Pause state technically lost (now playing). Slight departure from both current code and original spec.

## Decision

**Option C: Auto-Resume + Replay, Suppress Auto-Advance.**

When replay is triggered from a paused state:

1. Clear pause state, resume ambient/music audio
2. Stop current narration, rebuild from top
3. Play narration audio + text timeline from 0
4. **Do NOT call `setupAutoAdvance()`**
5. When narration ends → scene holds (no timer, no advance)
6. User can: advance manually (forward button/arrow/dot), pause, or replay again

The narration `onend` callback checks a `replayFromPause` flag. If set, `onend` does not schedule auto-advance. The flag is cleared on the next normal navigation or resume.

### Why Option C over Option B

Option B is the "correct" answer from a state-purity perspective. But carbon-trace is an art piece, not a media player. The viewer tapping replay while paused is saying "I want to hear that again" — and hearing nothing in response is a broken experience. The emotional cost of a dead click outweighs the state-purity benefit.

Option C gives the user what they asked for (hear it again) without taking something they didn't offer (control of scene progression).

### Why Option C over Option A

Option A's auto-advance re-arm is the specific bug. The viewer paused for a reason — studying the image, reading text, taking a moment. Replay means "play this audio again," not "resume the conveyor belt." Suppressing auto-advance respects the implicit intent behind their pause while still delivering immediate content.

## Consequences

**What becomes easier:**

- Replay always produces audio — no "did I tap it?" confusion
- No surprise scene changes from replay
- Viewer stays in an exploratory mode — hear content, stay on scene

**What becomes harder:**

- Auto-advance doesn't re-arm after replay-from-pause — viewer must manually advance or press play. Acceptable because they explicitly paused.
- One additional flag (`replayFromPause`) in state. Cleared on next `transition()` or `doResume()`.

**What to revisit:**

- If user testing shows people expect auto-advance after replay, switch to Option A. The flag is the only difference.

## Implementation

In `replayNarration()`:

```
replayNarration(app):
  if TRANSITIONING or LOADING: return

  wasPaused = app.paused

  if paused:
    clear pause state
    resume ambient + music
    restore pausedFromState

  clear auto-advance timer
  clear narration timer
  rebuild narration (audio plays immediately)
  play text timeline from 0

  if wasPaused:
    // Suppress auto-advance — scene holds after narration ends
    // onNarrationEnd will check and skip scheduling
  else:
    setupAutoAdvance(app)
```

In `scheduleNarrationAudio()`:

```
const onend = () => {
  if (gen !== app.generation) return;
  if (app.replayFromPause) {
    app.replayFromPause = false;
    return;  // Scene holds — no auto-advance
  }
  if (shouldAutoAdvance(app, frame)) {
    scheduleAutoAdvance(app, holdAfterNarration);
  }
};
```

## Edge Cases

```
CASE                                │ BEHAVIOR
────────────────────────────────────┼──────────────────────────────
Replay while playing                │ Unchanged — restart narration + text,
                                    │ clear timer, 'end' re-arms auto-advance
Replay while paused                 │ Resume + play narration + text from 0.
                                    │ Auto-advance suppressed. Scene holds.
Replay while paused, then pause     │ Normal pause. Narration pauses mid-replay.
                                    │ Resume plays from pause point. Still no
                                    │ auto-advance (flag persists until navigate).
Replay while paused, then navigate  │ Normal transition. Flag cleared.
                                    │ New scene has normal auto-advance behavior.
Replay while paused on Scene 8      │ Scene 8 has no narration audio. Text replays.
                                    │ No auto-advance (holdUntilClick: true
                                    │ already prevents it).
Replay while paused on credits      │ Narration replays. No advance possible
                                    │ (holdUntilClick: null already prevents it).
Multiple replays while paused       │ Each replay restarts from top. Flag stays set.
                                    │ Scene never auto-advances until next navigate.
```

## Schema Changes

None. This is a behavioral change in `app.js` only.

## State Changes

**Added:** `replayFromPause` (boolean, default `false`). Set `true` when replay triggers from paused state. Cleared on next `transition()` or `doResume()`.
