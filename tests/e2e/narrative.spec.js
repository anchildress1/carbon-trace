import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenesData = JSON.parse(readFileSync(resolve(__dirname, '../../src/scenes.json'), 'utf8'));
const SCENE_COUNT = scenesData.frames.filter(
  (f) => f.frameType === 'title' || f.frameType === 'scene' || f.frameType === 'credits',
).length;

function frameDescription(index) {
  return scenesData.frames[index]?.description || '';
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

    // App starts paused. Navigate to scene-01 via btn-next (hardCut, stays paused).
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // Click the stage area multiple times — none should advance
    await page.click('#scene-stage');
    await page.click('#scene-stage');
    await page.click('#scene-stage');
    await page.waitForTimeout(500);

    const labelAfter = await stage.getAttribute('aria-label');
    expect(labelAfter).toBe(frameDescription(1));
  });

  test('forward button advances scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

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
    const label = await stage.getAttribute('aria-label');
    expect(label.length).toBeGreaterThan(0);
  });

  test('scene stage description changes when scene advances', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

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

    const totalFrames = scenesData.frames.length;
    for (let i = 0; i < totalFrames - 1; i++) {
      await page.keyboard.press('ArrowRight');
      // Wait for transition to settle (readiness gate may await image load)
      await page.waitForTimeout(200);
    }

    const nextBtn = page.locator('#btn-next');
    await expect(nextBtn).toBeDisabled();
  });

  test('progress dots gain active class as scenes advance', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

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

    const muteBtn = page.locator('#btn-mute');
    await page.evaluate(() => document.getElementById('btn-mute').removeAttribute('aria-disabled'));

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Unmute audio');

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Mute audio');
  });
});

test.describe('carbon-trace — scene alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('scene-01 description appears after advancing', async ({ page }) => {
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');
    expect(label).toContain('mine tunnel');
  });

  test('scene-02 description appears after advancing twice', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowRight');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', /Mine tunnel/, { timeout: 5000 });
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

  test('text alignment style is applied to positioned lines', async ({ page }) => {
    // Press play so narration renders on title frame
    await page.click('#loading-screen');

    const lines = page.locator('.narration-line--positioned');
    await expect(lines.first()).toBeVisible({ timeout: 5000 });
    const first = lines.first();

    const textAlign = await first.evaluate((el) => el.style.textAlign);
    expect(['left', 'center', 'right']).toContain(textAlign);
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
    await expect(screen).toHaveAttribute('aria-label', 'Begin experience');
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

    // Starts in paused state (play button shown)
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await pauseBtn.click(); // Play (unpause)
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    await pauseBtn.click(); // Pause
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('navigation while paused does hardCut and stays paused', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const pauseBtn = page.locator('#btn-pause');
    // Starts in paused state
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.click('#btn-next');

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

    // Press play to start (app loads paused)
    await page.click('#btn-pause');

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

    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 3000 });
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
