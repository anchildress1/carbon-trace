import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenesData = JSON.parse(readFileSync(resolve(__dirname, '../../src/scenes.json'), 'utf8'));
const TOTAL_FRAMES = scenesData.frames.length;
const SCENE_COUNT = scenesData.frames.filter(
  (f) => f.frameType === 'title' || f.frameType === 'scene' || f.frameType === 'credits',
).length;

function frameDescription(index) {
  return scenesData.frames[index]?.description || '';
}

function narrationSrcForFrame(index) {
  return (
    scenesData.frames[index]?.audioCues?.find((cue) => cue.type === 'narration')?.src || null
  );
}

function imageSrcForFrame(index) {
  return scenesData.frames[index]?.image || null;
}

function fileNameFromAssetPath(assetPath) {
  if (!assetPath) return '';
  return assetPath.split('/').pop() || '';
}

async function dismissLoadingScreen(page) {
  await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#loading-screen');
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 3000 });
}

async function advanceByKeyboard(page, count, startIndex = 0) {
  const stage = page.locator('#scene-stage');
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(startIndex + i + 1), {
      timeout: 5000,
    });
  }
}

async function jumpToFrameByDot(page, frameIndex) {
  await page.locator('.progress-dot').nth(frameIndex).click();
  await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(frameIndex), {
    timeout: 5000,
  });
}

async function dispatchNarrationEnded(page) {
  const beforeState = await page.evaluate(() => {
    if (typeof globalThis.__ctE2EApp?.forceNarrationEndForTesting !== 'function') {
      throw new TypeError('E2E app harness missing forceNarrationEndForTesting');
    }
    const before = globalThis.__ctE2EApp._debugCreditsState?.() ?? 'no debug';
    globalThis.__ctE2EApp.forceNarrationEndForTesting();
    const after = globalThis.__ctE2EApp._debugCreditsState?.() ?? 'no debug';
    return { before, after };
  });
  if (process.env.DEBUG_E2E) {
    // eslint-disable-next-line no-console
    console.log('[E2E] dispatchNarrationEnded state:', JSON.stringify(beforeState));
  }
}

async function waitForCreditsVisible(page, panel, timeout = 25_000) {
  try {
    await expect(panel).toBeVisible({ timeout });
  } catch (err) {
    const state = await page.evaluate(
      () => globalThis.__ctE2EApp?._debugCreditsState?.() ?? 'no debug',
    );
    const stateStr = JSON.stringify(state);
    // eslint-disable-next-line no-console
    console.error('[E2E] Credits panel not visible! App state:', stateStr);
    err.message += `\n\n[E2E DIAG] App state at timeout: ${stateStr}`;
    throw err;
  }
}

async function getCreditsTranslateY(page) {
  return page.locator('#credits-scroll-content').evaluate((el) => {
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === 'none') return 0;
    return new DOMMatrixReadOnly(transform).m42;
  });
}

test.describe('carbon-trace narrative', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows loading screen initially then scene stage', async ({ page }) => {
    const sceneStage = page.locator('#scene-stage');
    await expect(sceneStage).toBeVisible({ timeout: 15000 });
  });

  test('displays progress dots for narrative scenes', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const dots = page.locator('.progress-dot');
    await expect(dots).toHaveCount(SCENE_COUNT);
  });

  test('has accessible narration region', async ({ page }) => {
    const liveRegion = page.locator('#accessible-narration');
    await expect(liveRegion).toHaveAttribute('aria-live', 'polite');
  });

  test('shows mute button', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const muteBtn = page.locator('#btn-mute');
    await expect(muteBtn).toBeVisible();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Mute audio');
  });

  test('clicking scene area does not advance the scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Pause so btn-next triggers an instant hard-cut transition.
    await page.click('#btn-pause');
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // Click the stage area multiple times — none should advance
    await page.click('#scene-stage');
    await page.click('#scene-stage');
    await page.click('#scene-stage');

    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 3000 });
  });

  test('forward button advances scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('Space toggles pause instead of advancing', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const pauseBtn = page.locator('#btn-pause');
    // Starts paused
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Space unpauses
    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    // Space pauses again
    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Scene did not advance — still on title
    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');
    expect(label).toBe(frameDescription(0));
  });

  test('previous button is disabled on first frame', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const prevBtn = page.locator('#btn-prev');
    await expect(prevBtn).toBeDisabled();
  });

  test('previous button navigates back after advancing', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.click('#btn-prev');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });
  });

  test('ArrowLeft navigates back after advancing', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.keyboard.press('ArrowRight');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.keyboard.press('ArrowLeft');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });
  });

  test('has Content-Security-Policy meta tag with required directives', async ({ page }) => {
    const csp = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(csp).toHaveCount(1);

    const content = await csp.getAttribute('content');
    expect(content).toContain("default-src 'self'");
    expect(content).toContain("script-src 'self'");
    expect(content).toContain("object-src 'none'");
    expect(content).toContain("connect-src 'none'");
  });

  test('replay button is disabled before first play', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeDisabled();
  });

  test('replay button is enabled after playing narration scene', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene-01 (has narration audio)
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeEnabled();
  });

  test('clicking replay button does not advance the scene', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene-01 so replay is enabled
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const labelBefore = await stage.getAttribute('aria-label');
    await page.click('#btn-replay');
    const labelAfter = await stage.getAttribute('aria-label');
    expect(labelAfter).toBe(labelBefore);
  });

  test('clicking replay restores narration text elements', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene-01 so replay is enabled
    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(1), {
      timeout: 5000,
    });

    await page.click('#btn-replay');

    const lines = page.locator('.narration-line');
    await expect(lines).not.toHaveCount(0);
  });

  test('scene stage has description on initial load', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0));
  });

  test('scene stage description changes when scene advances', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    const initialLabel = await stage.getAttribute('aria-label');

    await page.click('#btn-next');

    await expect(stage).not.toHaveAttribute('aria-label', initialLabel, { timeout: 5000 });
  });

  test('scene canvas is present and aria-hidden', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const canvas = page.locator('#scene-canvas');
    await expect(canvas).toHaveAttribute('aria-hidden', 'true');
  });

  test('forward button is disabled on credits frame', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Pause so each ArrowRight triggers an instant hard-jump (no fade animation).
    await page.keyboard.press('Space');

    await advanceByKeyboard(page, TOTAL_FRAMES - 1);

    const nextBtn = page.locator('#btn-next');
    await expect(nextBtn).toBeDisabled();
  });

  test('progress dots gain active class as scenes advance', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const firstDot = page.locator('.progress-dot').first();
    const secondDot = page.locator('.progress-dot').nth(1);
    const thirdDot = page.locator('.progress-dot').nth(2);

    // Title frame is scene index 1 — first dot active initially
    await expect(firstDot).toHaveClass(/active/);
    await expect(secondDot).not.toHaveClass(/active/);

    // Advance to scene 01 — first and second dots active
    await page.click('#btn-next');
    await expect(firstDot).toHaveClass(/active/);
    await expect(secondDot).toHaveClass(/active/);
    await expect(thirdDot).not.toHaveClass(/active/);
  });

  test('mute button aria-label toggles between mute and unmute', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const muteBtn = page.locator('#btn-mute');
    await expect(muteBtn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10000 });

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Unmute audio');

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Mute audio');
  });
});

test.describe('carbon-trace — credits overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('credits panel is a named region landmark', async ({ page }) => {
    // <section aria-label="Credits"> has implicit ARIA role="region" when named;
    // use locator to verify element type since hidden elements are not reachable via getByRole
    const panel = page.locator('section#credits-panel');
    await expect(panel).toHaveAttribute('aria-label', 'Credits');
  });

  // eslint-disable-next-line playwright/no-skipped-test -- wall-clock timing precision test; setTimeout(10s) + waitForTimeout(9.3s) are both unreliable on resource-constrained CI runners (main-thread starvation from rAF loops)
  (process.env.CI ? test.skip : test)('credits reveal waits for the final-frame holdAfterNarration delay', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const creditsFrameIndex = TOTAL_FRAMES - 1;
    const expectedRevealDelayMs = 10000;
    const revealEarlyProbeMs = 700;

    expect(scenesData.frames[creditsFrameIndex]?.holdAfterNarration).toBe(expectedRevealDelayMs);

    await jumpToFrameByDot(page, creditsFrameIndex);
    await dispatchNarrationEnded(page);

    const panel = page.locator('#credits-panel');

    await page.waitForTimeout(expectedRevealDelayMs - revealEarlyProbeMs);
    await expect(panel).toBeHidden();

    await expect(panel).toBeVisible({ timeout: revealEarlyProbeMs + 1500 });
  });

  test('credits auto-scroll pauses on focused link and resumes after focus leaves', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const creditsFrameIndex = TOTAL_FRAMES - 1;
    await jumpToFrameByDot(page, creditsFrameIndex);
    await dispatchNarrationEnded(page);

    const panel = page.locator('#credits-panel');
    await waitForCreditsVisible(page, panel);
    await page.waitForTimeout(800);

    const movingY1 = await getCreditsTranslateY(page);
    await page.waitForTimeout(800);
    const movingY2 = await getCreditsTranslateY(page);
    expect(Math.abs(movingY2 - movingY1)).toBeGreaterThan(1);

    const firstLink = page.locator('#credits-panel a').first();
    await firstLink.focus();
    const pausedY1 = await getCreditsTranslateY(page);
    await page.waitForTimeout(2200);
    const pausedY2 = await getCreditsTranslateY(page);
    expect(Math.abs(pausedY2 - pausedY1)).toBeLessThan(0.75);

    await page.locator('#btn-pause').focus();
    const resumedY1 = await getCreditsTranslateY(page);
    await page.waitForTimeout(2200);
    const resumedY2 = await getCreditsTranslateY(page);
    expect(Math.abs(resumedY2 - resumedY1)).toBeGreaterThan(1);
  });

  test('replay while credits are visible hides panel and re-reveals after narration end', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const creditsFrameIndex = TOTAL_FRAMES - 1;
    await jumpToFrameByDot(page, creditsFrameIndex);
    await dispatchNarrationEnded(page);

    const panel = page.locator('#credits-panel');
    await waitForCreditsVisible(page, panel);

    await page.click('#btn-replay');
    await expect(panel).toBeHidden({ timeout: 2000 });

    await dispatchNarrationEnded(page);
    await waitForCreditsVisible(page, panel);
  });

  test('touch drag pauses auto-scroll and resumes after delay', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const creditsFrameIndex = TOTAL_FRAMES - 1;
    await jumpToFrameByDot(page, creditsFrameIndex);
    await dispatchNarrationEnded(page);

    const panel = page.locator('#credits-panel');
    await waitForCreditsVisible(page, panel);
    await page.waitForTimeout(800);

    // Verify auto-scroll is active
    const movingY1 = await getCreditsTranslateY(page);
    await page.waitForTimeout(800);
    const movingY2 = await getCreditsTranslateY(page);
    expect(Math.abs(movingY2 - movingY1)).toBeGreaterThan(1);

    // Perform touch drag via real TouchEvent dispatch
    await page.evaluate(() => {
      const el = document.querySelector('#credits-panel');
      const dispatchTouch = (type, clientY) => {
        const touchInit =
          type === 'touchend' || type === 'touchcancel'
            ? { bubbles: true, cancelable: true, touches: [], changedTouches: [] }
            : {
                bubbles: true,
                cancelable: true,
                touches: [new Touch({ identifier: 0, target: el, clientX: 100, clientY })],
                changedTouches: [new Touch({ identifier: 0, target: el, clientX: 100, clientY })],
              };
        el.dispatchEvent(new TouchEvent(type, touchInit));
      };
      dispatchTouch('touchstart', 300);
      dispatchTouch('touchmove', 200);
      dispatchTouch('touchend', 200);
    });

    // After touch drag, auto-scroll should be paused (resume timer pending)
    const pausedY1 = await getCreditsTranslateY(page);
    await page.waitForTimeout(500);
    const pausedY2 = await getCreditsTranslateY(page);
    expect(Math.abs(pausedY2 - pausedY1)).toBeLessThan(1);

    // Wait for resumeDelay (1500ms from scenes.json) + buffer
    await page.waitForTimeout(1500);
    const resumedY1 = await getCreditsTranslateY(page);
    await page.waitForTimeout(800);
    const resumedY2 = await getCreditsTranslateY(page);
    expect(Math.abs(resumedY2 - resumedY1)).toBeGreaterThan(1);
  });

  test('reduced-motion revisit clears stale transform state', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const creditsFrameIndex = TOTAL_FRAMES - 1;
    const prevFrameIndex = TOTAL_FRAMES - 2;

    await jumpToFrameByDot(page, creditsFrameIndex);
    await dispatchNarrationEnded(page);
    await waitForCreditsVisible(page, page.locator('#credits-panel'));

    await page.waitForTimeout(800);
    const firstTransform = await page
      .locator('#credits-scroll-content')
      .evaluate((el) => getComputedStyle(el).transform);
    expect(firstTransform).not.toBe('none');

    await page.click('#btn-prev');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(prevFrameIndex), {
      timeout: 5000,
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await jumpToFrameByDot(page, creditsFrameIndex);
    await dispatchNarrationEnded(page);
    await expect(page.locator('#credits-panel')).toBeVisible({ timeout: 25_000 });

    const revisitTransform = await page
      .locator('#credits-scroll-content')
      .evaluate((el) => getComputedStyle(el).transform);
    expect(revisitTransform).toBe('none');
  });
});

test.describe('carbon-trace — timer, buffering, and failure resilience', () => {
  test('auto-advances from title frame during active playback', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0));
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 20000 });
    expect(errors.length).toBe(0);
  });

  test('manual navigation remains stable when narration audio fails to load', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sceneOneNarration = fileNameFromAssetPath(narrationSrcForFrame(1));
    await page.route(`**/${sceneOneNarration}`, (route) => route.abort('failed'));

    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });
    expect(errors.length).toBe(0);
  });

  test('buffering class appears on narration stall and clears on resume event', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // Use the app's test harness to toggle buffer state directly,
    // instead of monkey-patching HTMLMediaElement.addEventListener.
    // Howler manages its own event system internally, so intercepting
    // native media events is fragile and environment-dependent.
    await page.evaluate(() => {
      globalThis.__ctE2EApp.forceBufferStateForTesting(true);
    });
    await expect(stage).toHaveClass(/buffering/);

    await page.evaluate(() => {
      globalThis.__ctE2EApp.forceBufferStateForTesting(false);
    });
    await expect(stage).not.toHaveClass(/buffering/);
  });

  test('scene image failure falls back without freezing navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sceneTwoImage = fileNameFromAssetPath(imageSrcForFrame(2));
    await page.route(`**/${sceneTwoImage}`, (route) => route.abort('failed'));

    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });
    await expect(page.locator('#transition-loader')).toBeHidden();

    await page.click('#btn-prev');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    expect(errors.length).toBe(0);
  });
});

test.describe('carbon-trace — scene alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('scene-01 description appears after advancing', async ({ page }) => {
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');
    expect(label).toContain('mine tunnel');
  });

  test('scene-02 description appears after advancing twice', async ({ page }) => {
    // Advance to scene-01 then scene-02 from title card
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });
  });

  test('progress dots count matches scene count', async ({ page }) => {
    const dots = page.locator('.progress-dot');
    await expect(dots).toHaveCount(SCENE_COUNT);
  });
});

test.describe('carbon-trace — positioned text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('overlay text elements have absolute positioning styles', async ({ page }) => {
    // Press play so narration renders on title frame
    await page.click('#loading-screen');

    const lines = page.locator('.narration-line--positioned');
    await expect(lines.first()).toBeVisible({ timeout: 5000 });
    const count = await lines.count();
    expect(count).toBeGreaterThan(0);

    const first = lines.first();
    const position = await first.evaluate((el) => el.style.position);
    expect(position).toBe('absolute');
  });

  test('positioned lines keep left alignment via CSS only', async ({ page }) => {
    // Press play so narration renders on title frame
    await page.click('#loading-screen');

    const lines = page.locator('.narration-line--positioned');
    await expect(lines.first()).toBeVisible({ timeout: 5000 });
    const first = lines.first();

    const computedAlign = await first.evaluate((el) => getComputedStyle(el).getPropertyValue('text-align'));
    expect(computedAlign).toBe('left');
  });
});

test.describe('carbon-trace — loading screen gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('loading screen is visible on title card', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toBeVisible();
  });

  test('loading screen has accessible label', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toHaveAttribute('aria-label', 'carbon-trace, begin experience');
  });

  test('loading screen shows click-to-begin prompt when ready', async ({ page }) => {
    const prompt = page.locator('#loading-prompt');
    await expect(prompt).toBeVisible({ timeout: 5000 });
  });

  test('clicking loading screen unpauses and hides it', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    const pauseBtn = page.locator('#btn-pause');

    await expect(screen).toBeVisible();
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await screen.click();

    await expect(screen).toBeHidden({ timeout: 2000 });
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('loading screen hides when navigating forward via keyboard', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toBeVisible();

    await page.keyboard.press('ArrowRight');

    await expect(screen).toBeHidden({ timeout: 2000 });
  });
});

test.describe('carbon-trace — pause/play', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('pause button is visible after loading', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toBeVisible();
  });

  test('pause button aria-pressed toggles on click', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');

    // Starts paused behind loading screen
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Space bypasses loading screen and toggles pause
    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('navigation while paused does hardCut and stays paused', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const pauseBtn = page.locator('#btn-pause');
    // Starts paused behind loading screen
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // ArrowRight bypasses loading screen and navigates
    await page.keyboard.press('ArrowRight');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    // Stays paused after hardCut navigation
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('carbon-trace — captions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('caption button aria-pressed is false by default', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('caption button toggle updates aria-pressed', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');

    await captionBtn.click();
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'true');

    await captionBtn.click();
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('caption-layer has aria-hidden true', async ({ page }) => {
    const captionLayer = page.locator('#caption-layer');
    await expect(captionLayer).toHaveAttribute('aria-hidden', 'true');
  });

  test('caption text appears when enabled and scene has captions', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await captionBtn.click();

    // dismissLoadingScreen already started playback.
    // Title frame has captions — some should appear
    const captionText = page.locator('.caption-text');
    await expect(captionText.first()).toBeVisible({ timeout: 5000 });
  });

  test('localStorage persistence across page loads', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await captionBtn.click();
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const reloadedBtn = page.locator('#btn-captions');
    await expect(reloadedBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('carbon-trace — navigation interrupts', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('advancing mid-narration transitions cleanly', async ({ page }) => {
    // Advance from title (which has narration) to scene-01
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // No stale title narration text should remain
    const lines = page.locator('.narration-line');
    const lineTexts = await lines.allTextContents();
    const hasTitleText = lineTexts.some((t) => t.includes("I'm gonna tell you a story"));
    expect(hasTitleText).toBe(false);
  });

  test('replay restores narration text elements from scratch', async ({ page }) => {
    // Advance to scene-01 so replay is enabled (title starts paused with no narration)
    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(1), {
      timeout: 5000,
    });

    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 5000 });
    await page.click('#btn-replay');

    const lines = page.locator('.narration-line');
    await expect(lines).not.toHaveCount(0);
  });

  test('rapid next-button clicks do not cause errors and land on correct frame', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    for (let i = 0; i < 5; i++) {
      await page.click('#btn-next');
    }

    // "Last wins" deferred navigation should land on frame 5
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(5), { timeout: 10000 });
    expect(errors.length).toBe(0);
  });
});

test.describe('carbon-trace narrative — prefers-reduced-motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('forward button advances scene when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('Space toggles pause when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    // Scene did not advance — still on title
    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');
    expect(label).toBe(frameDescription(0));
  });
});
