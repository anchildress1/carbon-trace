import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenesData = JSON.parse(readFileSync(resolve(__dirname, '../../src/scenes.json'), 'utf8'));
const SCENE_COUNT = scenesData.frames.filter(
  (f) => f.frameType === 'scene' || f.frameType === 'credits',
).length;

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

    const image = page.locator('#scene-image');
    const srcBefore = await image.getAttribute('src');

    await page.click('#scene-stage');

    const srcAfter = await image.getAttribute('src');
    expect(srcAfter).toBe(srcBefore);
  });

  test('forward button advances scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    await page.click('#btn-next');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);
  });

  test('advances scene on keyboard Space', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    await page.keyboard.press('Space');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);
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
    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);

    await page.click('#btn-prev');
    const srcAfter = await image.getAttribute('src');
    expect(srcAfter).toBeNull();
  });

  test('ArrowLeft navigates back after advancing', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.keyboard.press('ArrowRight');
    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);

    await page.keyboard.press('ArrowLeft');
    const srcAfter = await image.getAttribute('src');
    expect(srcAfter).toBeNull();
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

  test('replay button is enabled on initial scene load', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeEnabled();
  });

  test('clicking replay button does not advance the scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 3000 });

    const image = page.locator('#scene-image');
    const srcBefore = await image.getAttribute('src');

    await page.click('#btn-replay');

    const srcAfter = await image.getAttribute('src');
    expect(srcAfter).toBe(srcBefore);
  });

  test('clicking replay restores narration text elements', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 3000 });

    await page.click('#btn-replay');

    const lines = page.locator('.narration-line');
    await expect(lines).not.toHaveCount(0);
  });

  test('scene image has non-empty alt text on initial load', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const image = page.locator('#scene-image');
    await expect(image).not.toHaveAttribute('alt', '');
  });

  test('scene image alt text changes when scene advances', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const image = page.locator('#scene-image');
    const initialAlt = await image.getAttribute('alt');

    await page.click('#btn-next');

    await expect(image).not.toHaveAttribute('alt', initialAlt ?? '');
  });

  test('forward button is disabled on credits frame', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const totalFrames = scenesData.frames.length;
    for (let i = 0; i < totalFrames - 1; i++) {
      await page.keyboard.press('ArrowRight');
    }

    const nextBtn = page.locator('#btn-next');
    await expect(nextBtn).toBeDisabled();
  });

  test('progress dots gain active class as scenes advance', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const firstDot = page.locator('.progress-dot').first();
    await expect(firstDot).not.toHaveClass(/active/);

    await page.click('#btn-next');
    await expect(firstDot).toHaveClass(/active/);
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

  test('scene-01 image src matches scene-01-seam', async ({ page }) => {
    await page.click('#btn-next');
    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam\.webp/);
  });

  test('scene-02 image src matches scene-02-travel', async ({ page }) => {
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-02-travel\.webp/);
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
    // Title frame has positioned lines
    const lines = page.locator('.narration-line--positioned');
    const count = await lines.count();
    expect(count).toBeGreaterThan(0);

    const first = lines.first();
    const position = await first.evaluate((el) => el.style.position);
    expect(position).toBe('absolute');
  });

  test('text alignment matches data for center-aligned lines', async ({ page }) => {
    // Title frame lines are center-aligned
    const lines = page.locator('.narration-line--positioned');
    const first = lines.first();

    const textAlign = await first.evaluate((el) => el.style.textAlign);
    expect(textAlign).toBe('center');
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

    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    await pauseBtn.click();
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await pauseBtn.click();
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('navigation while paused unpauses and advances', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const pauseBtn = page.locator('#btn-pause');
    await pauseBtn.click();
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.click('#btn-next');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
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
    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);

    // No stale title narration text should remain
    const lines = page.locator('.narration-line');
    const lineTexts = await lines.allTextContents();
    const hasTitleText = lineTexts.some((t) => t.includes("I'm gonna tell you a story"));
    expect(hasTitleText).toBe(false);
  });

  test('replay restores narration text elements from scratch', async ({ page }) => {
    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 3000 });

    await page.click('#btn-replay');

    const lines = page.locator('.narration-line');
    await expect(lines).not.toHaveCount(0);
  });

  test('rapid next-button clicks do not cause errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    for (let i = 0; i < 5; i++) {
      await page.click('#btn-next');
    }

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

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);
  });

  test('advances scene on keyboard Space when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    await page.keyboard.press('Space');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01-seam/);
  });
});
