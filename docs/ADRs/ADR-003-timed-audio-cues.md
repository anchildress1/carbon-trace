# ADR-003: Audio Timeline System

**Status:** Accepted
**Date:** March 17, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Affects:** v4 §3 (audio.js contract), §4.1 (schema), §12 (edge cases)

## Context

The v4 spec treats audio as two fixed slots per scene — `ambient` and `narration` — that start at scene entry. This is wrong in two ways:

1. Audio needs to fade in and out at specific times relative to scene entry, not just "start when scene loads."
2. Scene 11 has narration AND an end song. The song fades in under the tail end of narration, then continues after narration ends. This requires one audio cue to anchor its timing to another cue's playback position.

The slot-based model can't express "start this track 5 seconds before that other track ends." It also can't express "fade this ambient out at 15 seconds" without bolting on fields that turn the simple config object into a timeline pretending to be a flat struct.

## Decision

Replace `ambient` and `narration` config slots with a unified `audioCues` array per frame. Each cue is a typed object with explicit timing, volume, fade parameters, and optional anchoring to other cues.

### Schema

```jsonc
"audioCues": [
  {
    "id": "narration",
    "src": "assets/audio/narration/01-seam.m4a",
    "type": "narration",
    "enter": 500,
    "volume": 1.0,
    "loop": false,
    "fadeIn": 0,
    "fadeOut": 0
  },
  {
    "id": "ambient-01",
    "src": "assets/audio/ambient/01-seam.m4a",
    "type": "ambient",
    "enter": 0,
    "volume": 0.15,
    "loop": true,
    "fadeIn": 1000,
    "fadeOut": null
  }
]
```

**Fields:**

- `id`: unique identifier within the frame (referenced by anchoring)
- `src`: asset path
- `type`: `"narration"` | `"ambient"` | `"sfx"` — determines behavior:
  - `narration`: fires 'end' event for auto-advance. One per frame max. Replay button targets this.
  - `ambient`: crossfades on scene transition. Can overlap with narration.
  - `sfx`: one-shot, no crossfade, no replay.
- `enter`: ms after scene entry to begin playback. OR an anchor object (see below).
- `volume`: target volume (0.0–1.0)
- `loop`: boolean
- `fadeIn`: ms fade-in duration from 0 to target volume at start
- `fadeOut`: ms fade-out duration at end. `null` = no auto-fade-out (ambient crossfades on scene exit instead).

**Anchoring (enter as object):**

```jsonc
{
  "id": "end-song",
  "src": "assets/audio/sfx/end-song.m4a",
  "type": "ambient",
  "enter": { "ref": "narration", "offset": -5000 },
  "volume": 0.6,
  "loop": false,
  "fadeIn": 3000,
  "fadeOut": null
}
```

`enter.ref`: id of another cue in the same frame.
`enter.offset`: ms relative to that cue's end. Negative = before end. Positive = after end.

This computes to: `triggerTime = cueRefDuration + cueRefEnter + offset`. Requires duration metadata from Howler preload.

**null audioCues:** `"audioCues": null` = no audio for this frame (same as current `ambient: null, narration: null`).

**Empty array:** `"audioCues": []` = explicit silence.

### Scene 11 example

```jsonc
{
  "id": "scene-11-music",
  "audioCues": [
    {
      "id": "narration",
      "src": "assets/audio/narration/11-music.m4a",
      "type": "narration",
      "enter": 500,
      "volume": 1.0,
      "loop": false,
      "fadeIn": 0,
      "fadeOut": 0
    },
    {
      "id": "end-song",
      "src": "assets/audio/sfx/end-song.m4a",
      "type": "ambient",
      "enter": { "ref": "narration", "offset": -5000 },
      "volume": 0.6,
      "loop": false,
      "fadeIn": 3000,
      "fadeOut": null
    }
  ]
}
```

Song begins fading in 5s before narration ends. 3s fade. Both play simultaneously during overlap. After narration ends, song continues at 0.6 volume. Terminal frame.

### Scene with delayed ambient

```jsonc
{
  "id": "scene-03-reach",
  "audioCues": [
    {
      "id": "narration",
      "src": "assets/audio/narration/03-reach.m4a",
      "type": "narration",
      "enter": 500,
      "volume": 1.0,
      "loop": false,
      "fadeIn": 0,
      "fadeOut": 0
    },
    {
      "id": "ambient-03",
      "src": "assets/audio/ambient/03-reach.m4a",
      "type": "ambient",
      "enter": 2000,
      "volume": 0.12,
      "loop": true,
      "fadeIn": 1500,
      "fadeOut": null
    }
  ]
}
```

### Scene with no audio (Scene 8)

```jsonc
{
  "id": "scene-08-empty",
  "audioCues": null
}
```

### audio.js contract change

```
// Old
crossfadeAudio(fromConfig, toConfig, ms)
playNarration(config)
stopNarration()
cueNarration(config)

// New
scheduleAudioCues(cues, narrationDurations)  → schedule all cues for a frame
cancelAudioCues()                            → clear all pending timers + stop all cues
pauseAudioCues()                             → freeze all active/pending cues
resumeAudioCues()                            → resume from pause point
crossfadeAmbient(fromCues, toCues, ms)       → fade out old ambient cues, schedule new
cueAllAudio(cues)                            → load + seek to 0, do NOT play (for hardCut)
getNarrationCue()                            → returns active narration Howl (for replay)
setMuted(bool)
```

`scheduleAudioCues` resolves anchor references at schedule time using preloaded duration metadata. If an anchor's duration is unknown, falls back to `enter: 0`.

Narration 'end' event still fires for auto-advance. `scheduleAudioCues` identifies the `type: "narration"` cue and wires `onNarrationEnd`.

## Options Considered

### Option A: Timed cue fields on existing ambient/narration slots

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Schema impact | Additive — optional fields with defaults |
| Consistency | Poor — `fadeIn` means different things on ambient vs narration |

**Pros:** No new config structure.

**Cons:** Optional fields with defaults violate the "every frame same shape" rule. `fadeIn` naming collision between ambient (timestamp) and narration (duration). `fadeInBeforeNarrationEnd` creates cross-slot dependency — ambient config needs to know about narration. `fadeIn: null` as sentinel for "use the other field" is implicit logic disguised as data. Gets worse with every new timing requirement.

### Option B: Unified audioCues array (ACCEPTED)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — new scheduling logic, anchor resolution |
| Schema impact | Structural — replaces ambient + narration slots |
| Consistency | High — one model for all audio, same pattern as ghost-drift text |

**Pros:** One mental model. No naming collisions. Anchoring handles Scene 11 declaratively. Extensible — adding SFX is just another cue in the array. No implicit behavior. Every cue is explicit.

**Cons:** More infrastructure. Anchor resolution requires duration metadata at schedule time. Breaking change to schema — every frame's audio config must be rewritten.

### Option C: Enter/exit model matching ghost-drift text

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Schema impact | Breaking |
| Consistency | High for one-shots, poor for crossfading ambient |

**Pros:** Perfect text/audio symmetry.

**Cons:** Ambient crossfade between scenes doesn't map to enter/exit — ambient is a continuous layer, not a one-shot. "Exit" conflicts with crossfade logic.

## Trade-off Analysis

Option B is more infrastructure than A, but A's "just add fields" approach produces a config that lies about its complexity. Every new timing requirement bolts on another field with another implicit interaction. B's cost is upfront and bounded — the cue array is the model, and it handles everything from "ambient starts at 0" to "song fades in 5s before narration ends" with the same structure.

The breaking schema change is acceptable because no production config exists yet.

## Consequences

- `ambient` and `narration` keys removed from frame schema, replaced by `audioCues`
- audio.js rewritten around cue scheduling instead of slot-based playback
- loader.js audio metadata preloading is load-bearing for anchor resolution
- Anchor resolution failure degrades to `enter: 0` (immediate playback)
- `type: "narration"` cue drives auto-advance — one per frame max
- Replay button targets the `type: "narration"` cue
- crossfade on scene transition only applies to `type: "ambient"` cues
- Pause freezes all cue timers + active Howls. Resume reschedules remaining.
- hardCut cancels all cue timers, calls `cueAllAudio` (loaded, not playing)

## Action Items

1. [x] Replace `ambient` + `narration` slots with `audioCues` array in schema
2. [x] Rewrite audio.js around cue scheduling
3. [x] Implement anchor resolution with duration metadata
4. [x] Update all 12 frame configs in scenes.json
5. [x] Update app.js: buildAndRunTimeline, hardCut, togglePause to use new audio API
6. [x] Update v4 spec (superseded by v5)
