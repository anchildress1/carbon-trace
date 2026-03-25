# ADR-008: Audio-Reactive Effect Modulation

**Status:** Accepted
**Date:** March 22, 2026
**Deciders:** Ashley Childress (@anchildress1)
**Depends on:** ADR-007 (pixel scene animations — provides the effect regions and PixiJS ticker this ADR modulates)
**Affects:** audio.js (new export), effects-canvas.js (new method), app.js (bridge wiring), accessibility.md (reduced motion table)

## Context

Scene 11 is the climax — the diamond reveals itself while the end song plays. The scene already has glow and displacement effects (ADR-007), but they animate on fixed timers, disconnected from the music. The visual and audio narratives are telling the same story at the same time but not *together*.

The goal: make effect parameters respond to the music in real time. When the bass hits, the glow swells. When the music is quiet, the effects settle. Not a visualizer — not bars or waveforms. The existing scene effects just breathe with the audio.

### Why this needs its own ADR

1. **New cross-module dependency.** audio.js and effects-canvas.js are leaf modules with no cross-imports (v5 §3). Audio-reactive creates a data flow between them — FFT data from audio drives effect parameters. The bridge pattern (app.js wires them) preserves leaf isolation but needs explicit documentation.
2. **Web Audio API introduction.** Howler.js abstracts audio playback. This ADR reaches past that abstraction to access Howler's internal AudioContext and create an AnalyserNode. That's a new API surface with CORS constraints and html5-mode compatibility risks.
3. **Precedence rules.** Effect regions already have static parameters and optional pulse animation (pulseSpeed/pulseRange). audioReactive modulates the same parameters. The interaction needs a clear precedence rule to prevent conflicting animations.

### What this is NOT

- Not a music visualizer. No bars, no waveforms, no new visual elements.
- Not a new effect type. audioReactive is a modifier on existing effect regions (ADR-007).
- Not a change to the effect schema structure. It adds an optional key to existing region objects.

---

## Decision

**Frequency-band parameter modulation via Web Audio AnalyserNode, bridged through app.js.**

Each effect region can declare an optional `audioReactive` key that maps a frequency band (bass/mid/high) to an effect parameter, with a target range and smoothing factor. The PixiJS ticker reads FFT data once per frame and lerps the target parameter between range bounds based on the band's energy.

Additionally, `audioReactive` can include an optional `trigger` object for onset-triggered effects. When present, the system detects sudden energy spikes (beats/notes) and calls `effect.trigger()` to fire discrete animation cycles. Trigger and continuous modulation are composable — a single region can do both, e.g., fire a shockwave on each bass hit while modulating its amplitude to reflect hit intensity.

---

## How It Works

### Signal chain

carbon-trace uses Howler.js in `html5: true` mode exclusively. In html5 mode, `<audio>` elements output directly to the system audio device, bypassing the Web Audio graph entirely. `Howler.masterGain()` carries no signal from html5-mode sounds. To get FFT data, we route the target `<audio>` element through `createMediaElementSource()`, which re-enters the Web Audio graph:

```
end-song <audio> element (Howler html5:true)
  └─ createMediaElementSource(element)   ← takes ownership of element output
       └─ AnalyserNode (created by audio.js, fftSize: 2048)
            ├─ ctx.destination             ← audio still plays to speakers
            └─ getByteFrequencyData() → Uint8Array[1024]
                 └─ effects-canvas.js ticker reads per frame
```

**Why not `Howler.masterGain()`?** The original design assumed Web Audio mode routing. In html5 mode, `masterGain` is an orphan node with no input signal. `createMediaElementSource()` is the only way to tap an `<audio>` element's output into the Web Audio graph for analysis.

**`createMediaElementSource()` constraints:**
- Can only be called **once per `<audio>` element**. Calling it again on the same element throws `InvalidStateError`. The implementation tracks the connected element and skips reconnection.
- Takes **ownership** of the element's output — audio no longer goes directly to speakers. The `AnalyserNode.connect(ctx.destination)` call restores playback through the Web Audio graph.
- Has **CORS restrictions** — the audio file must be served from the same origin. carbon-trace serves all audio from same-origin (`/assets/audio/`), so this works.

### Per-frame modulation (inside PixiJS ticker)

```
FOR EACH region with audioReactive config:
  1. Read band energy from shared FFT data array
     - bass:  avg of bins 1–12   (~20–250 Hz)
     - mid:   avg of bins 12–93  (~250–2000 Hz)
     - high:  avg of bins 93–744 (~2000–16000 Hz)
  2. Normalize to 0–1 (divide by 255)
  3. Apply exponential moving average:
     smoothed = prev * smoothing + current * (1 - smoothing)
  4. Lerp target parameter:
     value = range[0] + smoothed * (range[1] - range[0])
  5. Set the parameter on the PixiJS filter
```

### Onset detection (trigger mode)

When `audioReactive.trigger` is present, the ticker additionally runs onset detection each frame using spectral flux against a running average:

```
FOR EACH region with audioReactive.trigger:
  1. Update running average:
     runningAvg = runningAvg * 0.95 + energy * 0.05
  2. Increment timeSinceLastTrigger by frame delta
  3. IF energy > runningAvg * threshold AND timeSinceLastTrigger > cooldown:
     a. Call effect.trigger() — resets the animation cycle (e.g., shockwave time=0)
     b. Reset timeSinceLastTrigger = 0
```

The running average decay (0.95) adapts to the music's overall energy level. The `threshold` multiplier means "trigger when current energy exceeds the running average by this factor." A threshold of 1.5 = "50% above average." The `cooldown` prevents rapid re-triggering within a minimum interval.

Trigger and continuous modulation run in the same frame. Continuous modulation sets the parameter value (e.g., amplitude), then trigger fires a new cycle if a beat is detected. Combined: each beat fires a shockwave whose intensity matches the hit strength.

### Shockwave `autoRepeat` and `trigger()`

The shockwave effect factory accepts an `autoRepeat` param (default `true`). When `false`, the wave plays once through `cycleDuration` then idles — it does not auto-repeat on a fixed timer. The `trigger()` method on the effect object resets the cycle timer to zero, starting a new wave expansion. This is the mechanism onset detection uses to fire discrete shockwaves on each detected beat.

### Module wiring (no cross-imports)

```
audio.js                    app.js                      effects-canvas.js
───────────                 ──────                      ─────────────────
getAnalyserNode() ────→  bridge in showFrame() ────→  setAnalyser(node)
connectAnalyserToCue()      (one-time call when              │
  ↳ on cue play:             audioReactive regions           ▼
    createMediaElement-      are present)              ticker reads FFT
    Source() → analyser                                each frame
```

app.js showFrame() wiring:
```js
if (frame.effects?.regions?.some(r => r.audioReactive)) {
  const analyser = audio.getAnalyserNode();
  if (analyser) {
    effectsCanvas.setAnalyser(analyser);
    audio.connectAnalyserToCue(frame.effects.analyserCueId);
  }
}
```

The `analyserCueId` field in the effects config identifies which audio cue should feed the AnalyserNode. For Scene 11, this is `"end-song"`. The connection happens inside `audio.js` when the matching cue starts playing — `app.js` only passes the cue ID, preserving leaf module isolation.

**No cross-imports between leaf modules.** audio.js doesn't know about effects. effects-canvas.js doesn't know about Howler. app.js is the only module that touches both.

---

## Schema

audioReactive is an optional key on any effect region (ADR-007 schema):

```jsonc
{
  "type": "glow",
  "mask": "assets/masks/11-diamond.png",
  "strength": 4,
  "quality": 4,
  "pulseSpeed": 0,          // ← disabled when audioReactive targets "strength"
  "pulseRange": [4, 4],     // ← ignored when audioReactive targets "strength"
  "audioReactive": {
    "band": "bass",          // "bass" | "mid" | "high"
    "target": "strength",    // effect parameter name to modulate
    "range": [2, 12],        // [min, max] output range
    "smoothing": 0.8         // EMA factor: 0 = instant, 0.95 = very slow
  }
}
```

With optional onset trigger (composable with continuous modulation above):

```jsonc
{
  "type": "shockwave",
  "mask": "assets/masks/11-shockwave.png",
  "autoRepeat": false,       // ← no fixed-timer cycling; trigger controls timing
  "cycleDuration": 0.4,      // ← fast expansion per beat
  "audioReactive": {
    "band": "bass",
    "target": "amplitude",   // continuous: modulate intensity per hit strength
    "range": [10, 30],
    "smoothing": 0.3,        // lower = more responsive to transients
    "trigger": {             // onset detection (optional)
      "threshold": 1.5,      // fire when energy > runningAvg * 1.5
      "cooldown": 0.08       // min 80ms between triggers (~12/sec max)
    }
  }
}
```

When `trigger` is present alongside `target`/`range`/`smoothing`, both behaviors run each frame. When `trigger` is present without `target`/`range`, only onset triggering runs (no continuous modulation).

### Precedence rule

**audioReactive overrides the target parameter entirely when present.** If `audioReactive.target` is `"strength"`, then `pulseSpeed` and `pulseRange` for `strength` are ignored — the audio drives it instead. Do not combine pulse animation and audio modulation on the same parameter; the results are unpredictable and the code does not attempt to merge them.

To avoid confusion: set `pulseSpeed: 0` and `pulseRange` to a static value (e.g., `[4, 4]`) on any parameter that audioReactive controls. This makes the schema self-documenting — a reader can see at a glance that pulse is disabled because audio is driving that parameter.

### Frequency band mapping

FFT bin indices assume a 2048-sample AnalyserNode. Bin frequency = `binIndex * sampleRate / fftSize`.

```
BAND  │ BINS     │ FREQUENCY RANGE   │ MUSICAL CONTENT
──────┼──────────┼───────────────────┼──────────────────────
bass  │ 1–12     │ ~20–250 Hz        │ kick drums, bass lines, low rumble
mid   │ 12–93    │ ~250–2000 Hz      │ vocals, instruments, body
high  │ 93–744   │ ~2000–16000 Hz    │ cymbals, sibilance, air
```

**Dynamic sampleRate:** The bin ranges above assume 44100 Hz. In implementation, calculate bin boundaries from `audioContext.sampleRate` rather than hardcoding, because some devices run at 48000 Hz or 96000 Hz. The formula: `binIndex = Math.round(frequencyHz / (sampleRate / fftSize))`. The target frequencies (20, 250, 2000, 16000 Hz) are the constants; the bin indices are derived.

---

## Module Changes

### audio.js — three new exports

```
getAnalyserNode()          — lazy-create AnalyserNode on Howler's AudioContext,
                             connect to ctx.destination. Returns AnalyserNode.
                             Subsequent calls return the same instance.
                             fftSize: 2048, smoothingTimeConstant: 0.8

connectAnalyserToCue(id)   — store target cue ID. When that cue starts playing
                             (via crossfadeAmbientCue or playCue), connect its
                             <audio> element to the AnalyserNode via
                             createMediaElementSource(). Tracks connected element
                             to prevent double-connection (InvalidStateError).

disconnectAnalyserSource() — disconnect MediaElementSourceNode, clear tracking
                             state. Called by cancelAudioCues() on scene change.
```

**Implementation note:** `createMediaElementSource()` takes ownership of the `<audio>` element's output. The `AnalyserNode.connect(ctx.destination)` call re-routes audio to speakers through the Web Audio graph. CORS restrictions apply — the audio file must be served from the same origin. carbon-trace serves all audio from same-origin (`/assets/audio/`), so this works. If CORS blocks the AnalyserNode, the fallback is `audioReactive` regions behaving as if audio is silent (parameters stay at `range[0]`).

**Howler internals dependency:** `Howler.ctx` (AudioContext) and `howl._sounds[0]._node` (underlying `<audio>` element) are not part of Howler's documented public API. They work in current versions but could change. Pin Howler version and add a comment noting the internal API usage.

### effects-canvas.js — one new method

```
setAnalyser(analyserNode)  — store reference. Ticker reads frequency data
                             each frame if analyser is set and regions have
                             audioReactive config. Cleared on clearAll().
```

The FFT data array (`Uint8Array(analyserNode.frequencyBinCount)`) is allocated once and reused across frames. One `getByteFrequencyData()` call per frame, shared across all audioReactive regions.

### app.js — bridge wiring in showFrame() + cleanup

```js
if (frame.effects?.regions?.some(r => r.audioReactive)) {
  effectsCanvas.setAnalyser(audio.getAnalyserNode());
}
```

Called once per scene that has audioReactive regions. Not called for scenes without audioReactive — no AnalyserNode created until needed.

---

## Edge Cases

```
SCENARIO                │ BEHAVIOR
────────────────────────┼─────────────────────────────────────────────
No audio playing        │ getByteFrequencyData() returns all zeros.
                        │ Modulated value stays at range[0]. Effect
                        │ visible at minimum intensity, not invisible.
────────────────────────┼─────────────────────────────────────────────
Audio muted             │ Howler mute sets volume to 0 but audio still
                        │ plays internally. AnalyserNode may still
                        │ receive signal depending on where mute is
                        │ applied in the chain. Test and document.
────────────────────────┼─────────────────────────────────────────────
Paused                  │ Ticker stopped → no FFT reads. On resume,
                        │ smoothing catches up naturally — no jump.
────────────────────────┼─────────────────────────────────────────────
Reduced motion          │ audioReactive is ignored entirely. The base
                        │ parameter value is used (e.g., strength: 4
                        │ without modulation). Effect is present but
                        │ static.
────────────────────────┼─────────────────────────────────────────────
Multiple reactive       │ All read from the same shared AnalyserNode
regions                 │ and FFT data array. One getByteFrequencyData()
                        │ call per frame, not per region.
────────────────────────┼─────────────────────────────────────────────
WebGL unavailable       │ Effects disabled (ADR-007 fallback).
                        │ audioReactive has nothing to modulate.
                        │ getAnalyserNode() is never called.
────────────────────────┼─────────────────────────────────────────────
CORS blocks             │ AnalyserNode receives silence. Same as
AnalyserNode            │ "no audio playing" — range[0] fallback.
                        │ No crash, no error beyond console warning.
────────────────────────┼─────────────────────────────────────────────
pulse + audioReactive   │ audioReactive wins. pulseSpeed/pulseRange
on same parameter       │ ignored for that parameter. See precedence
                        │ rule above.
────────────────────────┼─────────────────────────────────────────────
Trigger: no audio       │ Running average stays at 0. Energy never
                        │ exceeds threshold. No triggers fire. Effect
                        │ idle at cycleDuration (shockwave invisible).
────────────────────────┼─────────────────────────────────────────────
Trigger: sustained      │ Running average rises to match sustained
loud audio              │ energy. Triggers only fire on transients
                        │ above the running average, not on steady
                        │ volume. Adaptive by design.
────────────────────────┼─────────────────────────────────────────────
Trigger: reduced motion │ Trigger ignored (same as modulation).
                        │ Effect static at base parameter value.
```

---

## Performance

```
OPERATION                    │ COST        │ NOTES
─────────────────────────────┼─────────────┼──────────────────────────
getByteFrequencyData()       │ ~0.1ms      │ Copies FFT into pre-allocated
                             │             │ Uint8Array. One call per frame.
─────────────────────────────┼─────────────┼──────────────────────────
Band averaging               │ ~0.01ms     │ Sum and divide a bin range.
─────────────────────────────┼─────────────┼──────────────────────────
EMA + lerp per region        │ ~0.001ms    │ Two multiplies, one add.
─────────────────────────────┼─────────────┼──────────────────────────
TOTAL per frame              │ < 0.2ms     │ Well within ADR-007's <2ms
                             │             │ per-frame budget.
```

No new GPU work. audioReactive changes parameter values on existing filters — the GPU cost is identical whether the parameter is static, pulsed, or audio-driven.

---

## Reduced Motion

When `prefers-reduced-motion: reduce` is active, `audioReactive` is **ignored entirely**. The base parameter value from the region config is used without modulation. The effect is present but static — same as all other ADR-007 effects under reduced motion.

This is consistent with WCAG 2.3.3 (Animation from Interactions) — audio-driven animation is still animation, and users who've requested reduced motion should not see it.

---

## Test Matrix

```
CATEGORY              │ CASES
──────────────────────┼──────────────────────────────────────────────
Basic modulation      │ bass/mid/high bands correctly drive target param,
                      │ output stays within range[min, max]
Smoothing             │ smoothing: 0 → instant response,
                      │ smoothing: 0.8 → gradual response,
                      │ smoothing: 0.95 → very slow response
No audio              │ FFT returns zeros → value stays at range[0]
Muted                 │ Test whether AnalyserNode still receives signal
                      │ when Howler mute is active
Pause/resume          │ No FFT reads while paused, smooth catchup on resume
Reduced motion        │ audioReactive ignored, base param value used
Multiple regions      │ Multiple audioReactive regions share one FFT read
Precedence            │ audioReactive overrides pulse on same parameter
CORS / same-origin    │ Verify AnalyserNode works with same-origin audio
                      │ served via Howler html5 mode
Dynamic sampleRate    │ Verify bin calculation works at 48000Hz (not just 44100Hz)
Trigger: onset        │ Energy spike above threshold * runningAvg fires
                      │ effect.trigger(), resets shockwave cycle
Trigger: cooldown     │ Rapid energy spikes within cooldown window
                      │ are ignored (only first fires)
Trigger: adaptation   │ Running average rises with sustained energy,
                      │ only transients above average trigger
Trigger + modulate    │ Combined mode: trigger fires cycle AND
                      │ modulation drives amplitude in same frame
Trigger: autoRepeat   │ autoRepeat:false shockwave idles after one
                      │ cycle, only trigger() restarts it
```

---

## Artistic Decisions (not automatable — Ashley)

These require human judgment in-browser with actual music:

1. **Which regions on Scene 11 get audioReactive?** Which effects should breathe with the music vs stay on fixed timers?
2. **Band selection per region.** Does the glow react to bass? Mid? Depends on the track's frequency content.
3. **Range tuning.** `range: [2, 12]` is a guess. The right range depends on how the effect looks at extremes with the actual music playing.
4. **Smoothing tuning.** 0.8 is a starting point. Too low = jittery. Too high = laggy. Depends on the music's tempo and the effect type.
5. **Multiple bands?** Should different regions react to different bands (glow to bass, displacement to mid) for richer visual response?

---

## Open Questions

1. ~~**Howler html5 mode + AnalyserNode compatibility.**~~ **Resolved:** `createMediaElementSource()` routes the `<audio>` element through the Web Audio graph. Same-origin audio works without CORS headers. The signal chain section above documents the corrected approach.
2. **Howler mute behavior under `createMediaElementSource()`.** When `howl.mute(true)` is called, Howler sets the `<audio>` element's `muted` property. Since `createMediaElementSource()` taps the element *before* the muted flag is applied by the browser, the AnalyserNode may still receive signal. Test and document behavior — this determines whether muted audio still drives visuals.

---

## Action Items

1. [x] Add `getAnalyserNode()` to audio.js — lazy AnalyserNode on Howler's AudioContext
2. [x] Add `setAnalyser()` to effects-canvas.js — store analyser, read FFT in ticker
3. [x] Implement per-frame band extraction, EMA smoothing, and parameter lerp
4. [x] Implement dynamic sampleRate bin calculation (not hardcoded 44100Hz)
5. [x] Wire audio-reactive bridge in app.js showFrame()
6. [ ] Verify Howler html5 mode + AnalyserNode works with same-origin audio (blocking — in-browser)
7. [ ] Test Howler.masterGain() behavior under mute (in-browser)
8. [x] Author Scene 11 audioReactive regions (Ashley — artistic decisions)
9. [ ] Tune range/smoothing/threshold/cooldown values in-browser with actual music (Ashley)
10. [x] Test: silence, muted, pause/resume, reduced motion, multiple bands, 48kHz sampleRate
11. [ ] Add `autoRepeat` param and `trigger()` method to shockwave factory in effects.js
12. [ ] Add onset detection to effects-canvas.js tickerUpdate (spectral flux + trigger dispatch)
13. [ ] Update Scene 11 config: trigger + modulate combined, fast cycleDuration, adjusted center
14. [ ] Re-author `mask-11-music-shockwave.png` for upward-only column above record (Ashley)
15. [ ] Test: onset detection, cooldown, combined trigger+modulate, autoRepeat false/true
