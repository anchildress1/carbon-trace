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

carbon-trace uses Howler.js in `html5: true` mode exclusively. In html5 mode, `<audio>` elements output directly to the system audio device, bypassing the Web Audio graph entirely. `Howler.masterGain()` carries no signal from html5-mode sounds.

To get FFT data without touching Howler's audio, a **dedicated silent `<audio>` element** streams the same audio file independently. This element is connected to the AnalyserNode via `createMediaElementSource()`. Howler's playback element is completely untouched — no ownership transfer, no routing changes:

```
Howler end-song <audio> (html5:true)   →  system audio output (playback, untouched)

Dedicated analysis <audio> (same src)
  └─ createMediaElementSource(element)
       └─ AnalyserNode (audio.js, fftSize: 2048)
            ├─ getByteFrequencyData() → Uint8Array[1024]
            │    └─ effects-canvas.js ticker reads per frame
            └─ GainNode (gain: 0)
                 └─ ctx.destination (silent — required for Chrome to process FFT)

Chrome does not process audio through an AnalyserNode unless the Web Audio graph
reaches ctx.destination. A dead-end analyser returns all-zero FFT data. The
GainNode with gain=0 satisfies this requirement while producing no audible output.
```

**Why a dedicated element instead of tapping Howler's?** `createMediaElementSource()` takes permanent ownership of an `<audio>` element's output — audio no longer goes directly to speakers, but must route through the Web Audio graph. When applied to Howler's element in html5 mode, this caused audio loss (see Implementation Findings). The dedicated element isolates this side effect: if the analysis routing fails, only FFT data is lost; playback is unaffected.

**`createMediaElementSource()` constraints:**
- Can only be called **once per `<audio>` element**. Calling it again on the same element throws `InvalidStateError`. The implementation tracks the connected element and skips reconnection.
- Takes **ownership** of the element's output — audio no longer goes directly to speakers. The `AnalyserNode → GainNode(0) → ctx.destination` chain routes through Web Audio silently.
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

When `audioReactive.trigger` is present, the ticker additionally runs onset detection each frame using **spectral flux** — the positive change in band energy between consecutive frames:

```
FOR EACH region with audioReactive.trigger:
  1. Compute spectral flux:
     flux = max(0, currentEnergy - previousEnergy)
     (only positive changes — onsets, not decays)
  2. Update flux running average:
     fluxAvg = fluxAvg * 0.95 + flux * 0.05
  3. Increment timeSinceLastTrigger by frame delta
  4. IF energy < minEnergy: SKIP (volume gate — see below)
  5. IF flux > fluxAvg * threshold AND timeSinceLastTrigger > cooldown:
     a. Call effect.trigger() — resets the animation cycle (e.g., shockwave time=0)
     b. Reset timeSinceLastTrigger = 0
```

**Why spectral flux, not absolute level.** The original algorithm compared absolute band energy to a running energy average (`energy > avgEnergy * 1.5`). This fails for music with sustained bass (folk-punk, rock, etc.) where the bass energy fluctuates only ±15% around the mean — the running average converges to the same level and the threshold is never exceeded. Spectral flux measures *change* between frames instead. A kick drum causes a sudden energy *increase* (high flux) even when the overall bass level is consistently high. The running average of flux is typically low (small frame-to-frame jitter), so even moderate increases in energy produce flux spikes that exceed the threshold.

The `threshold` multiplier means "trigger when flux exceeds the average flux by this factor." A threshold of 3.0 = "3x the typical frame-to-frame change." The `cooldown` prevents rapid re-triggering within a minimum interval.

**Volume gate (step 4):** The `minEnergy` field sets a minimum band energy level (0–1) below which all triggers are suppressed. The analysis `<audio>` element plays at full volume through the AnalyserNode immediately — so FFT data shows the track's actual energy levels regardless of the Howler cue's fade-in state. During the fade-in period the music's energy sits around 0.55–0.72 before climbing to 0.85+ at full intensity. Setting `minEnergy` to 0.80 gates triggers until the music itself reaches full volume, naturally aligning with the audible fade-in.

Trigger and continuous modulation run in the same frame. Continuous modulation sets the parameter value (e.g., amplitude), then trigger fires a new cycle if a beat is detected. Combined: each beat fires a shockwave whose intensity matches the hit strength.

### Shockwave `autoRepeat` and `trigger()`

The shockwave effect factory accepts an `autoRepeat` param (default `true`). When `false`, the wave plays once through `cycleDuration` then idles — it does not auto-repeat on a fixed timer. The `trigger()` method on the effect object resets the cycle timer to zero, starting a new wave expansion. This is the mechanism onset detection uses to fire discrete shockwaves on each detected beat.

**Idle state via `filter.enabled`:** When `autoRepeat: false`, the ShockwaveFilter starts with `filter.enabled = false` (PixiJS skips the entire filter pipeline — no render target, no shader execution). `trigger()` sets `filter.enabled = true` to begin a wave cycle. When `elapsed >= cycleDuration`, `update()` sets `filter.enabled = false` again. This ensures zero visual distortion between beats. Continuous modulation (`applyModulation`) freely updates `filter.amplitude` on the disabled filter — the value is a JS property write that takes effect when the filter next enables, so the first visible frame of a triggered wave already has the correct FFT-derived amplitude.

### Module wiring (no cross-imports)

```
audio.js                    app.js                      effects-canvas.js
───────────                 ──────                      ─────────────────
getAnalyserNode() ────→  showFrame() bridge ────→  connectAnalysisAudio(src, node)
                            resolves analyserCueId       ├─ creates silent <audio> (volume=0)
                            to audio src URL             ├─ createMediaElementSource
                            ↓                            ├─ source.connect(analyserNode)
                          PausableTimer ────────→       startAnalysisPlayback()
                            (fires at cue enter)              │
                                                              ▼
                          cleanupCurrentScene() ──→     clearAll() cleans up element
```

app.js showFrame() wiring:
```js
if (frame.effects?.regions?.some(r => r.audioReactive)) {
  const analyser = audio.getAnalyserNode();
  if (analyser && frame.effects.analyserCueId) {
    const cue = frame.audioCues?.find(c => c.id === frame.effects.analyserCueId);
    if (cue?.src) {
      effectsCanvas.connectAnalysisAudio(cue.src, analyser);
      const enterDelay = resolveAnalyserCueEnter(frame, cue, app.audioDurations);
      // Schedule analysis start to match when the Howl starts playing
      if (enterDelay > 0) {
        app.analysisStartTimer = new PausableTimer(
          () => effectsCanvas.startAnalysisPlayback(), enterDelay);
      } else {
        effectsCanvas.startAnalysisPlayback();
      }
    }
  }
}
```

The `analyserCueId` field in the effects config identifies which audio cue provides the analysis source. For Scene 11, this is `"end-song"`. app.js resolves it to the cue's `src` URL and passes it to `effects-canvas.js`, which creates the dedicated analysis element. audio.js knows nothing about the analysis element — it only provides the AnalyserNode on Howler's AudioContext.

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
  "cycleDuration": 2.0,      // ← time for wave to expand across screen
  "audioReactive": {
    "band": "bass",
    "target": "amplitude",   // continuous: modulate intensity per hit strength
    "range": [10, 30],
    "smoothing": 0.3,        // lower = more responsive to transients
    "trigger": {             // onset detection via spectral flux (optional)
      "threshold": 3.0,      // fire when flux > fluxAvg * 3.0
      "cooldown": 0.08,      // min 80ms between triggers (~12/sec max)
      "minEnergy": 0.80      // suppress triggers below this energy level
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

### audio.js — two exports

```
getAnalyserNode()          — lazy-create AnalyserNode on Howler's AudioContext.
                             NOT connected to ctx.destination (no audio output).
                             Returns the same instance on subsequent calls.
                             fftSize: 2048, smoothingTimeConstant: 0.4

disconnectAnalyserSource() — clear AnalyserNode reference. Called by
                             cancelAudioCues() on scene change.
```

`smoothingTimeConstant` is 0.4 — low enough to preserve transient peaks for onset detection, high enough to reduce frame-to-frame FFT noise. Previously 0.8, which dampened transients below the onset threshold.

**Howler internals dependency:** `Howler.ctx` (AudioContext) is not part of Howler's documented public API. Pin Howler version and note the internal API usage.

### effects-canvas.js — analysis element + FFT

```
connectAnalysisAudio(src, analyserNode)
                           — create a silent <audio> element (volume=0) for the given src,
                             connect via createMediaElementSource to the
                             analyserNode. Element starts buffering immediately
                             (preload: 'auto') but does not play yet.
                             Cleans up any previous analysis element first.

startAnalysisPlayback()    — call play() on the analysis element. No-op if
                             no element exists (graceful degradation).

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
Trigger: sustained      │ Spectral flux detects onsets even when
loud audio              │ absolute bass level is consistently high.
                        │ Triggers fire on energy *increases*
                        │ (beats), not absolute level. Adaptive
                        │ by design.
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
Trigger: onset        │ Spectral flux spike above fluxAvg * threshold
                      │ fires effect.trigger(), resets shockwave cycle
Trigger: cooldown     │ Rapid flux spikes within cooldown window
                      │ are ignored (only first fires)
Trigger: adaptation   │ Flux average adapts to music dynamics.
                      │ Sustained energy = low flux = low fluxAvg.
                      │ Beats produce flux spikes above threshold.
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

1. ~~**Howler html5 mode + AnalyserNode compatibility.**~~ **Reopened — see Implementation Findings below.** `createMediaElementSource()` takes ownership of the `<audio>` element's output. When the analyser actually connects (race condition fixed), audio output is lost. The routing chain `MediaElementSourceNode → AnalyserNode → ctx.destination` does not reliably restore playback in Howler html5 mode.
2. **Howler mute behavior under `createMediaElementSource()`.** When `howl.mute(true)` is called, Howler sets the `<audio>` element's `muted` property. Since `createMediaElementSource()` taps the element *before* the muted flag is applied by the browser, the AnalyserNode may still receive signal. Test and document behavior — this determines whether muted audio still drives visuals.

---

## Implementation Findings (March 2026)

### Critical: `createMediaElementSource()` causes audio loss

The `createMediaElementSource()` approach has a fatal architectural incompatibility with Howler html5 mode.

**What happened across three iterations:**

1. **Original code**: `howl.once('play', connectHowlToAnalyser)` was registered *after* `howl.play()`. The `play` event fired before the listener existed — `connectHowlToAnalyser()` never ran. Audio played normally (no Web Audio interference) but the AnalyserNode received zero FFT data. Shockwave never triggered.

2. **Race condition fix**: Moved `once('play')` registration before `play()`. The analyser connected successfully. `createMediaElementSource()` took ownership of the `<audio>` element's output. The chain `element → MediaElementSourceNode → AnalyserNode → ctx.destination` was correctly wired. **Result: zero audio output.**

3. **The dilemma**: Either the analyser never connects (audio works, shockwave dead) or it connects and kills audio (shockwave works, nothing to hear). There is no working middle ground with `createMediaElementSource()` + Howler html5 mode.

**Root cause is architectural.** Howler html5 mode was designed to bypass the Web Audio graph — `<audio>` elements output directly to the system audio device. `createMediaElementSource()` forces the element back through the Web Audio graph. Even though the chain `AnalyserNode → ctx.destination` should restore playback, it fails in practice. Possible contributing factors (unconfirmed):

- AudioContext may be `suspended` when the analyser is created; Howler's internal `resume()` timing may not propagate through the `createMediaElementSource()` routing
- Howler html5 mode controls volume/fade/mute directly on the `<audio>` element, which may interact unpredictably with `createMediaElementSource()` ownership
- Browser-specific behavior when `createMediaElementSource()` is called on an element that's already playing with active fades

### Correct fixes (preserve regardless of approach)

These changes are independent of the routing problem and should be retained:

| Fix | Location | Detail |
|---|---|---|
| `filter.enabled` lifecycle | effects.js | ShockwaveFilter starts `enabled=false` when `autoRepeat:false`. `trigger()` enables; `update()` disables after `cycleDuration`. PixiJS skips the entire filter pipeline when disabled. |
| `smoothingTimeConstant = 0.4` | audio.js | 0.8 (original ADR value) dampened bass transients below the onset detection threshold. 0 was too noisy — frame-to-frame noise raised the running average baseline, masking real beats. 0.4 preserves transients while dampening noise. |
| Warmup guard | effects-canvas.js | `if (activeFrames < 60) return` in `applyTrigger()`. Prevents false trigger when audio first arrives — the initial energy jump from 0 produces a massive spectral flux spike before the flux average has stabilized. |
| Event registration order | audio.js | `howl.once('play', ...)` must register before `howl.play()` — Howler may emit the event synchronously. *However: this fix is what exposes the `createMediaElementSource()` audio loss.* |

### Alternative approaches for audio-reactive

The current `createMediaElementSource()` approach must be replaced. Evaluated alternatives:

| # | Approach | How it works | Risk to audio | Tradeoff |
|---|---|---|---|---|
| **A** | **Pre-analyzed beat map** | Offline analysis produces a JSON array of beat timestamps embedded in scene config. `effects-canvas.js` fires `trigger()` at each timestamp relative to the cue's start time. No Web Audio API at runtime. | **None** | Deterministic, zero runtime risk. Drops continuous amplitude modulation (each beat would use a fixed or pre-analyzed intensity). Requires offline tooling or manual beat marking. Locked to a specific audio file — re-analyze if the track changes. |
| **B** | **Dedicated analysis element** | Create a second, muted `<audio>` element pointing to the same audio file. Connect only this element via `createMediaElementSource()` for FFT analysis. Howler's playback audio is completely untouched. Periodically sync `currentTime` between the two elements. | **None** | Real-time FFT without risking playback. Preserves continuous modulation. Double bandwidth (two streams of the same file). Time synchronization adds complexity — drift between elements could desync beats. Additional `<audio>` element may impact mobile memory. |
| **C** | **Howler Web Audio mode for end-song** | Use `html5: false` for the end-song cue only. In Web Audio mode, Howler routes audio through its `AudioContext` natively. Tap `Howler.masterGain` or insert an AnalyserNode in the native routing — no `createMediaElementSource()` needed. | **Low** | Uses Howler's own Web Audio routing as designed. But Web Audio mode buffers the entire file into memory (no streaming), may have different latency, and may behave differently on mobile (memory constraints for a full music track). All other cues remain html5. |
| **D** | **Fix current approach** | Debug why `AnalyserNode → ctx.destination` doesn't produce audio after `createMediaElementSource()`. | **High** | Three iterations produced three regressions. The approach fights Howler's design. Even if fixed, the failure mode is catastrophic (zero audio for a decorative feature). |

---

## Action Items

1. ~~done~~ Add `getAnalyserNode()` to audio.js — lazy AnalyserNode on Howler's AudioContext
2. ~~done~~ Add `setAnalyser()` to effects-canvas.js — store analyser, read FFT in ticker
3. ~~done~~ Implement per-frame band extraction, EMA smoothing, and parameter lerp
4. ~~done~~ Implement dynamic sampleRate bin calculation (not hardcoded 44100Hz)
5. ~~done~~ Wire audio-reactive bridge in app.js showFrame()
6. ~~done~~ ~~BLOCKED~~ — Resolved via Approach B (dedicated analysis element). `createMediaElementSource()` on a separate muted `<audio>` element; Howler untouched.
7. [ ] Test Howler.masterGain() behavior under mute (in-browser) — moot with Approach B
8. ~~done~~ Author Scene 11 audioReactive regions (Ashley — artistic decisions)
9. [ ] Tune range/smoothing/threshold/cooldown values in-browser with actual music (Ashley)
10. ~~done~~ Test: silence, muted, pause/resume, reduced motion, multiple bands, 48kHz sampleRate
11. ~~done~~ Add `autoRepeat` param and `trigger()` method to shockwave factory in effects.js
12. ~~done~~ Add onset detection to effects-canvas.js tickerUpdate (spectral flux + trigger dispatch)
13. ~~done~~ Update Scene 11 config: trigger + modulate combined, fast cycleDuration, adjusted center
14. [ ] Re-author `mask-11-music-shockwave.png` for upward-only column above record (Ashley)
15. ~~done~~ Test: onset detection, cooldown, combined trigger+modulate, autoRepeat false/true
16. ~~done~~ **Revert commit e58b60f** — done. Audio restored; `createMediaElementSource` wiring removed.
17. ~~done~~ **Approach B chosen** — dedicated silent `<audio>` element (volume=0) for FFT analysis, Howler untouched.
