# Accessibility

## Screen Reader Support

```mermaid
flowchart LR
    A["#accessible-narration<br/>aria-live=polite"] -->|updated on| B[Scene change]
    B --> C[Screen reader announces full narration text]
```

A persistent `aria-live="polite"` region (`#accessible-narration`) receives the
full narration text for each scene on scene change. When captions are available,
their text is used; otherwise narration line text is joined. Screen readers
announce the content as it changes without interrupting the user.

The ghost-drift narration layer and caption layer are both marked
`aria-hidden="true"` because they are visual-only presentations of the same
content that `#accessible-narration` provides to assistive technology.

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `Space` | Toggle play/pause |
| `Enter` / `ArrowRight` | Advance to next scene |
| `ArrowLeft` | Return to previous scene |
| `Tab` | Navigate between controls |

Space toggles play/pause (not advance). Enter and ArrowRight advance to the
next scene. All control buttons (prev, pause, mute, captions, replay, next)
are focusable and respond to keyboard activation. Space and Enter/ArrowRight
do not fire when focus is inside the control bar to avoid conflicting with
button activation.

## Focus Management

- All interactive elements have visible focus indicators: 2px white outline at
  -2px offset.
- Disabled buttons (`aria-disabled="true"` or `disabled` attribute) have
  reduced opacity (0.3) and do not respond to interaction.
- Progress dots are buttons with `aria-label="Go to scene N of M"`.

## ARIA Attributes

| Element | Attribute | Purpose |
|---------|-----------|---------|
| `#app` | `role="application"` | Declares app-managed keyboard handling |
| `#accessible-narration` | `aria-live="polite"` | Announces narration text |
| `#narration-layer` | `aria-hidden="true"` | Hides decorative ghost-drift text |
| `#caption-layer` | `aria-hidden="true"` | Hides visual captions (content in live region) |
| `#btn-pause` | `aria-pressed` | Toggle state for pause/play |
| `#btn-captions` | `aria-pressed` | Toggle state for captions on/off |
| `#btn-mute` | `aria-label` | Updates between "Mute audio" / "Unmute audio" |
| `#btn-mute` | `aria-disabled` | Disabled until audio is available |
| `#scene-stage` | `aria-label` | Scene description from `frame.description` |
| progress dots | `aria-current="step"` | Identifies the current scene dot |

## Reduced Motion

When `prefers-reduced-motion: reduce` is active:

```mermaid
flowchart TD
    A{prefers-reduced-motion?} -->|reduce| B[Simple fade animations]
    A -->|no-preference| C[Full ghost-drift + effects]

    B --> D["Text: 0.3s opacity fade"]
    B --> E["Transitions: instant (no GSAP fade)"]
    B --> F["Effects: skipped"]
    B --> G["Trace overlay: 0.3s transition"]

    C --> H["Text: 1.2s blur + y + opacity"]
    C --> I["Transitions: GSAP two-phase fade"]
    C --> J["Effects: particles, pulses, etc."]
    C --> K["Trace overlay: 0.6s transition"]
```

| Feature | Normal | Reduced Motion |
|---------|--------|----------------|
| Ghost-drift text | Blur + y offset + opacity (1.2s in, 0.9s out) | Opacity only (0.3s) |
| Scene transitions | Two-phase GSAP fade | Instant swap |
| Visual effects | Full particle/filter effects | Skipped entirely |
| Trace overlay | 0.6s opacity transition | 0.3s opacity transition |

The `prefersReducedMotion()` check is evaluated at the point of use (not
cached), so it responds to runtime changes in the user's system preference.

## Caption System

```mermaid
sequenceDiagram
    participant User
    participant App as app.js
    participant Text as text.js
    participant Cap as captions.js

    Note over App: showFrame → buildNarration
    App->>Text: buildNarrationTimeline(lines, container, opts)
    Text->>Text: Embed caption show/hide as GSAP timeline callbacks
    Text-->>App: { timeline, captionEntries }

    Note over App: Scene plays — timeline drives captions

    User->>App: Toggle captions on
    App->>Cap: setCaptionsEnabled(true)
    App->>Cap: syncCaptionsToTime(entries, currentTime, container)
    Cap->>Cap: Show captions active at current position

    User->>App: Pause
    App->>App: textTimeline.pause() — freezes captions too

    User->>App: Resume
    App->>App: textTimeline.resume() — captions resume in sync
```

Caption show/hide scheduling is embedded directly in the GSAP text timeline
built by `text.js`. Each caption's `start`/`end` timestamps (offset by
`narration.delay`) become `tl.call()` entries that create and remove caption
DOM elements. Because captions live inside the same timeline as narration
text, they automatically pause and resume with it — no separate timer math.

Toggling captions mid-scene calls `syncCaptionsToTime`, which scans caption
entries and immediately shows any that should be visible at the current
timeline position.

The caption preference is persisted in `localStorage` under the key
`carbon-trace-captions-enabled`.

## Content Security Policy

The CSP meta tag restricts resource loading:

```
default-src 'self'
script-src  'self'
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com
img-src     'self'
media-src   'self' data:
font-src    'self' https://fonts.gstatic.com
connect-src 'none'
object-src  'none'
base-uri    'self'
```

`connect-src` is relaxed to `'self' ws:` during development to allow Vite HMR
WebSocket connections (handled by the `relax-csp-dev` Vite plugin).

## Progressive Enhancement

The Google Fonts stylesheet is loaded via `<link rel="preload" as="style">`
and activated by JavaScript in `main.js`. A `<noscript>` fallback ensures the
Lora font loads even when JavaScript is disabled.
