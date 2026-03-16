# Audio System

## Narration Pipeline

1. **Preload** — `preloadAudio()` uses `new Audio()` with `canplaythrough` event and 5s timeout
2. **Schedule** — `scheduleNarrationAudio()` respects `narration.delay` (ms)
3. **Play** — `playNarration()` creates a Howl (`html5: true`), unloads any previous narration
4. **End** — Optional `onend` callback for post-playback actions

The app starts in a fully paused state. Audio, captions, and the text timeline all wait for the user to press play. The first frame's audio is preloaded immediately (alongside the first image) so it is ready when the user presses play. Remaining audio is deferred 4 seconds to avoid network contention. On first play, everything starts from t=0 in sync. The paused state itself is the autoplay gate — no separate `userHasInteracted` check is needed.

## Ambient Crossfade

When transitioning between scenes with ambient audio:

1. Create new Howl at volume 0
2. Play and fade from 0 → target volume over `durationMs`
3. Old ambient fades from current volume → 0 over same duration
4. Old ambient unloaded after fade + 100ms buffer

Currently all ambient refs are `null` (ambient directory is empty).

## Pause/Resume

### Audio

- `pauseNarration()` / `resumeNarration()` — Howl pause/play
- `pauseAmbient()` / `resumeAmbient()` — Howl pause/play

### Timers

Timer pause uses elapsed-time tracking:

```
On pause:
  elapsed = Date.now() - timerStart
  remaining = delay - elapsed
  clearTimeout(timer)

On resume:
  timer = setTimeout(callback, remaining)
```

Applied to both `narrationTimer` and `phaseTimer`.

### GSAP

- Text timeline: `app.textTimeline.pause()` / `.resume()`
- Effects: `gsap.getTweensOf(effectsLayer)` + children, each `.pause()` / `.resume()`

### Captions

Caption pause records total elapsed time, clears all timers. Resume re-schedules remaining captions from the current offset using `scheduleCaptionsFromOffset()`.

Toggling captions on/off while paused only updates the preference — captions are not shown until playback resumes. On resume, if captions are enabled they resume from the paused offset; if disabled, any running captions are cleared.

Toggling captions **on** mid-narration reads the current GSAP timeline time (`app.textTimeline.time()`) and passes it as `offsetMs` to `showCaptions()`, so captions start in sync with the current audio/text playback position rather than from t=0.

## Replay Flow

1. If paused → clear pause state
2. Cancel `narrationTimer`
3. `clearNarrationLayer()` — kill GSAP tweens, remove text elements
4. `clearCaptions()` — cancel timers, remove caption DOM
5. Rebuild text timeline from `frame.narration.lines[]`
6. Re-show captions from `frame.narration.captions[]`
7. Re-play narration audio (unloads previous Howl)
8. Re-trigger entry effect

## Navigation Interrupt Flow

When user navigates away from a scene mid-narration:

1. If paused → clear pause state, resume audio (so it can be properly stopped)
2. Cancel `narrationTimer` and `phaseTimer`
3. `clearCaptions()` — cancel all pending caption timers
4. Set `app.textTimeline = null`
5. If target scene has no narration audio → `stopNarration()` (unload without new play)
6. `transition()` → GSAP fade → `showFrame()` sets up new scene

## Error Handling

- Audio preload: 5s timeout, resolves `null` on failure (scene plays without audio)
- Howl `onloaderror`: logs warning, nullifies reference if still current
- Howl `onplayerror`: logs warning (does not nullify — may retry)
- Missing audio files: scene functions normally without audio

## Scene-08: Text Only

Scene-08-stillness has no narration audio file. Overlay text displays with ghost-drift animation. Caption shows `[silence]`. No audio is played or scheduled.
