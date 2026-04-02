# carbon-trace — ADR-011: Credits Overlay Architecture

**Status:** Accepted
**Date:** March 28, 2026
**Author:** Ashley Childress (@anchildress1)
**Deciders:** Ashley Childress
**Supersedes:** None. Amends v5 §4 to add credits overlay spec for frame 11. Frame 11's structural behavior (CREDITS state, advance blocked, audio cues) is already implemented and unchanged.

---

## 010.1 Context

Frame 11 (`scene-11-music`) is the terminal credits frame. Unlike what earlier design docs implied (`narration: null`, `textMode: "static"`), the **implemented codebase** on `feat/trace-overlays` has a fully loaded frame:

```
WHAT FRAME 11 ALREADY HAS (implemented):
  ✓ Scene image — warm, light, golden room with figure + record player
  ✓ Ghost-drift narration — 6 positioned text lines with enter/exit timing
  ✓ Captions — 5 timed caption entries
  ✓ Narration audio — 11-music.m4a, enters at 500ms
  ✓ Ambient audio — vinyl crackle, loop: true, volume 0.15
  ✓ End-song — Bridge City Sinners, enters at narration offset -12000ms,
    volume 0.15 → ramps to 0.75 over 3s after narration ends, loop: true
  ✓ Effects — shockwave (audio-reactive to end-song bass) + diamond glow
  ✓ Shimmer — mask-based traces, opacity 0.6, 60 dots, speed 1.0
  ✓ holdAfterNarration: 3000ms
  ✓ State: CREDITS — advance() blocked, terminal frame

WHAT FRAME 11 DOES NOT HAVE (this ADR adds):
  ✗ Credits overlay panel (bio, attributions, links)
  ✗ Auto-scrolling credits text
  ✗ Visual treatment for credits on top of active scene
```

**Key constraint:** Narration plays first. The credits overlay must not appear until narration completes and the song has breathing room. The existing timer chain (Howler `onend` → PausableTimer holdAfterNarration) provides the trigger point.

**Scene image is warm and light** — golden tones, not dark. Credits overlay must create its own contrast zone.

---

## 010.2 Decision

**Frosted glass panel with mask-feathered edges, triggered after narration via the existing PausableTimer chain, with GSAP auto-scroll that loops.**

Credits panel fades in after narration ends + holdAfterNarration delay. Content scrolls upward via GSAP timeline at a fixed reading speed (independent of song duration, since the song loops). When scroll reaches the end, it loops back to the start. Pause freezes everything (existing PAUSED model). Links remain clickable at all times.

---

## 010.3 Options Considered

### Option A+ (SELECTED): Mask-Feathered Glass Panel

| Dimension             | Assessment                                        |
| --------------------- | ------------------------------------------------- |
| Complexity            | Low — backdrop-filter + mask-image, both CSS-only |
| Visual integration    | High — edges dissolve into scene                  |
| Readability           | High — opaque center zone                         |
| Implementation effort | ~3–4 hours                                        |

**Pros:** `backdrop-filter: blur()` + `mask-image: linear-gradient()` feathers edges. Shimmer dots and effects show through blurred. Center is clean dark reading zone. Pure CSS — no extra layers. Links are native DOM.

**Cons:** Slightly more tuning (gradient percentages, blur radius). `-webkit-` prefix needed for Safari. Negligible.

### Other options evaluated (A, C, D): see prior analysis. Rejected for hard edges (A), tuning complexity (C), or timeline/architecture violations (D).

---

## 010.4 Architecture — DOM & Layer Stack

### 010.4.1 Where in the DOM

Credits panel sits inside `#scene-stage`. `overlay-controls` is a **sibling** of `#scene-stage` (not a child), so it naturally paints on top by DOM order. Actual z-index values from codebase:

```
#scene-stage
  ├── .scene-canvas                    Canvas 2D — scene image
  ├── .effects-canvas                  PixiJS/WebGL — shockwave + glow
  │                                    (pointer-events: none)
  ├── .trace-overlay                   Canvas 2D — shimmer
  │                                    (mix-blend-mode: screen, no z-index)
  ├── .narration-layer                 DOM — ghost-drift text (implicit z)
  ├── .caption-layer          z: 5     DOM — captions
  └── #credits-panel          z: 7     DOM — credits overlay
        ├── #credits-backdrop              Backdrop-filter isolation layer
        └── #credits-scroll-content        Scrolling content container

.overlay-controls             z: 10    DOM — progress dots, buttons (sibling of #scene-stage)
```

`#credits-panel` at z-index 7: above captions (5) within `#scene-stage`. `overlay-controls` is a sibling that paints after `#scene-stage` by DOM order, so controls remain interactive on top of the glass panel regardless of z-index comparison. Ghost-drift text (narration-layer) renders below credits — but by the time credits appear, ghost-drift text has already exited.

`#credits-panel` starts `hidden` + `opacity: 0`. Revealed by the post-narration trigger, not by `showFrame()`.

### 010.4.2 DOM Structure

```html
<section id="credits-panel" hidden aria-label="Credits">
  <div id="credits-backdrop" aria-hidden="true"></div>
  <div id="credits-scroll-content">
    <section class="credits-section">
      <h2 class="credits-heading"><!-- section heading --></h2>
      <p class="credits-text"><!-- content --></p>
    </section>
    <!-- repeat per section: bio, narration, music, audio, AI, testers, links -->
    <section class="credits-section">
      <a class="credits-link" href="..." target="_blank" rel="noopener"><!-- link text --></a>
    </section>
  </div>
</section>
```

`#credits-backdrop` is a child element that isolates `backdrop-filter` within the panel's opacity stacking context. This prevents backdrop-filter from rendering visibly while the panel is at `opacity: 0` — a known compositing bug in Safari and some Chrome versions.

### 010.4.3 CSS

```css
#credits-panel {
  position: absolute;
  inset: 8% 12%;
  overflow: clip; /* stronger than hidden — prevents GSAP-transformed children escaping */
  contain: paint; /* reinforces clip boundary across compositing layers */
  opacity: 0; /* GSAP fade-in after narration */
  mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 97%, transparent 100%);
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 8%,
    black 97%,
    transparent 100%
  );
  z-index: 7;
  border-radius: 12px;
  border: 1px solid rgba(232, 200, 120, 0.08);
}

/* Backdrop lives in a child element — see §010.4.2 */
#credits-backdrop {
  position: absolute;
  inset: 0;
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  background: rgba(0, 0, 0, 0.75);
}

#credits-scroll-content {
  position: relative;
  padding: 15% 12% 0;
  text-align: center;
}

.credits-heading {
  font-family: 'Lora', serif;
  font-weight: 300;
  color: rgba(232, 200, 120, 0.7);
  font-size: clamp(0.7rem, 1.4vw, 0.9rem);
  letter-spacing: 0.25em;
  text-transform: uppercase;
  margin-bottom: 1em;
}

.credits-text {
  font-family: 'Lora', serif;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.8);
  font-size: clamp(0.9rem, 2vw, 1.25rem);
  line-height: 1.9;
  margin-bottom: 0.6em;
}

.credits-link {
  color: rgba(232, 200, 120, 0.9); /* amber — trace glow color */
  text-decoration: none;
  border-bottom: 1px solid rgba(232, 200, 120, 0.35);
  transition: border-color 0.3s ease, color 0.3s ease;
}

.credits-link:hover,
.credits-link:focus-visible {
  color: rgba(232, 200, 120, 1);
  border-color: rgba(232, 200, 120, 0.8);
}
```

### 010.4.4 Reduced Motion

When `prefers-reduced-motion: reduce`:

- Credits panel appears instantly (no fade-in animation)
- Auto-scroll disabled — `overflow-y: auto` enabled, native scroll
- All content visible and accessible without animation
- Consistent with project-wide reduced motion approach (v5 §13)

---

## 010.5 Trigger — Post-Narration Timer Chain

### 010.5.1 How It Fires

The credits panel reveal hooks into the **existing** timer chain that already runs on every scene:

```
EXISTING CHAIN (all scenes):
  Howler narration onend
    → PausableTimer(holdAfterNarration)
      → setupAutoAdvance()
        → shouldAutoAdvance() → true → advance()
        [on credits frame: shouldAutoAdvance() → false → DEAD END]

MODIFIED CHAIN (credits frame only):
  Howler narration onend
    → makeNarrationEndCallback()
      → shouldAutoAdvance() → false
      → frame.credits exists → true
      → PausableTimer(holdAfterNarration: 3000ms)
        → revealCreditsPanel()  ← NEW
```

Same Howler `onend`. Same PausableTimer. Same generation guard. Same pause/resume semantics. One new conditional branch.

### 010.5.2 revealCreditsPanel()

```
revealCreditsPanel():
  1. Remove hidden from #credits-panel
  2. GSAP fade-in: opacity 0 → 1 over 500ms (tunable)
  3. Position #credits-scroll-content at translateY(panelHeight)
  4. Create GSAP scroll timeline (paused)
  5. On fade-in complete → play scroll timeline + attach scroll listeners
  6. Store timeline ref in module-private scrollTimeline
```

### 010.5.3 Timeline

By the time `revealCreditsPanel()` fires:

- Ghost-drift text has exited (exit timings are before narration `onend`)
- Narration audio has finished
- holdAfterNarration (3000ms) has elapsed
- End-song has been playing for 14+ seconds (entered at -12s offset, ramped 3s after narration)
- Shockwave effects are active (audio-reactive to end-song bass)
- Shimmer dots are walking

Clean handoff. No overlap.

---

## 010.6 Scroll Behavior

### 010.6.1 GSAP Auto-Scroll

```
scrollDurationMs = DEFAULT_CREDITS_DURATION_MS    // tunable, starting ~60s
scrollSpeed = contentHeight / scrollDurationMs

GSAP tween:
  target: #credits-scroll-content
  from: translateY(100%)         ← starts below visible area
  to: translateY(-(contentHeight))  ← scrolls past top
  duration: scrollDurationMs / 1000
  ease: "none"                   ← linear, film credits pacing
  repeat: -1                     ← infinite loop
  repeatDelay: 0.1               ← 100ms pause at loop point (tunable)
```

**Song is independent.** End-song loops (`loop: true`). Credits loop (`repeat: -1`). They run in parallel, decoupled. Scroll duration is based on comfortable reading speed (~35-45px/s), not song length. Both values are tunable.

### 010.6.2 Manual Override

```
ON WHEEL / TOUCH-DRAG inside #credits-panel:
  1. Pause GSAP timeline
  2. Scrub timeline position based on scroll delta
  3. Set resumeTimer (PausableTimer, 1500ms idle, tunable)

ON TOUCHCANCEL:
  Reset touch tracking state (same as touchend). Prevents stale
  lastTouchY when OS/browser cancels touch (interruptions, gesture
  arbitration). Uses the same handler ref as touchend.

ON RESUME TIMER FIRE:
  1. Resume GSAP timeline from current position
```

### 010.6.3 Focus/Hover Pause (WCAG 2.4.3 — mandatory)

Auto-scroll MUST pause when any `<a>` inside `#credits-panel` receives focus (Tab) or hover. Resume timer does NOT fire while a link has focus. Prevents focused link from scrolling off-screen.

"Manual interaction" includes: wheel, touch drag, click on link, focus on link. Resume timer resets on each interaction. Does not fire while pointer/focus is on any interactive element inside `#credits-panel`.

### 010.6.4 Credits Panel Entry Animation

Fade-in over 500ms (tunable). Fires after narration + holdAfterNarration — the scene is already fully revealed at this point (scene transition completed long before narration ended).

---

## 010.7 Integration with Existing Modules

### 010.7.1 app.js — makeNarrationEndCallback()

**Corrected from original draft:** The original draft specified hooking into `setupAutoAdvance()`, but `setupAutoAdvance()` is called from `showFrame()` at frame load time, `doResume()`, and `replayNarration()` — all of which would trigger credits prematurely before narration plays. The correct hook is `makeNarrationEndCallback()`, which fires only after Howler narration `onend`.

One conditional added to the existing dead end in `makeNarrationEndCallback()`:

```js
// After the existing shouldAutoAdvance check:
} else if (frame.credits) {
  app.creditsRevealTimer = new PausableTimer(() => {
    if (gen !== app.generation) return;
    app.creditsRevealTimer = null;
    revealCreditsPanel(app.els.creditsPanel, app.els.creditsScrollContent,
      frame.credits, { reducedMotion: prefersReducedMotion() });
  }, holdAfterNarration);
}
```

Uses `frame.credits` (data-driven config presence) rather than `frame.frameType === 'credits'` — consistent with the project convention "scene differences = config data in scenes.json, not if-blocks."

`revealCreditsPanel()` lives in a `credits.js` leaf module (implementation exceeds 60-line inline threshold).

### 010.7.2 text.js — No changes

Ghost-drift text plays normally during narration phase. By the time credits panel appears, all narration lines have exited. text.js doesn't know credits exist.

### 010.7.3 shimmer.js — No changes

Continues its rAF loop. Shimmer canvas renders below credits panel (z-index 7 > shimmer). Visible through `backdrop-filter` blur. 60 dots at opacity 0.6 will create nice ambient glow through the glass.

### 010.7.4 effects-canvas.js / effects.js — No changes

Shockwave (audio-reactive to end-song bass) + diamond glow persist. PixiJS ticker keeps running. Effects visible through the glass blur. Shockwave pulses will create subtle visual movement behind the text.

### 010.7.5 overlay.js — Button state on credits frame

```
ELEMENT          │ VISIBLE │ ENABLED │ BEHAVIOR
─────────────────┼─────────┼─────────┼──────────────────────────────
Progress dots    │ Yes     │ Yes     │ Frame 11 active. Back-nav works.
Back button      │ Yes     │ Yes     │ Navigate to frame 10.
Forward button   │ Yes     │ No      │ Disabled — CREDITS state blocks.
Play/Pause       │ Yes     │ Yes     │ Freezes EVERYTHING: scroll, music,
                 │         │         │ shimmer, effects. Links still clickable.
Replay button    │ Yes     │ Yes     │ Replays narration (frame 11 HAS narration).
                 │         │         │ Credits panel hides, narration replays,
                 │         │         │ credits re-triggered after narration ends.
Mute button      │ Yes     │ Yes     │ Mutes all audio, timeline continues.
Captions button  │ Yes     │ Yes     │ Frame 11 HAS captions.
```

**Replay edge case:** If viewer clicks Replay while credits are scrolling, the credits panel should hide (fade out or instant), narration replays from start, and the entire post-narration chain fires again — credits re-revealed after narration + holdAfterNarration. Same path, clean re-entry.

### 010.7.6 audio.js — No changes

Three audio cues already configured. `scheduleFrameAudio()` handles them. End-song loops. No new audio behavior.

### 010.7.7 scenes.json — Minimal change

```jsonc
// ADD to frame 11 definition:
"credits": {
  "scrollDuration": 65000,        // ms, tunable (starting point ~65s)
  "resumeDelay": 1500,            // ms idle before auto-scroll resumes
  "fadeInDuration": 500,          // ms for panel fade-in
  "repeatDelay": 100              // ms pause at loop point before restarting
}
```

`textMode` remains as-is — the ghost-drift text still plays during narration. The `credits` key is additive. No existing keys change.

---

## 010.8 Pause Interaction

**Decision: Freeze everything.** Matches existing PAUSED state model. No new pause variant.

```
STATE               │ SCROLL          │ MUSIC    │ SHIMMER  │ EFFECTS  │ LINKS
────────────────────┼─────────────────┼──────────┼──────────┼──────────┼────────
Playing             │ Auto-scrolling  │ Playing  │ Animate  │ Animate  │ Click ✓
Paused (play/pause) │ Frozen          │ Paused   │ Frozen   │ Frozen   │ Click ✓
Manual scroll       │ User-driven     │ Playing  │ Animate  │ Animate  │ Click ✓
Link focused/hovered│ Paused          │ Playing  │ Animate  │ Animate  │ Click ✓
Resume after manual │ Auto from pos   │ Playing  │ Animate  │ Animate  │ Click ✓
```

When paused: `pauseCreditsScroll()` alongside existing `shimmer.pause()`, `effects-canvas.pause()`, `audio.pauseAllCues()`. Resume restores all. The scroll timeline is module-private inside `credits.js` — `app.js` calls `pauseCreditsScroll()`/`resumeCreditsScroll()` rather than accessing the timeline directly.

Nav back then return to credits: **restart**. `showFrame()` rebuilds everything. Narration replays, credits re-triggered after narration.

---

## 010.9 Accessibility

- `#credits-panel` is a named landmark via `<section aria-label="Credits">` (implicit `region`)
- Links are native `<a>` with `target="_blank" rel="noopener"`
- Headings use `<h2>` for screen reader structure
- Auto-scroll pauses on link focus/hover (WCAG 2.4.3)
- `prefers-reduced-motion`: native overflow scroll, no animation
- Tab can reach links inside credits panel AND escape back to overlay controls (no focus trap — z-index layering means controls at z:10 remain tabbable above credits at z:7)
- Contrast: white text on `rgba(0,0,0,0.45)` + blurred warm background exceeds WCAG AA 4.5:1

---

## 010.10 Performance

```
CONCERN                 │ MITIGATION
────────────────────────┼──────────────────────────────────────────
backdrop-filter cost    │ GPU-composited. One element, fixed position.
                        │ Blur kernel on compositor thread.
────────────────────────┼──────────────────────────────────────────
GSAP timeline           │ Single tween (translateY), one element. ~0.
────────────────────────┼──────────────────────────────────────────
mask-image              │ CSS mask, computed once on layout.
────────────────────────┼──────────────────────────────────────────
Three active layers     │ Shimmer + effects + backdrop-filter all on GPU.
underneath blur         │ backdrop-filter composites from rasterized output,
                        │ does not force re-render of canvas layers.
────────────────────────┼──────────────────────────────────────────
Safari compositing      │ -webkit-mask-image + -webkit-backdrop-filter can
                        │ cause banding on Safari 16.0–16.1. Test 16.2+.
────────────────────────┼──────────────────────────────────────────
Audio failure            │ Credits panel still appears and scrolls even if
                        │ end-song fails. Timer chain fires from narration
                        │ onend, not from music state.
────────────────────────┼──────────────────────────────────────────
60fps target            │ Test on Pixel 3a class with all layers active:
                        │ shimmer (60 dots) + effects (shockwave + glow)
                        │ + backdrop-filter blur.
```

---

## 010.11 Credits Content

### 010.11.1 Confirmed Content

**Created & Narrated by**
Ashley Childress

If you made it this far, then thank you! I'm a senior software engineer from a small mining town in Southwest Virginia. I'm a backend engineer who's not in love with frontend work. I built this anyway—with a lot of AI wrangling—in my own voice and in a dialect most people have never heard spoken with pride. Some things are worth the tedious parts.

[See my other projects](https://anchildress1.dev/projects)
[DEV.to WeCoded Challenge 2026]()

**Early Testers**
"To everyone who took the time to give me early feedback—you made this better. Thank you!"

**End Theme**
["Break the Chain"](https://notimeforfun.bandcamp.com/track/break-the-chain) — The Bridge City Sinners
Bandcamp.com

**Sound Design**
All ambient audio sourced from [FreeSound.org](https://freesound.org):

- [Mining Maschine Cave Mine Factory Field-recording Fantasy 200726_0022_01_01](https://freesound.org/s/529032/) by szegvari — Creative Commons
- [Fabric flaps](https://freesound.org/s/580967/) by PelicanPolice — Creative Commons
- [Sauna fireplace loop](https://freesound.org/s/797669/) by HenKonen — Creative Commons
- [ticking watch clock midcentury travel alarm](https://freesound.org/s/508859/) by tenkism — CC0
- [water running](https://freesound.org/s/135003/) by hdrck16 — Attribution 3.0
- [Quartz crystal singing bowl](https://freesound.org/s/129219/) by juskiddink — Attribution 4.0
- [00182 little summer storm and rain 1](https://freesound.org/s/56143/) by Robinhood76 — Attribution NonCommercial 4.0
- [AMBForst_Autumn.A Quiet Forest.Wind In The Pines And Birches.Pine Creaking 1_EM](https://freesound.org/s/756754/) by newlocknew — Attribution 4.0
- [edge forest MONO 726AM 210221_0257](https://freesound.org/s/591158/) by klankbeeld — Attribution 4.0
- [Welding 1](https://freesound.org/s/586505/) by destin_yyy — Attribution 4.0
- [Glitching, Vinyl Record Player, A](https://freesound.org/s/427848/) by InspectorJ — Attribution 4.0

**AI Assistants**
Claude, ChatGPT, Codex, Antigravity, Gemini

**Image Generation**
Leonardo.ai, ChatGPT, Claude, GIMP

**Fonts**
Lora — Google Fonts (self-hosted variable font)

**Built With**
GSAP, PixiJS, Howler.js, Vite

**Challenge**
DEV.to WeCoded 2026

### 010.11.2 Still Needed (Ashley writes)

```
ITEM                    │ STATUS
────────────────────────┼──────────
Short bio               │ ✓ DONE
Website URL             │ ✓ DONE — https://anchildress1.dev
Blog submission link    │ TBD post-publish
Early testers thank-you │ ✓ DONE
```

### 010.11.3 License Compliance Note

Several FreeSound attributions require specific license types (Attribution 3.0, Attribution 4.0, Attribution NonCommercial 4.0). The credits display must include the author name and license type to satisfy these terms. The CC0 sound (tenkism) doesn't legally require attribution but is included for completeness.

**Resolved:** FreeSound links are clickable — sound name as hyperlink, author listed after (not clickable), license type displayed. Satisfies the "URI to licensed material" requirement for all CC license types. See §010.11.1 for formatted entries.

**Resolved:** Credits content lives in its own HTML file (not inline in `index.html`, not in `scenes.json`).

---

## 010.12 Resolved Decisions

All questions resolved:

```
QUESTION                                          │ DECISION
──────────────────────────────────────────────────┼──────────────────────────────────
credits.js leaf module vs inline in app.js?       │ Deferred to implementation —
                                                  │ depends on final line count (~60
                                                  │ line threshold for extraction)
Credits content location?                         │ Separate HTML file
FreeSound links clickable?                        │ Yes — sound name as hyperlink
Replay while credits visible?                     │ Hide panel, replay narration, re-trigger
Scroll duration starting point?                   │ 60s, tunable
Loop restart delay?                               │ 100ms, tunable
Include fonts/tech stack/challenge?               │ Yes to all
Freeze everything on pause?                       │ Yes (existing PAUSED model)
Links clickable while paused?                     │ Yes
Credits loop when scroll ends?                    │ Yes (repeat: -1)
Timer chain prevents ghost-drift/credits overlap? │ Yes — revealCreditsPanel() fires after
                                                  │ narration onend + holdAfterNarration
Frame 11 effects?                                 │ Confirmed — shockwave + diamond glow
Nav back + return = restart?                      │ Yes
```

---

## 010.13 Action Items

1. [x] Ashley: author credits content (bio, thank-you, music track name, FreeSound attributions)
2. [x] Ashley: provide website URL and Bandcamp link for Bridge City Sinners track
3. [x] Ashley: decide open questions (all resolved — see §010.12)
4. [x] Implement: `#credits-panel` in index.html + CSS in styles.css
5. [x] Implement: `revealCreditsPanel()` — hook into makeNarrationEndCallback (corrected from setupAutoAdvance)
6. [x] Implement: GSAP scroll timeline with `repeat: -1` (uses `gsap.fromTo` for reliable loop restart)
7. [x] Implement: manual scroll override + focus/hover pause (WCAG 2.4.3)
8. [x] Implement: replay edge case — hide credits, replay narration, re-trigger
9. [x] Implement: reduced motion fallback (overflow-y: auto)
10. [x] Implement: pause integration — isPaused flag blocks auto-resume, wheel scrub still works
11. [x] Test: Safari/WebKit compositing regression (`pnpm perf:runtime:adr11`, WebKit project)
12. [x] Test: Pixel 3a-class performance proxy (`pnpm perf:runtime:adr11`, Chromium with device + CPU emulation)
13. [x] Test: Tab focus through credits links during auto-scroll
14. [x] Test: Replay during credits scroll — clean re-entry
15. [x] Tune: blur radius, opacity, mask gradient, scroll speed against live scene

### 010.13.1 Validation Evidence (March 29, 2026)

- Added split ADR-011 perf coverage with:
  - `tests/perf/adr11-credits.webkit.spec.js`
  - `tests/perf/adr11-credits.chromium.spec.js`
  - WebKit compositing check for credits mask/backdrop stack and controls interactivity
  - Pixel-class proxy FPS check on credits frame under full layer load
- Added opt-in runtime command: `pnpm perf:runtime:adr11`
- Latest run result: `2 passed, 0 skipped`

**Note:** Physical Safari/Pixel hardware spot-checks are still useful before final release, but the ADR's previously unchecked regression targets now have automated coverage in repo.
