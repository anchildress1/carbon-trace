import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenesData = JSON.parse(readFileSync(resolve(__dirname, '../../src/scenes.json'), 'utf8'));
const SCENE_COUNT = scenesData.frames.filter((f) => f.frameType === 'scene').length;

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

    // src must remain unchanged — click triggers effect, not navigation
    const srcAfter = await image.getAttribute('src');
    expect(srcAfter).toBe(srcBefore);
  });

  test('forward button advances scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    // Title frame has no image — advancing should load scene-01 image
    await page.click('#btn-next');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01/);
  });

  test('advances scene on keyboard Space', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    // Title frame has no image — Space should advance to scene-01
    await page.keyboard.press('Space');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01/);
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

  test('replay button is visible on initial scene load', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeVisible();
  });

  test('replay button is hidden after advancing to audio-only scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    // advance past title and scene-01 to reach scene-02 (audio-only, no lines, no audio files)
    await page.click('#btn-next');
    await page.waitForTimeout(1500);
    await page.click('#btn-next');
    await page.waitForTimeout(1500);

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeHidden();
  });

  test('clicking replay button does not advance the scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 3000 });

    const image = page.locator('#scene-image');
    const srcBefore = await image.getAttribute('src');

    await page.click('#btn-replay');

    // src must not change — replay does not navigate
    const srcAfter = await image.getAttribute('src');
    expect(srcAfter).toBe(srcBefore);
  });

  test('clicking replay restores narration text elements', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 3000 });

    // Scene 1 has narration lines — after replay, lines must be present in the DOM
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

  test('mute button aria-label toggles between mute and unmute', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const muteBtn = page.locator('#btn-mute');
    // Simulate audio being available (no audio files in test environment)
    await page.evaluate(() => document.getElementById('btn-mute').removeAttribute('aria-disabled'));

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Unmute audio');

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Mute audio');
  });
});

test.describe('carbon-trace narrative — prefers-reduced-motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('forward button advances scene when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    // Title frame has no image — advancing should load scene-01 image
    await page.click('#btn-next');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01/);
  });

  test('advances scene on keyboard Space when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    // Title frame has no image — Space should advance to scene-01
    await page.keyboard.press('Space');

    const image = page.locator('#scene-image');
    await expect(image).toHaveAttribute('src', /scene-01/);
  });
});
