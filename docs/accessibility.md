# Accessibility

## WCAG AA Compliance

### Screen Reader Support

- `#accessible-narration` — `aria-live="polite"` region populated with full caption transcriptions (not overlay text fragments)
- `.narration-layer` — `aria-hidden="true"` (visual-only ghost-drift text)
- `.caption-layer` — `aria-hidden="true"` (visual-only subtitles; screen readers get the full text from `#accessible-narration`)
- Scene images use `alt` text from frame descriptions
- All buttons have `aria-label` attributes
- Progress dots have `aria-label` with scene index and `title` attribute

### Why Caption Layer is `aria-hidden="true"`

The caption layer renders visual subtitles for sighted users. Screen readers receive the same content through `#accessible-narration` (the `aria-live` region). Making captions visible to screen readers would cause duplicate announcements.

### Keyboard Navigation

All controls are Tab-focusable:

| Key           | Action                                                         |
| ------------- | -------------------------------------------------------------- |
| Tab           | Move focus between controls                                    |
| Space / Enter | Activate focused button; advance scene (when not on a control) |
| Arrow Right   | Advance to next scene                                          |
| Arrow Left    | Return to previous scene                                       |

**No single-character shortcuts** — per WCAG 2.1 SC 2.1.4, all keyboard shortcuts require modifier keys or are only active when a component has focus. Scene advancement via Space/Enter only fires when not focused on a control button.

### Focus Management

- `focus-visible` outline on all interactive elements (2px solid, rgba white)
- Progress dots: outline offset -2px
- Control buttons: outline offset 3px
- Disabled buttons: 0.3 opacity, `cursor: default`

### `aria-pressed` Pattern

Pause and Captions buttons use `aria-pressed` (not label-toggling) for proper screen reader toggle announcements:

- `aria-pressed="false"` → "Pause, toggle button, not pressed"
- `aria-pressed="true"` → "Pause, toggle button, pressed"

### Color Contrast

- Caption background: `rgba(0, 0, 0, 0.85)` on `#e8e4df` text — exceeds WCAG AA 4.5:1 ratio
- Narration text: `#e8e4df` with `text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8)` for readability on varied backgrounds
- Control buttons: `rgba(232, 228, 223, 0.9)` on `rgba(8, 8, 8, 0.6)` backdrop

## `prefers-reduced-motion`

When `prefers-reduced-motion: reduce` is active:

| Feature           | Normal                   | Reduced Motion           |
| ----------------- | ------------------------ | ------------------------ |
| Ghost-drift text  | y-offset entrance + exit | Opacity-only fade (0.3s) |
| Scene transitions | GSAP fade with duration  | Instant swap (no GSAP)   |
| Visual effects    | Full animations          | Skipped entirely         |
| Captions          | Same behavior            | Same behavior            |
| Trace overlay     | 0.6s opacity transition  | 0.3s opacity transition  |

All effects (`triggerEffect()`) are completely skipped when reduced motion is preferred.
