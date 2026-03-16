# Architecture

## Module Graph

```mermaid
graph TD
    main["main.js<br/>(entry point)"] --> app["app.js<br/>(orchestrator / state machine)"]
    app --> audio["audio.js<br/>(3-channel mixer)"]
    app --> text["text.js<br/>(ghost-drift timeline)"]
    app --> effects["effects.js<br/>(per-frame visuals)"]
    app --> overlay["overlay.js<br/>(progress dots + controls)"]
    app --> captions["captions.js<br/>(timed subtitles)"]
    app --> scenes["scenes.json<br/>(frame data)"]

    audio -.->|Howler.js| howler["howler"]
    text -.->|GSAP| gsap["gsap"]
    effects -.->|GSAP| gsap
```

## State Machine

```mermaid
stateDiagram-v2
    [*] --> LOADING : createApp()
    LOADING --> PAUSED : preloadAssets → showFrame(0) → start paused

    PAUSED --> SCENE_ACTIVE : doResume() / first play
    PAUSED --> TRANSITIONING : navigate while paused

    SCENE_ACTIVE --> PAUSED : doPause()
    SCENE_ACTIVE --> TRANSITIONING : advance() / retreat()

    TRANSITIONING --> SCENE_ACTIVE : fade complete (normal frame)
    TRANSITIONING --> CREDITS : fade complete (credits frame)

    CREDITS --> PAUSED : doPause()
    CREDITS --> TRANSITIONING : retreat()
```

## Frame Lifecycle

When a frame becomes active, `showFrame(index)` runs this sequence:

```mermaid
flowchart TD
    A[showFrame] --> B[Clear phase timer]
    B --> C[Set image + alt text + trace overlay]
    C --> D[clearEffects + clearNarrationLayer]
    D --> E[Run idle effect if defined]
    E --> F[Update progress dots]
    F --> G[Update nav button states]
    G --> H[applyNarration]
    H --> I[applyAmbient]
    I --> J{Has phases?}
    J -- yes --> K[startPhase 0]
    J -- no --> L[Pre-buffer next narration]
    K --> L
```

### applyNarration

1. Clear pending narration timer and caption delay timer.
2. Build ghost-drift text timeline from `frame.narration.lines`.
3. Show captions via `scheduleCaptionDisplay` (respects `narration.delay`).
4. Populate `#accessible-narration` for screen readers.
5. Schedule music if `frame.music` is present (with enter/exit timing).
6. Schedule narration audio (with optional delay).

## Modules

### app.js (orchestrator)

Single source of truth for application state. Owns the `app` object containing
`currentIndex`, `state`, all timer references and their remaining values for
pause/resume, the GSAP text timeline, and DOM element references. Every user
interaction (click, keyboard, button) routes through `app.js` functions.

Key responsibilities:
- Asset preloading (first-frame blocking, background sequential).
- Scene transitions with GSAP two-phase fade and error boundary.
- Pause/resume: saves elapsed time for every active timer, pauses text
  timeline and captions, suspends all audio channels.
- Buffering overlay: pauses text and captions when narration stalls, resumes
  when buffer recovers.

### audio.js (3-channel mixer)

Three independent Howler.js channels: ambient, narration, and music.
See [audio-system.md](audio-system.md) for full details.

### text.js (ghost-drift animation)

Builds a GSAP timeline from narration lines. Each line is a `<p>` in the
narration layer with timed entrance and exit animations. Supports custom
viewport positioning (`x`/`y` in vw/vh) and alignment. Falls back to simple
opacity fade when `prefers-reduced-motion` is active.

### effects.js (visual effects)

Registry of named effect functions, each receiving a container element:

| Effect | Type | Description |
|--------|------|-------------|
| `dust-drift` | Particle | 12 white particles drifting upward |
| `dust-settle` | Particle | 10 tan particles settling downward |
| `motion-drag` | Filter | Blur 2px → 0px transition |
| `heat-pulse` | Filter | Blur + brightness pulse (infinite) |
| `near-still-pulse` | Opacity | Pulse to 0.97 over 3s |
| `machine-steady` | Opacity | Pulse to 0.95 over 1.5s |
| `light-crack` | DOM | Gradient flash with scale |
| `illumination-spread` | DOM | Radial glow, scale 0.3 → 1.5 |
| `water-run` | DOM | Vertical gradient stream (loop) |
| `assembly-micro` | Transform | Random micro-jitter |
| `fade-in` | Opacity | Simple 0 → 1 over 0.8s |

Frames declare `effects.idle` (persistent) and `effects.entry` (triggered on
click or replay).

### captions.js (timed subtitles)

Manages a caption timeline synchronized to narration playback.
See [accessibility.md](accessibility.md) for integration details.

### overlay.js (progress + controls)

Creates one progress dot button per scene. Dots light up as the user advances.
Clicking a dot navigates to that scene. The control bar contains prev, pause,
mute, captions, replay, and next buttons.

## scenes.json Schema

```
meta:
  title, author, aspectRatio
  defaultTransition: { type, duration }
  frameDefaults: { textMode }

frames[]:
  id, frameType ("scene" | "credits"), description, image
  narration:
    lines[]: { text, enter (ms), exit (ms), x?, y?, align? }
    captions[]: { text, start (ms), end (ms) }
    audio: path to .m4a
    delay: ms before narration starts
  ambient: { src, volume, loop }
  music: { src, startVolume, fullVolume, crescendoMs, enter, exit }
  effects: { idle, entry }
  traceOverlay: { opacity }
  transition: { type, duration }
  advanceMode: "disabled" (credits)
```

## Deployment

```mermaid
flowchart LR
    subgraph CI["GitHub Actions"]
        A[Push to main] --> B[Build with Vite]
        B --> C[Deploy to GitHub Pages]
    end

    subgraph Docker["Cloud Run"]
        D[Dockerfile] --> E[Node builder stage]
        E --> F[pnpm build → dist/]
        F --> G[nginx 1-alpine]
        G --> H[Serve on :8080]
    end
```

- **GitHub Pages**: static deploy on push to `main` via `deploy.yml`.
- **Cloud Run**: multi-stage Docker build → nginx with gzip, security headers,
  and tiered cache (1yr immutable for hashed assets, 30d for media, no-cache
  for HTML).
