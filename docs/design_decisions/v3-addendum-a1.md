# carbon-trace — System Design v3 Addendum A1

**Supersedes:** Specific sections of `carbon-trace-system-design-v3-final.md` as noted below
**Date:** March 17, 2026
**Author:** Ashley Childress (@anchildress1)
**Decision:** Replace click-to-advance with narration-driven auto-advance

---

## A1.1 Decision Record

### Problem

The v3 design specified click-to-advance as the primary interaction model (§5.3, §5.8). During implementation, this created two conflicts:

**Conflict 1 — Dead zone.** Scenes auto-play their content (narration, ghost-drift text, effects) but do NOT auto-advance. The viewer hears narration end, watches text drift away, then stares at a static image until they realize they need to click. That dead zone between "scene done" and "viewer clicks" is where immersion dies.

**Conflict 2 — Pause state vs. transitions.** When paused and jumping via dot bar, the transition needs to un-pause temporarily for GSAP animation to run, but the new scene then lands playing — overriding the user's pause intent. Any solution that temporarily un-pauses for animation is just the wasPaused pattern wearing different clothes. The actual fix: if paused, don't transition. Hard cut.

The root cause is architectural: click-to-advance is the wrong primary input for narrated, paced, authored content. The narration IS the pacing clock. The click was fighting it.

### Options Evaluated

```
OPTION                            │ VERDICT   │ REASON
──────────────────────────────────┼───────────┼──────────────────────────────────────
1. Narration-driven auto-advance  │ ACCEPTED  │ Narration is the experience.
   + click as skip/override       │           │ Let it drive the experience.
   + hard cut when paused         │           │ Paused = no transition. No
                                  │           │ temporary un-pause. Ever.
──────────────────────────────────┼───────────┼──────────────────────────────────────
2. Click-to-advance + wasPaused   │ REJECTED  │ Patches symptom (pause state lost)
   memory across transitions      │           │ without resolving cause (click-to-
                                  │           │ advance doesn't serve narrated
                                  │           │ content). 12 mandatory clicks to
                                  │           │ experience a story = slideshow.
                                  │           │ wasPaused is a bandaid.
──────────────────────────────────┼───────────┼──────────────────────────────────────
3. Hybrid — per-scene advanceMode │ REJECTED  │ Two code paths in app.js for
   (narration OR click)           │           │ essentially the same result. Only
                                  │           │ title + Scene 6 need click-hold.
                                  │           │ Option 1 with holdUntilClick is
                                  │           │ simpler than a full mode system.
```

### UX Research Basis

- **NNG carousel research:** Auto-advancing content that users didn't ask for is disruptive — but carbon-trace is not a carousel. The viewer deliberately enters the experience. The narration is the content, not an interruption alongside other content.
- **Scrollytelling pattern:** Scroll-driven pacing works for reading-speed content but breaks for narrated audio. You cannot scroll faster than Ashley's voice. Narration duration is the natural pacing clock.
- **WCAG 2.2.2 (Pause, Stop, Hide):** Any auto-advancing content MUST provide a mechanism to pause. Play/pause button satisfies this requirement. Non-negotiable.
- **NNG User Control heuristic:** Users must feel in control. Control here means play/pause, skip forward/back, jump via dot bar, and replay — not "click permission to proceed." The viewer controls *whether* the story moves, not *that* it moves.
- **Immersive narrative research:** Interaction creates agency, but interaction doesn't have to mean "click to advance." It can mean "click to pause," "click to skip," "click to revisit." The story carries you; the controls let you steer.

### Decision

**Narration-driven auto-advance (Option 1).** Scenes auto-advance when narration completes plus a configurable hold time. Click/tap anywhere skips forward immediately. Play/pause controls the entire flow. Dot bar jumps work for random access. Specific scenes opt out of auto-advance via `holdUntilClick: true`.

**Hard rule on pause:** If paused, navigation is a hard cut — no crossfade, no GSAP transition, no temporary un-pause. Draw the new scene image, set up content, freeze everything. The viewer presses play to start the scene. This eliminates the entire class of pause-vs-transition state bugs.

---

## A1.2 Affected Sections

Changes are listed by v3 section number. Sections not listed are unchanged.

---

### Supersedes §1 — What This Is

**Old:** "An immersive, click-to-advance visual narrative..."

**New:** "An immersive, narration-paced visual narrative..."

Full replacement:

> An immersive, narration-paced visual narrative told from the awareness of a diamond trapped in a coal seam. 12 frames (title + 10 scenes + credits). Canvas 2D-rendered painterly art with GSAP-driven ghost-drift text in a DOM overlay, per-scene visual effects via pixel manipulation, ambient audio layers, recorded narration in Ashley's voice, and a circuit trace motif that becomes legible as the story progresses. Not a gallery — an empathy engine.

---

### Supersedes §4.1 — Frame Types

```
TYPE     │ BEHAVIOR
─────────┼─────────────────────────────────────────────────────
title    │ Static or slow-animated. Click/tap begins + unlocks
         │ audio. holdUntilClick: true.
─────────┼─────────────────────────────────────────────────────
scene    │ Narration-paced. Auto-advances after narration
         │ completes + holdAfterNarration delay. Click/tap
         │ skips forward. Play/pause controls flow.
         │ Ghost-drift text. Ambient audio. Effects.
         │ holdUntilClick overrides auto-advance per scene.
─────────┼─────────────────────────────────────────────────────
credits  │ Terminal. No advance. Music persists. Bio, RAI,
         │ links.
```

---

### Supersedes §4.2 — Schema (advanceMode + new keys)

The `advanceMode` key is replaced by two keys: `holdUntilClick` and `holdAfterNarration`.

**Removed key:**
- `advanceMode` — no longer exists. The advance model is global (narration-driven), not per-scene.

**New keys (all frames, same shape):**

```jsonc
{
  // replaces advanceMode: "click"
  // true = scene does NOT auto-advance. Viewer must click/tap.
  // false = scene auto-advances after narration + holdAfterNarration.
  // null on credits = advance disabled entirely (unchanged behavior).
  "holdUntilClick": false,

  // ms to hold on this scene AFTER narration audio ends
  // before auto-advancing. Ignored if holdUntilClick is true.
  // 0 = advance immediately when narration ends.
  // If narration.audio is null: holdAfterNarration is the
  // TOTAL scene duration before auto-advance (fallback timer).
  "holdAfterNarration": 2000
}
```

**Updated example frames:**

```jsonc
// Title frame — holdUntilClick, first click begins experience
{
  "id": "frame-00-title",
  "index": 0,
  "frameType": "title",
  "image": "assets/images/frame-00-title.webp",
  "holdUntilClick": true,
  "holdAfterNarration": null,
  "textMode": "static",
  "narration": null,
  "ambient": null,
  "effects": { "idle": null, "entry": null },
  "traceOverlay": null,
  "transition": { "type": "fade", "duration": 1500 }
}

// Scene 1 — narration-driven, auto-advances 2s after narration ends
{
  "id": "scene-01-buried",
  "index": 1,
  "frameType": "scene",
  "image": "assets/images/scene-01-buried.webp",
  "holdUntilClick": false,
  "holdAfterNarration": 2000,

  "textMode": "ghost-drift",
  "narration": {
    "lines": [
      { "text": "The world had already decided what everything was.", "enter": 500, "exit": 4000 },
      { "text": "Pressure was not a problem. Pressure was the address.", "enter": 2000, "exit": 6000 }
    ],
    "audio": "assets/audio/narration/scene-01-buried.mp3",
    "delay": 500
  },

  "ambient": {
    "src": "assets/audio/ambient/scene-01-buried.mp3",
    "volume": 0.15,
    "loop": true
  },

  "effects": { "idle": null, "entry": null },

  "transition": {
    "type": "zoom-in",
    "duration": 1200,
    "scale": { "from": 1.0, "to": 1.15 }
  },

  "traceOverlay": {
    "opacity": 0.05,
    "animation": "shimmer"
  }
}

// Scene 6 — holdUntilClick. Silence holds as long as the viewer needs.
{
  "id": "scene-06-stillness",
  "index": 6,
  "frameType": "scene",
  "image": "assets/images/scene-06-stillness.webp",
  "holdUntilClick": true,
  "holdAfterNarration": null,
  "textMode": "ghost-drift",
  "narration": {
    "lines": [
      { "text": "It is too silent.", "enter": 1000, "exit": 5000 }
    ],
    "audio": null,
    "delay": 0
  },
  "ambient": null,
  "effects": { "idle": null, "entry": null },
  "traceOverlay": { "opacity": 0.2, "animation": "tin-glow" },
  "transition": { "type": "fade", "duration": 1500 }
}

// Credits — terminal. advance disabled.
{
  "id": "frame-11-credits",
  "index": 11,
  "frameType": "credits",
  "image": "assets/images/frame-11-credits.webp",
  "holdUntilClick": null,
  "holdAfterNarration": null,
  "textMode": "static",
  "persistentVisualState": "machine-running",
  "narration": null,
  "ambient": { "src": "assets/audio/ambient/end-song.mp3", "volume": 0.6, "loop": false }
}
```

**Schema shape rule preserved:** Every frame has `holdUntilClick` and `holdAfterNarration`. Same keys, same types. `null` means "not applicable" (credits = no advance; holdUntilClick scene = no timer).

---

### Supersedes §5.3 — Orchestrator (app.js)

```
┌──────────────────────────────────────────────────────────────────┐
│                          NAVIGATOR                               │
│                                                                  │
│  state:                                                          │
│    currentFrame = 0           ← which frame is showing           │
│    transitioning = false      ← rate limiter (playing only)      │
│    paused = false             ← play/pause state                 │
│    advanceTimer = null        ← setTimeout ref for auto-advance  │
│                                                                  │
│  inputs (ALL resolve to one function):                           │
│    dot click      → navigate(currentFrame, clickedIndex)         │
│    forward btn    → navigate(currentFrame, currentFrame + 1)     │
│    back btn       → navigate(currentFrame, currentFrame - 1)     │
│    keyboard →     → navigate(currentFrame, currentFrame + 1)     │
│    keyboard ←     → navigate(currentFrame, currentFrame - 1)     │
│    click on stage → navigate(currentFrame, currentFrame + 1)     │
│    auto-advance   → navigate(currentFrame, currentFrame + 1)     │
│    play/pause btn → togglePause()                                │
│                                                                  │
│  navigate(from, to):                                             │
│    if (to === from) return            ← no-op                    │
│    if (to < 0 || to >= len) return    ← 404                      │
│    if (frames[from].holdUntilClick                               │
│        === null) return               ← credits = dead end       │
│    clearTimeout(advanceTimer)         ← cancel pending advance   │
│                                                                  │
│    if (paused):                                                  │
│      hardCut(from, to)               ← §5.3.1 below             │
│    else:                                                         │
│      if (transitioning) return       ← 429 (playing only)       │
│      transitioning = true            ← acquire lock              │
│      buildAndRunTimeline(from, to)   ← §5.3.2 below             │
│                                                                  │
│  LOCK RELEASED IN GSAP onComplete ONLY. NEVER BEFORE.            │
│  ADVANCE TIMER CLEARED ON EVERY navigate() CALL.                 │
│  TRANSITIONING LOCK ONLY EXISTS IN PLAYING STATE.                │
└──────────────────────────────────────────────────────────────────┘
```

**One function. Six callers.** (Added: auto-advance timer as sixth caller.)

---

#### §5.3.1 — hardCut(from, to) — paused navigation

```
hardCut(from, to):
  // NO transition. NO animation. NO temporary un-pause.
  // Synchronous scene swap. Immediate. Clean.

  kill active text timeline       ← hard-reset all line elements to opacity: 0
  kill active effects             ← stopEffect(cleanupFn)
  audio.stopAll()                 ← kill old scene narration + ambient immediately
  canvas.drawImage(toImg)         ← instant draw, no crossfade
  audio.cueNarration(toConfig)    ← load but do NOT play
  text.buildTimeline(toConfig)    ← build but do NOT start
  currentFrame = to               ← commit
  overlay.updateDotBar(to)        ← update UI

  // Scene is fully set up but frozen.
  // No advanceTimer scheduled (paused).
  // No transitioning lock needed (synchronous).
  // Viewer presses play to start the scene.
```

**Why no transitioning lock:** hardCut is synchronous — drawImage, update state, done. There is no async window where a second input could collide. The lock exists to prevent mid-animation conflicts. No animation = no lock.

**Why no fade:** A fade requires running GSAP or rAF, which means scene content starts playing during the animation. That IS the temporary-un-pause pattern — rejected. Hard cut is the only approach that keeps pause state clean. The visual cost (no smooth fade) is acceptable because the viewer is paused — they already interrupted the flow. They're navigating, not experiencing.

---

#### §5.3.2 — buildAndRunTimeline(from, to) — playing navigation

Unchanged from v3 §5.3 except: onComplete now calls `scheduleAdvance(to)` and checks `pendingPause`.

```
time ──────────────────────────────────────────────►

kill text tl   █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
text exit      ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
kill effects   █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
canvas xfade   ░░░░░████████████░░░░░░░░░░░░░░░░░░░  ← rAF-driven dissolve
audio xfade    ░░░░░████████████░░░░░░░░░░░░░░░░░░░  ← parallel with canvas
entry effect   ░░░░░░░░░░░░░████████░░░░░░░░░░░░░░░  ← canvas pixel effect
text enter     ░░░░░░░░░░░░░░░░░████████░░░░░░░░░░░  ← GSAP on DOM overlay
lock release   ░░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░░░░  ← onComplete
sched advance  ░░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░░░░  ← arm auto-advance timer
pending pause  ░░░░░░░░░░░░░░░░░░░░░░░░░█░░░░░░░░░  ← apply queued pause if any

total: ~1.2 - 1.8 seconds per transition
```

---

#### §5.3.3 — Auto-advance trigger

```
NEW — auto-advance trigger:
  narration 'end' event fires
    → if paused: do nothing (timer waits for un-pause)
    → if holdUntilClick: do nothing
    → else: advanceTimer = setTimeout(
        () => navigate(current, current + 1),
        frame.holdAfterNarration
      )

NEW — no-narration fallback:
  if frame.narration.audio is null AND !holdUntilClick:
    → advanceTimer = setTimeout(
        () => navigate(current, current + 1),
        frame.holdAfterNarration
      )
  This is the fallback timer for scenes without audio yet (v1).
```

---

#### §5.3.4 — togglePause()

```
togglePause():
  // If mid-transition, queue the pause for onComplete
  if (transitioning):
    pendingPause = true
    return

  paused = !paused
  if paused:
    clearTimeout(advanceTimer)       ← freeze advance timer
    saveHoldElapsed()                ← store how much hold time passed
    pauseNarration()                 ← freeze audio playback
    pauseTextTimeline()              ← freeze ghost-drift
    pauseEffects()                   ← freeze canvas rAF
    overlay.showPlayIcon()           ← swap to play icon
  else:
    resumeNarration()                ← resume audio from pause point
    resumeTextTimeline()             ← resume ghost-drift
    resumeEffects()                  ← resume canvas rAF
    overlay.showPauseIcon()          ← swap to pause icon
    rescheduleRemainingHold()        ← restart hold timer with remaining ms
    // if narration is still playing, advance timer arms via 'end' event
```

**Pause during transition:** If the viewer presses pause while a transition is mid-flight (transitioning = true), the pause is queued via `pendingPause = true`. The transition finishes, onComplete fires, then `togglePause()` is called. Rationale: killing a mid-flight GSAP timeline + rAF crossfade leaves canvas in a blended state. Let it finish. Transitions are 1.2-1.8s — short enough that queuing is fine.

---

#### §5.3.5 — scheduleAdvance / scheduleHoldTimer

```js
function scheduleAdvance(idx) {
  clearTimeout(advanceTimer);
  const frame = frames[idx];

  // credits: no advance
  if (frame.holdUntilClick === null) return;

  // holdUntilClick scenes: no auto-advance
  if (frame.holdUntilClick === true) return;

  // paused: don't schedule (will reschedule on un-pause)
  if (paused) return;

  // has narration audio: wait for 'end' event (wired at init)
  // the 'end' event handler calls scheduleHoldTimer()
  if (frame.narration?.audio) return;

  // no narration audio: use holdAfterNarration as total duration
  holdStartTime = Date.now();
  advanceTimer = setTimeout(
    () => navigate(idx, idx + 1),
    frame.holdAfterNarration ?? 5000
  );
}

function scheduleHoldTimer(idx) {
  // called by narration Howl 'end' event
  if (paused) return;
  if (idx !== currentFrame) return;   // stale event guard
  const frame = frames[idx];
  if (frame.holdUntilClick) return;

  holdStartTime = Date.now();
  advanceTimer = setTimeout(
    () => navigate(idx, idx + 1),
    frame.holdAfterNarration ?? 2000
  );
}
```

---

### Supersedes §5.8 — Input Handling

```
INPUT              │ DESKTOP              │ MOBILE             │ EFFECT
───────────────────┼──────────────────────┼────────────────────┼─────────────────────
Skip forward       │ Click on stage       │ Tap on stage       │ navigate(cur, cur+1)
Navigate to scene  │ Click dot            │ Tap dot            │ navigate(cur, dot)
Forward            │ Click ► / Arrow →    │ Tap ►              │ navigate(cur, cur+1)
Back               │ Click ◄ / Arrow ←    │ Tap ◄              │ navigate(cur, cur-1)
Play/Pause         │ Click ⏯ / Space      │ Tap ⏯              │ togglePause()
Replay narration   │ Click replay btn     │ Tap replay btn     │ replay current
Mute/unmute        │ Click mute btn       │ Tap mute btn       │ toggle all audio
Tab to controls    │ Tab                  │ —                  │ focus management
Auto-advance       │ (internal)           │ (internal)         │ navigate(cur, cur+1)
```

**Key change:** "Advance" is renamed "Skip forward." The primary advance mechanism is the auto-advance timer, not the click. Click on stage is now a skip — it interrupts the current scene and jumps ahead immediately.

All inputs → navigate(currentFrame, targetIndex) or togglePause().

**Lock behavior depends on pause state:**
- Playing: transitioning lock active during animation. Inputs rejected while locked.
- Paused: no lock. hardCut is synchronous. Rapid dot-clicking while paused works — each click instantly swaps the scene.

Credits: advance disabled (holdUntilClick === null).
holdUntilClick scenes: auto-advance disabled, click/tap still skips forward.

---

### Supersedes §6.2 — Functional Requirements (adds play/pause button)

```
ELEMENT          │ FUNCTION                        │ NOTES
─────────────────┼─────────────────────────────────┼────────────────────
Back button      │ navigate(current, current - 1)  │ Icon: chevron/arrow left
Forward button   │ navigate(current, current + 1)  │ Icon: chevron/arrow right
Dot bar          │ 12 dots, click any to jump       │ Active dot visually distinct
Play/Pause btn   │ togglePause()                   │ Icon: play / pause
                 │                                 │ Swaps icon on state change.
                 │                                 │ WCAG 2.2.2 compliance.
Replay button    │ Re-trigger current narration     │ Icon: replay/rotate
Mute button      │ Toggle all audio on/off         │ Icon: volume / volume-off
                 │                                 │ Swaps icon on state change
```

**Play/Pause is a new required control.** It joins the unified control bar alongside existing controls. Suggested bar order: back, dots, forward, play/pause, replay, mute. AI retains creative latitude on exact layout within the bar per §6.4.

---

### Appends to §12 — Trade-offs (new rows)

```
DECISION                        │ REJECTED              │ WHY THIS
────────────────────────────────┼───────────────────────┼──────────────────────
Narration-driven auto-advance   │ Click-to-advance      │ Narration is authored
over click-to-advance           │                       │ with specific timing.
                                │                       │ Click creates a dead
                                │                       │ zone after narration
                                │                       │ ends. Auto-advance
                                │                       │ lets the story carry
                                │                       │ the viewer. Click
                                │                       │ remains as skip.
                                │                       │ holdUntilClick for
                                │                       │ title + Scene 6.
────────────────────────────────┼───────────────────────┼──────────────────────
Hard cut when paused over       │ Fade transition with  │ Fade requires running
fade transition                 │ wasPaused memory      │ GSAP/rAF which means
                                │                       │ scene content starts
                                │                       │ playing during the
                                │                       │ animation. That IS the
                                │                       │ temporary-un-pause
                                │                       │ pattern — rejected.
                                │                       │ Hard cut is synchronous.
                                │                       │ No async state. No lock.
                                │                       │ Viewer is navigating,
                                │                       │ not experiencing.
────────────────────────────────┼───────────────────────┼──────────────────────
Play/pause as primary control   │ Pause state inferred  │ Pause = everything
over transition-state memory    │ from transitions      │ stops, including auto-
                                │                       │ advance timer. Simple
                                │                       │ global state. togglePause
                                │                       │ is the only writer.
```

---

### Supersedes §16 — Global Rules / The Constitution (STATE and DATA FLOW sections)

**STATE** (replaces existing):

```
STATE:
  ✓ four variables: currentFrame (int), transitioning (bool),
    paused (bool), advanceTimer (timeout ref)
  ✓ lock released ONLY in GSAP onComplete
  ✓ transitioning lock ONLY applies when playing — paused navigation
    uses hardCut (synchronous, no lock)
  ✓ advanceTimer cleared on EVERY navigate() call
  ✓ paused state survives navigation — navigate while paused =
    hard cut, lands paused, no timer scheduled
  ✓ togglePause() is the ONLY function that changes paused
  ✓ pause during transition is queued via pendingPause, applied
    in onComplete — transitions always finish cleanly
```

**DATA FLOW (v1)** (replaces existing):

```
DATA FLOW (v1):

  PLAYING — auto-advance path:
    narration ends
      → scheduleHoldTimer(currentFrame)
        → setTimeout(holdAfterNarration)
          → navigate(currentFrame, currentFrame + 1)
            → clearTimeout(advanceTimer)
            → [playing path] buildAndRunTimeline:
              → kill active text timeline + hard-reset elements
              → GSAP orchestration timeline:
                → canvas.crossfade(fromImg, toImg)
                → audio.crossfadeAudio(fromConfig, toConfig)
                → text.animateEnter(toConfig)
              → onComplete: commit state, update dots, release lock,
                scheduleAdvance(newFrame), check pendingPause

  PLAYING — user skip path:
    user click/tap/key
      → navigate(currentFrame, targetIndex)
        → [playing path] same as auto-advance above

  PAUSED — user navigation path:
    user click/tap/key/dot while paused
      → navigate(currentFrame, targetIndex)
        → clearTimeout(advanceTimer)
        → [paused path] hardCut:
          → kill text timeline, kill effects, stopAll audio
          → canvas.drawImage(toImg)          ← instant, no fade
          → audio.cueNarration(toConfig)     ← loaded, not playing
          → text.buildTimeline(toConfig)     ← built, not started
          → commit state, update dots
          → no lock, no timer, no animation
          → scene lands paused. Frozen. Ready.

  TOGGLE PAUSE:
    togglePause()
      → if transitioning: pendingPause = true, return
      → paused = true:
          clear advanceTimer, save hold elapsed,
          freeze audio + text + effects
      → paused = false:
          resume audio + text + effects,
          reschedule remaining hold or wait for narration 'end'
```

**DATA FLOW (v2 adds)** (unchanged):

```
  → effects.cleanup(fromConfig) before crossfade [playing path]
  → effects.cleanup(fromConfig) in hardCut [paused path — already listed]
  → effects.start(toConfig, ctx) after crossfade [playing path]
  → effects.start(toConfig, ctx) NOT called in hardCut [paused — frozen]
```

**NEVER** (appends to existing list):

```
  ✗ temporarily un-pausing for transitions — if paused, hard cut
  ✗ auto-advancing during pause
  ✗ losing pause state across navigation
  ✗ using transitioning lock during paused navigation (hardCut is synchronous)
  ✗ multiple advance mechanisms for the same scene (no both timer AND click-required)
  ✗ constructing advanceTimers without clearing the previous one first
  ✗ killing mid-flight GSAP timelines on pause (queue it, let transition finish)
```

---

## A1.3 holdUntilClick Scene Map

Which scenes use holdUntilClick and why:

```
FRAME                │ holdUntilClick │ holdAfterNarration │ WHY
─────────────────────┼────────────────┼────────────────────┼──────────────────────────
00 Title             │ true           │ null               │ First click begins +
                     │                │                    │ unlocks audio context
─────────────────────┼────────────────┼────────────────────┼──────────────────────────
01 Buried            │ false          │ 2000               │ Narration-paced
02 Moved             │ false          │ 2000               │ Narration-paced
03 Oven Threshold    │ false          │ 3000               │ Let heat linger (pacing)
04 Pocket            │ false          │ 2000               │ Narration-paced
05 Keeper            │ false          │ 2500               │ Narration-paced
─────────────────────┼────────────────┼────────────────────┼──────────────────────────
06 Stillness         │ true           │ null               │ Silence holds as long as
                     │                │                    │ the viewer needs. The
                     │                │                    │ click to continue is the
                     │                │                    │ viewer saying "I'm ready."
─────────────────────┼────────────────┼────────────────────┼──────────────────────────
07 Return            │ false          │ 2000               │ Narration-paced
08 Device            │ false          │ 2000               │ Brief narration, image works
09 Activation        │ false          │ 3000               │ Let the payoff breathe
10 Gathering         │ false          │ 3000               │ Final scene, last line lingers
─────────────────────┼────────────────┼────────────────────┼──────────────────────────
11 Credits           │ null           │ null               │ Terminal. No advance.
                     │                │                    │ Machine runs. Story is over.
```

holdAfterNarration values are starting points. Tune after narration audio is finalized.

---

## A1.4 Edge Cases

```
CASE                                │ BEHAVIOR
────────────────────────────────────┼──────────────────────────────────────
User mutes audio                    │ Narration Howl still fires 'end'
                                    │ event at correct time. Mute affects
                                    │ volume, not playback. Auto-advance
                                    │ still works. No change needed.
────────────────────────────────────┼──────────────────────────────────────
Narration audio not yet recorded    │ narration.audio = null. Fallback:
(v1 asset gap)                      │ holdAfterNarration used as total
                                    │ scene duration. Default 5000ms if
                                    │ null/missing. Scene still flows.
────────────────────────────────────┼──────────────────────────────────────
User skips mid-narration (playing)  │ navigate() clears advanceTimer,
                                    │ enters playing path. Crossfade runs.
                                    │ Old scene narration fades out.
                                    │ New scene starts fresh. Clean.
────────────────────────────────────┼──────────────────────────────────────
User skips backward (playing)       │ Same as forward skip. navigate()
                                    │ handles all directions identically.
                                    │ Previous scene replays from start.
────────────────────────────────────┼──────────────────────────────────────
User clicks during transition       │ Rejected (transitioning = true).
(playing)                           │ Same as v3. No change.
────────────────────────────────────┼──────────────────────────────────────
User navigates while paused         │ hardCut. Instant scene swap. No
(any input — dot, skip, fwd, back)  │ fade. No animation. No lock.
                                    │ Lands paused on new scene. All
                                    │ content set up but frozen. Viewer
                                    │ presses play to start. Rapid
                                    │ dot-clicking works — each click
                                    │ immediately swaps the scene.
────────────────────────────────────┼──────────────────────────────────────
User pauses while playing           │ togglePause(). Everything freezes:
(not mid-transition)                │ narration, text, effects, advance
                                    │ timer. Hold elapsed time saved.
                                    │ Un-pause resumes from exact point.
────────────────────────────────────┼──────────────────────────────────────
User pauses during transition       │ pendingPause = true. Transition
(playing, mid-animation)            │ finishes normally. onComplete fires.
                                    │ togglePause() called after lock
                                    │ release. Scene lands then freezes.
                                    │ Rationale: killing mid-flight GSAP
                                    │ + rAF crossfade leaves canvas in a
                                    │ blended state. Let it finish.
                                    │ 1.2-1.8s — short enough to queue.
────────────────────────────────────┼──────────────────────────────────────
User pauses, waits, un-pauses       │ Narration resumes from pause point
                                    │ (Howler handles this). When narration
                                    │ ends, 'end' event fires, hold timer
                                    │ starts. Normal flow resumes.
────────────────────────────────────┼──────────────────────────────────────
User pauses during holdAfterNarr    │ clearTimeout(advanceTimer). Save
                                    │ elapsed hold time. On un-pause:
                                    │ reschedule remaining ms.
                                    │ Implementation: save holdStartTime
                                    │ on timer set, compute remaining =
                                    │ total - (now - start).
────────────────────────────────────┼──────────────────────────────────────
Scene 6 (holdUntilClick) + paused   │ No conflict. holdUntilClick already
                                    │ means no timer. Pause just freezes
                                    │ effects/text. Un-pause resumes
                                    │ effects/text but still no timer.
                                    │ Click/skip advances to Scene 7
                                    │ via hardCut (still paused).
────────────────────────────────────┼──────────────────────────────────────
Scene 6 (holdUntilClick) + playing  │ No timer. Scene plays its content
                                    │ (minimal text, ambient). Holds
                                    │ indefinitely. Click/skip advances
                                    │ to Scene 7 via playing path with
                                    │ full crossfade transition.
────────────────────────────────────┼──────────────────────────────────────
Credits reached via auto-advance    │ Scene 10 auto-advances → playing
                                    │ path transition to Scene 11.
                                    │ holdUntilClick = null.
                                    │ scheduleAdvance() returns. End song
                                    │ plays. Machine runs. Done.
────────────────────────────────────┼──────────────────────────────────────
Replay button while playing         │ Restart narration audio from 0.
                                    │ Clear advanceTimer (narration 'end'
                                    │ event will re-arm it). Ghost-drift
                                    │ text timeline restarts.
────────────────────────────────────┼──────────────────────────────────────
Replay button while paused          │ Restart narration + text timeline,
                                    │ then immediately pause them. Viewer
                                    │ presses play to hear the replay.
                                    │ (Or: replay auto-un-pauses. TBD —
                                    │ test both, pick what feels right.)
```

---

## A1.5 Implementation Notes

**Timer precision for pause/resume:**

```js
// On setting the hold timer:
holdStartTime = Date.now();
advanceTimer = setTimeout(
  () => navigate(currentFrame, currentFrame + 1),
  holdAfterNarration
);

// On pause (mid-hold):
clearTimeout(advanceTimer);
holdElapsed = Date.now() - holdStartTime;
holdRemaining = holdAfterNarration - holdElapsed;

// On un-pause:
if (holdRemaining > 0) {
  holdStartTime = Date.now();
  advanceTimer = setTimeout(
    () => navigate(currentFrame, currentFrame + 1),
    holdRemaining
  );
}
```

**Narration 'end' event wiring:**

Wire once at Howl construction time (init, not per-transition). The handler checks `currentFrame` to ensure it's still relevant (guards against stale events from killed narration).

```js
// In audio.js init, per narration Howl:
howl.on('end', () => {
  // app.js exposes a callback for this
  onNarrationEnd(frameIndex);
});
```

Navigator registers the callback. `onNarrationEnd` calls `scheduleHoldTimer(idx)` only if `idx === currentFrame` and `!paused`.

**hardCut and audio.cueNarration:**

audio.js needs a `cueNarration(config)` function that loads the Howl and seeks to 0 without playing. This is distinct from `playNarration(config)`. If Howl instances are pre-constructed at init (per v3 §5.5), cueNarration just resets the seek position. togglePause → resume then calls `howl.play()`.

**Pending pause in onComplete:**

```js
// In onComplete of buildAndRunTimeline:
transitioning = false;
currentFrame = to;
overlay.updateDotBar(to);
scheduleAdvance(to);
if (pendingPause) {
  pendingPause = false;
  togglePause();         // now safe — transition complete, lock released
}
```

---

## A1.6 What This Does NOT Change

- Canvas rendering (§5.4) — unchanged, except canvas.drawImage() is now also called directly by hardCut
- Audio module contract (§5.5) — adds cueNarration() (load/seek without play). Howler 'end' event already exists
- Ghost-drift text behavior (§4.4) — unchanged
- Effects placeholder (§5.7) — unchanged
- Circuit trace overlay (§4.5) — unchanged
- Responsive design (§8) — unchanged
- Deployment (§9) — unchanged
- Performance budget (§10) — unchanged
- Accessibility (§11) — unchanged except play/pause button adds WCAG 2.2.2 compliance
- v1/v2 boundary (§13) — unchanged, auto-advance is v1 scope
- Build order (§15) — play/pause + auto-advance timer + hardCut added to Phase 2 (Core Experience)
- Project structure (§3) — unchanged, no new files

---

## A1.7 Schema Shape Exceptions

The §4.3 rule "every frame has the SAME shape" applies to all standard keys. Two
frame types have intentional structural differences documented here:

**Title frame (`scene-00-title`):**
- Has no `image` key. The title card renders ghost-drift text over a dark field
  with no scene image. The canvas is intentionally blank.
- Code must guard `frame.image` before accessing image cache or drawing.

**Credits frame (`scene-11-music`):**
- Has a `music` key (object) for the credits song. No other frame type uses this key.
  Music scheduling is handled by `scheduleMusic()` in `app.js`, gated on `frame.music`.
- The `effects.entry` key is `null` — credits have an idle effect only.

All other keys (`holdUntilClick`, `holdAfterNarration`, `narration`, `ambient`,
`effects`, `transition`, `traceOverlay`) are present on every frame with consistent
types. `null` means "skip this feature."

---

## A1.8 Navigation While Paused — Clarification

When the user navigates while paused (via dot bar, forward/back buttons, keyboard,
or stage click), the app performs a hard cut and **remains paused** on the destination
scene. Navigation while paused does NOT un-pause.

This is the correct behavior because:
- The user explicitly paused. Navigation is steering, not resuming.
- Hard cut is synchronous — no animation means no temporary un-pause needed.
- The viewer presses play when ready to experience the destination scene.

Stage click/tap while paused advances to the next scene via hard cut and lands paused.
This differs from playing state where stage click triggers an animated transition.

---

*End of Addendum A1.*
