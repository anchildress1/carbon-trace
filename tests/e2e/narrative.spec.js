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
    await expect(dots).toHaveCount(13);
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
});
