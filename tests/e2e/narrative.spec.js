import { test, expect } from '@playwright/test';

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
    await expect(dots).toHaveCount(12);
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

  test('advances scene on click', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const image = page.locator('#scene-image');
    const initialSrc = await image.getAttribute('src');

    await page.click('#app');

    await expect(image).not.toHaveAttribute('src', initialSrc);
  });

  test('advances scene on keyboard Space', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const image = page.locator('#scene-image');
    const initialSrc = await image.getAttribute('src');

    await page.keyboard.press('Space');

    await expect(image).not.toHaveAttribute('src', initialSrc);
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

  test('replay button is hidden on title frame', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeHidden();
  });

  test('replay button appears after advancing to first scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    await page.click('#app');

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeVisible({ timeout: 3000 });
  });

  test('mute button aria-label toggles between mute and unmute', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const muteBtn = page.locator('#btn-mute');
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

  test('advances scene on click when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const image = page.locator('#scene-image');
    const initialSrc = await image.getAttribute('src');

    await page.click('#app');

    await expect(image).not.toHaveAttribute('src', initialSrc);
  });

  test('advances scene on keyboard Space when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const image = page.locator('#scene-image');
    const initialSrc = await image.getAttribute('src');

    await page.keyboard.press('Space');

    await expect(image).not.toHaveAttribute('src', initialSrc);
  });
});
