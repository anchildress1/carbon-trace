# Test Technical Debt

Adversarial test review findings deferred from `feat/trace-overlays`. These cover
modules and E2E tests NOT changed on that branch. Address on a dedicated test-debt branch.

---

## 1. `audio.js` / `audio.test.js`

### 1.1 Checkbox tests

| Test                                                              | Line | Problem                                                                                   | Action                                                                                    |
| ----------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| "onNarrationBufferChange registers callback"                      | 901  | Asserts `isNarrationBuffering()` is false — proves nothing about callback registration.   | Rewrite: register callback, trigger buffering, assert callback invoked with correct args. |
| "disconnectAnalyserSource clears analyser state"                  | 1430 | Only tests idempotency of a no-op. Never verifies node was nulled out.                    | Rewrite: call `getAnalyserNode()` after disconnect, assert a new instance is created.     |
| "cancelAudioCues drains crossfade cleanup on non-ambient entries" | 1362 | Asserts `unload` called but never verifies `_crossfadeCleanup` invoked. Title misleading. | Rewrite: assert `_crossfadeCleanup` was called.                                           |

### 1.2 Missing coverage

| Missing path                                                               | Source lines  | Severity | What to test                                                                   |
| -------------------------------------------------------------------------- | ------------- | -------- | ------------------------------------------------------------------------------ |
| `resolveCueEnters` with `audioDurations` containing 0 or negative duration | 209           | Edge     | `metaDuration > 0` branch when value is 0.                                     |
| `reloadFromPosition` when `isAudioPaused=true` (skips `node.play()`)       | 68–73         | High     | Assert `node.play()` NOT called when paused.                                   |
| `reloadFromPosition` when `node.play()` rejects                            | 69–71         | High     | Mock `play` to reject. Verify `.catch()` handles gracefully.                   |
| `crossfadeAmbientCue` error handler: verify `newHowl.unload()` called      | 340           | High     | Trigger `playerror`. Assert `newHowl.unload()`.                                |
| `crossfadeAmbientCue` error handler: verify `entry.state = 'error'`        | 351–354       | High     | Same trigger. Assert state and howl nulled.                                    |
| `wrapOnNarrationEndWithBoost` when `onNarrationEnd` is undefined           | 492           | Edge     | Pass undefined callback. Assert no throw via optional chaining.                |
| `setMuted` propagation to newly created cues after mute                    | 175, 288, 295 | Medium   | `setMuted(true)`, schedule new cue, verify Howl constructor gets `mute: true`. |
| `cancelCue` for narration type triggers buffer cleanup                     | 613           | Medium   | Cancel a narration cue. Assert `cleanupBufferMonitoring` called.               |
| `trimNarrationCache` with falsy items in `keepSrcs`                        | 193           | Edge     | Pass `[null, undefined, '', 'keep.m4a']`. Verify Boolean filter.               |
| `handleWaiting` when `narrationBuffering` is already true (early return)   | 117           | Edge     | Call twice. Assert callback not fired on second call.                          |
| `handlePlaying` when not buffering (early return)                          | 127           | Edge     | Call without prior `handleWaiting`. Assert no state change.                    |
| `getBufferedEnd` with `node.buffered.length === 0`                         | 38            | Edge     | Assert returns 0.                                                              |

### 1.3 Reliability issues

| Issue                                                                                                       | Impact                                                                    | Fix                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| Shared mutable `mockNode` (lines 5–13): `buffered.length`, `currentTime`, `src` not reset in `beforeEach`   | State leaks between tests. Line 1148 sets `currentTime = 4`, never reset. | Reset all `mockNode` properties in `beforeEach`. |
| `lastHowlOptions` is module-level mutable state, never reset                                                | Line 888 relies on it. Test order change could reference wrong instance.  | Reset in `beforeEach`.                           |
| Multiple top-level `describe` blocks with duplicated `beforeEach` (lines 101, 1003, 1188, 1240, 1275, 1391) | Drift risk if one block's cleanup diverges.                               | Consolidate to single file-level `beforeEach`.   |

### 1.4 Mock problems

| Problem                                                                           | Impact                                                                                                                                                                          | Fix                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `createMockHowlInstance().volume()` always returns `0.15`                         | All crossfade assertions (lines 403, 427, 447, 473, 1343) pass on hardcoded value, not actual state.                                                                            | Make `volume()` track state — return last `fade()` target or constructor volume. |
| `Howl` mock pre-attaches `_crossfadeCleanup`/`_crossfadePause`/`_crossfadeResume` | Source overwrites these dynamically. If source ever checks `if (!howl._crossfadeCleanup)`, mock stubs mask the bug.                                                             | Remove pre-attached stubs. Let source attach them.                               |
| `mockNode.play` never rejects by default                                          | `.catch()` paths in `checkBufferProgress` (92–94) and `reloadFromPosition` (69–71) only tested when explicitly overridden. `reloadFromPosition` `.catch()` never tested at all. | Add explicit rejection tests.                                                    |

---

## 2. `canvas.js` / `canvas.test.js`

### 2.1 Checkbox tests

| Test                                   | Line | Problem                                                                                | Action                                                          |
| -------------------------------------- | ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| "draws image with cover-fit to canvas" | 131  | Asserts `drawImage` called but never verifies arguments.                               | Rewrite: assert `drawImage` args match expected cover-fit crop. |
| "redraws on resize"                    | 152  | Asserts `drawImage` called after resize but never verifies `sizeCanvas()` also called. | Rewrite: assert canvas dimensions recalculated before draw.     |

### 2.2 Missing coverage

| Missing path                                                          | Source lines | Severity | What to test                                                          |
| --------------------------------------------------------------------- | ------------ | -------- | --------------------------------------------------------------------- |
| `coverFit` with `img.width` fallback (no `naturalWidth`)              | 36–37        | Medium   | Pass image with `naturalWidth=0, width=1920`. Verify fallback.        |
| `sizeCanvas` DPR verification (`resetTransform`/`scale` args)         | 29–32        | Medium   | Assert `ctx.scale(dpr, dpr)` with correct DPR value.                  |
| `loadImage` concurrent deduplication — only one Image created         | 135–151      | Edge     | Call `loadImage` twice simultaneously. Assert only one `new Image()`. |
| `drawCurrent` after `destroySceneCanvas` (ctx and canvasEl both null) | 60           | Edge     | Destroy canvas, trigger resize observer callback, verify no throw.    |
| Non-16:9 canvas dimensions in cover-fit tests                         | 35–57        | Edge     | Test with 4:3 and ultrawide aspect ratios.                            |
| `coverFit` verify `sw`/`sh`/`dw`/`dh` (not just `sx`/`sy`)            | 44–57        | Medium   | Assert all 8 drawImage args, not just source offsets.                 |

### 2.3 Reliability issues

| Issue                                                                          | Impact                                                                                       | Fix                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `vi.useFakeTimers()` called inside test bodies (line 226), not in `beforeEach` | If test fails between `useFakeTimers()` and `useRealTimers()`, timers leak.                  | Move timer management to `beforeEach`/`afterEach`. |
| `ResizeObserver` mock callback invoked with no arguments                       | Real `ResizeObserver` passes entries. Works by accident since `drawCurrent` ignores entries. | Pass mock entries for realism.                     |
| `getBoundingClientRect` mock returns fixed 1920x1080                           | No test varies canvas size.                                                                  | Parameterize for different viewport sizes.         |

---

## 3. `captions.js` / `captions.test.js`

### 3.1 Missing coverage

| Missing path                                                                      | Source lines | Severity | What to test                                                                                            |
| --------------------------------------------------------------------------------- | ------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `setCaptionsEnabled(true)` + localStorage throws: verify in-memory state survives | 16–21        | Medium   | Call `setCaptionsEnabled(true)` with broken localStorage. Assert `areCaptionsEnabled()` returns `true`. |
| `syncCaptionsToTime` with entries that have existing `el` NOT in the DOM          | 48–50        | Edge     | Create entry with `el` pointing to detached node. Verify cleanup.                                       |

---

## 4. `loader.js` / `loader.test.js`

### 4.1 Checkbox tests

| Test                                   | Line | Problem                                                                         | Action                                                                              |
| -------------------------------------- | ---- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| "calls onLoaded for each audio source" | 139  | Asserts `onLoaded` called twice but never checks payload (`{ src, duration }`). | Rewrite: assert `onLoaded` called with correct `{ src, duration }` for each source. |

### 4.2 Missing coverage

| Missing path                                                                    | Source lines | Severity | What to test                                                                                          |
| ------------------------------------------------------------------------------- | ------------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `preloadAudio` cleanup verification after successful metadata load              | 30–34        | Medium   | After successful load, assert `audio.onloadedmetadata`, `audio.onerror`, `audio.src` nulled.          |
| `preloadAudio` with `audio.duration = NaN` or `undefined`                       | 32           | Edge     | Assert fallback to `0`.                                                                               |
| `preloadFirstFrameAudio` `.catch()` is dead code (`preloadAudio` never rejects) | 57           | High     | **Bug/dead code.** Either make `preloadAudio` capable of rejecting, or remove unreachable `.catch()`. |
| `preloadBackgroundAudio` sequential loading verification                        | 65–72        | Medium   | Assert frame N+1 audio doesn't start loading until frame N finishes.                                  |
| `audioSrcsFromEntry` with cue objects missing `src` property entirely           | 48           | Edge     | Pass `[{}]`. Verify filtered out.                                                                     |

### 4.3 Mock problems

| Problem                                                                         | Impact                                                                                | Fix                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `preloadFirstFrameAudio` error test (line 170) exercises timeout, not rejection | Title says "catches and warns when promise rejects" but `preloadAudio` never rejects. | Fix title or fix the dead `.catch()` in source. |

---

## 5. `effects.js` / `effects.test.js`

### 5.1 Checkbox tests

| Test                                                    | Line | Problem                                                        | Action                                            |
| ------------------------------------------------------- | ---- | -------------------------------------------------------------- | ------------------------------------------------- |
| "uses default params when none provided" (water)        | 167  | Only asserts `result !== null`. Never verifies default values. | Rewrite: assert `direction=90`, `speed=0.6`, etc. |
| "uses default params when none provided" (dust)         | 175  | Same.                                                          | Rewrite: assert default intensity, speed.         |
| "uses default params when none provided" (heat)         | 183  | Same.                                                          | Rewrite: assert default params.                   |
| "creates a glow effect with filter and update function" | 203  | Existence-only check.                                          | Rewrite: verify GlowFilter constructor args.      |
| "glow effect uses default params"                       | 222  | Existence-only.                                                | Rewrite: verify defaults.                         |
| "creates a shockwave effect"                            | 229  | Existence-only.                                                | Rewrite: verify ShockwaveFilter constructor args. |

### 5.2 Missing coverage

| Missing path                                                                      | Severity | What to test                                                         |
| --------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `registerEffect` with non-string type (number, boolean, null, undefined)          | Medium   | Assert throws for each. Only empty string currently tested.          |
| `registerEffect` overwriting existing type (silent overwrite)                     | Medium   | Register same type twice. Assert second factory replaces first.      |
| `createEffect` when factory function throws                                       | High     | Register factory that throws. Assert error propagates.               |
| Water effect `direction` math verification (direction=90 should move purely in Y) | Medium   | Call `update()`, assert `sprite.y` changed and `sprite.x` unchanged. |
| Dust oscillation pattern — multiple `update()` calls verify sinusoidal movement   | Medium   | Call `update()` N times. Assert position oscillates.                 |
| Glow `knockout` and `alpha` params passed correctly                               | Low      | Assert GlowFilter constructor receives correct knockout/alpha.       |
| Shockwave `filter.time = cycleDuration` initialization for autoRepeat             | Low      | Assert `filter.time` set on construction.                            |
| Shockwave with `cycleDuration=0` (division edge case)                             | Edge     | Assert no division error.                                            |
| Negative parameter values (negative speed, negative intensity)                    | Edge     | Assert behavior or rejection.                                        |

### 5.3 Reliability issues

| Issue                                                                          | Impact                                                                                                           | Fix                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `factories` registry leaks between tests                                       | `'custom'` effect registered at line 91 persists forever. `vi.clearAllMocks()` does not clean object registries. | Use `vi.resetModules()` + dynamic re-import in `beforeEach`, or add a `clearFactories()` test helper. |
| `DisplacementFilter` mock `scale` property doesn't match real PixiJS signature | Mock diverges from reality. Could hide integration bugs.                                                         | Align mock with actual PixiJS `DisplacementFilter` API.                                               |

---

## 6. `keyboard.js` / `keyboard.test.js`

### 6.1 Missing coverage

| Missing path                                                                  | Severity | What to test                                                                      |
| ----------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `e.target` is a non-Element, non-null object (plain object `{}` or text node) | Low      | Dispatch event with `target: {}`. Assert `instanceof Element` guard works.        |
| Repeat key events (`KeyboardEvent` with `repeat: true`)                       | Low      | Hold-key scenario. Assert handler fires (or document that repeat is intentional). |
| `initKeyboard` called multiple times without cleanup (stacks listeners)       | Medium   | Init twice. Assert handler fires only once per keypress.                          |

### 6.2 Reliability issues

| Issue                                                                        | Impact                                | Fix                                          |
| ---------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| `makeButton`/`makeSvgInsideButton` append to `document.body` without cleanup | DOM elements accumulate across tests. | Add `afterEach` that clears `document.body`. |

---

## 7. `overlay.js` / `overlay.test.js`

### 7.1 Checkbox tests

| Test                                                            | Line | Problem                                              | Action                                                             |
| --------------------------------------------------------------- | ---- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| "returns early when progress-dots container is missing"         | 83   | Only checks "does not throw." No state verification. | Rewrite: assert `dotElements` stays empty, no listener added.      |
| "creates dots without click handler when onDotClick is omitted" | 89   | Only checks "click doesn't throw."                   | Rewrite: assert `setRovingTarget` still called, dot index updates. |
| "handles being called before initOverlay without throwing"      | 159  | Only checks no-throw.                                | Rewrite: assert `currentSceneIndex` remains -1, no DOM changes.    |

### 7.2 Missing coverage

| Missing path                                            | Source lines | Severity | What to test                                                   |
| ------------------------------------------------------- | ------------ | -------- | -------------------------------------------------------------- |
| `updateProgress` same-index skip (first branch)         | 74           | High     | Call `updateProgress(3)` twice. Assert second call is a no-op. |
| `updateProgress` backward navigation (scene 4 to 2)     | 96–102       | High     | Assert dots between 4 and 2 become inactive.                   |
| `setRovingTarget` out-of-bounds index                   | 6–7          | Medium   | Pass index >= `dotElements.length`. Assert early return.       |
| `initOverlay` re-init removes old keydown listener      | 47           | Medium   | Init twice. Assert old container's listener no longer fires.   |
| `focusActiveDot` when `sceneIndex > dotElements.length` | 111          | Low      | Assert no-op.                                                  |
| Click handler `stopPropagation`                         | 60           | Low      | Assert `e.stopPropagation()` called on dot click.              |
| `updateProgress` with negative `sceneIndex`             | —            | Edge     | Assert no crash.                                               |
| `initOverlay(1)` — single dot, wrapping behavior        | —            | Edge     | Arrow keys on single dot. Assert no index change.              |

### 7.3 Reliability issues

| Issue                                                                           | Impact                                                                   | Fix                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Module-level `dotElements` array persists across tests pointing to detached DOM | Tests that skip `initOverlay` operate on stale state from previous test. | Call `initOverlay` or reset module in every test's `beforeEach`. |

---

## 8. `text.js` / `text.test.js`

### 8.1 Checkbox tests

| Test                                 | Line | Problem                                                                                     | Action              |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------- | ------------------- |
| "creates timeline paused by default" | 125  | Overlaps with test at line 111. Only checks `gsap.timeline` called with `{ paused: true }`. | Remove (redundant). |

### 8.2 Missing coverage

| Missing path                                                                    | Source lines | Severity     | What to test                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Caption show callback called twice (duplicate-caption guard)                    | 84–87        | **Critical** | Source comments warn this bug has been "reintroduced multiple times." Call show callback twice. Assert first `el` removed before second created. |
| `createLineElement` with partial coordinates (`x:10, y:null` or `x:null, y:10`) | 10           | Medium       | Assert four-way guard works for each partial combination.                                                                                        |
| `isCaptionEnabled` not provided (undefined)                                     | 83           | Medium       | Build narration timeline without `isCaptionEnabled`. Assert caption shows unconditionally.                                                       |
| `captions: []` (empty array)                                                    | 68           | Low          | Assert no callbacks placed on timeline.                                                                                                          |
| `captions: null` or non-array                                                   | 68           | Low          | Assert `Array.isArray` guard prevents crash.                                                                                                     |
| Negative `enter`/`exit` values                                                  | —            | Edge         | Assert behavior or error with invalid timeline positions.                                                                                        |
| `captionDelay` default (0)                                                      | 31           | Low          | Omit `captionDelay`. Assert `start/1000` used without offset.                                                                                    |

### 8.3 Mock problems

| Problem                                                     | Impact                                           | Fix                                                   |
| ----------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| GSAP timeline mock is a shared singleton (lines 4–8)        | Properties set on the mock persist across tests. | Return a fresh mock from `gsap.timeline()` each call. |
| Mock `fromTo`/`to`/`call` don't validate position parameter | Negative positions accepted silently.            | Add position validation or test explicitly.           |

---

## 9. `pausable-timer.js` / `pausable-timer.test.js`

### 9.1 Missing coverage

| Missing path                                                             | Severity | What to test                                                                      |
| ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| Callback that throws during fire                                         | Medium   | Assert error propagates. Verify timer internal state after throw.                 |
| Zero delay (`new PausableTimer(cb, 0)`)                                  | Low      | Assert fires on next tick.                                                        |
| `isActive`/`isPaused` state after immediate-fire resume (remaining <= 0) | Low      | Pause, advance past delay, resume. Assert both return false after immediate fire. |
| Callback calls `cancel()` or `pause()` on its own timer                  | Edge     | Assert no infinite loop or invalid state.                                         |
| Very large delay values (`Number.MAX_SAFE_INTEGER`)                      | Edge     | Assert no overflow.                                                               |

### 9.2 Reliability issues

| Issue                                                                              | Impact                                                                  | Fix                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `vi.useFakeTimers()` + `vi.spyOn(Date, 'now')` layering (lines 123, 142, 250, 287) | Works today but fragile if Vitest changes fake timer ↔ spy interaction. | Document the pattern or use only one mechanism. |

---

## 10. E2E tests — cross-repo issues

### 10.1 Checkbox / duplicate tests — remove or consolidate

| Test                                          | File:Line                | Problem                                                  |
| --------------------------------------------- | ------------------------ | -------------------------------------------------------- |
| "has accessible narration region"             | narrative.spec.js:39     | Static `aria-live` attribute check — unit test material. |
| "scene canvas is aria-hidden"                 | narrative.spec.js:220    | Static attribute.                                        |
| "caption-layer has aria-hidden"               | narrative.spec.js:451    | Static attribute.                                        |
| "has CSP meta tag"                            | narrative.spec.js:135    | Static HTML — belongs in Lighthouse or unit test.        |
| "scene stage has description on initial load" | narrative.spec.js:200    | Asserts `label.length > 0` — weakest possible assertion. |
| "pause button is visible after loading"       | narrative.spec.js:393    | Pure visibility check, no interaction.                   |
| "replay button is disabled before first play" | narrative.spec.js:146    | Initial DOM state, no interaction.                       |
| "dot count matches scene count"               | keyboard-nav.spec.js:581 | **Duplicate** of narrative.spec.js:304.                  |
| "accessible-narration live region exists"     | keyboard-nav.spec.js:699 | **Duplicate** of narrative.spec.js:39.                   |
| "progress dots are button elements"           | keyboard-nav.spec.js:673 | Static tagName check.                                    |
| "progress dots have title attributes"         | keyboard-nav.spec.js:663 | Static attribute check.                                  |
| "prev button disabled on first frame"         | keyboard-nav.spec.js:237 | **Duplicate** of narrative.spec.js:103.                  |

### 10.2 Missing E2E scenarios

| Scenario                                                   | Priority | What to verify                                                                        |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| Full auto-advance playback (timer-driven scene transition) | High     | Let narrative auto-advance through at least one scene. Verify frame index changes.    |
| Ghost-drift text animation renders and removes             | High     | Navigate to a scene. Assert narration text appears then fades.                        |
| Audio mute actually stops output (not just label toggle)   | High     | Current test bypasses `aria-disabled` via `page.evaluate()` — not real user behavior. |
| Ambient audio crossfade between scenes                     | Medium   | Navigate. Verify no audio gap or overlap.                                             |
| Narration audio starts after `enter` delay                 | Medium   | Every scene has `"enter": 500`. Verify timing.                                        |
| Caption text changes when scene advances                   | Medium   | Enable captions. Advance. Assert new caption text matches scene config.               |
| Captions disappear when disabled                           | Medium   | Enable, verify visible. Disable, verify hidden.                                       |
| Asset load failure (image, audio)                          | Medium   | Intercept network request. Verify graceful degradation.                               |
| Page reload mid-experience                                 | Medium   | Reload mid-narrative. Verify clean restart from beginning.                            |
| Title frame narration word sequence                        | Low      | Verify "buried" → "carbon" → "mine" → "started" sequence.                             |
| Mobile touch interactions                                  | Low      | Config includes `mobile-chrome` but zero mobile-specific tests exist.                 |

### 10.3 Reliability issues

| Issue                                                          | Location                 | Impact                                                                                        | Fix                                                                                         |
| -------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 15 hardcoded `waitForTimeout` calls (200–1000ms)               | Both spec files          | Every one is a flake risk on slow CI.                                                         | Replace with `waitForSelector`, `expect.poll`, or the existing `advanceByKeyboard` pattern. |
| Mute button test bypasses real UI                              | narrative.spec.js:270    | `page.evaluate()` removes `aria-disabled` before clicking. Tests impossible user action.      | Test the real enable/disable flow.                                                          |
| "rapid alternating ArrowRight/ArrowLeft" only checks no errors | keyboard-nav.spec.js:437 | No assertion on final frame, dot state, or UI consistency.                                    | Assert landing frame and dot bar state.                                                     |
| "pause/unpause + navigation" only checks no errors             | keyboard-nav.spec.js:759 | Same gap.                                                                                     | Assert final state.                                                                         |
| "unpause then navigate transitions animated"                   | keyboard-nav.spec.js:514 | Claims to test animated transition but only checks `aria-label`. No opacity/timing assertion. | Rename or add animation assertion.                                                          |
| "clicking replay does not advance"                             | narrative.spec.js:167    | Checks label unchanged but not that replay actually replayed.                                 | Assert narration text reset or audio restart.                                               |
| "rapid next-button clicks land on correct frame"               | narrative.spec.js:514    | 5 clicks from frame 0 should land on frame 5 — fragile if coalescing occurs.                  | Verify intermediate state or document expected coalescing behavior.                         |

---

## 11. Cross-cutting mock issues

| Module                   | Problem                                                                             | Fix                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `app.test.js`            | `gsap.to` mock calls `onComplete` synchronously — eliminates TRANSITIONING state    | Default should NOT auto-complete. Tests that need it should trigger explicitly. |
| `app.test.js`            | Mock audio module includes stale exports not in real API                            | Audit against `src/audio.js`. Remove stale entries.                             |
| `effects-canvas.test.js` | `Application` mock resolves `init()` synchronously — `initPromise` guard untestable | Make `init()` return a deferred promise.                                        |
| `effects-canvas.test.js` | `globalThis.Image` set via direct assignment, not `vi.stubGlobal`                   | `vi.restoreAllMocks()` cannot restore it. Use `vi.stubGlobal`.                  |
| `effects.test.js`        | `DisplacementFilter` mock `scale` diverges from real PixiJS                         | Align with actual API.                                                          |
| `effects.test.js`        | `GlowFilter` mock missing `knockout`, `alpha` fields                                | Add them.                                                                       |
