import { test, expect } from '@playwright/test';
import { dismissLoadingScreen } from './helpers.js';
import { creditsFrame, revealCreditsPanel } from './adr11-credits.shared.js';

test.describe('ADR-011 outstanding validation checks (webkit)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('Safari/WebKit credits compositing stack remains intact', async ({ page }, testInfo) => {
    await revealCreditsPanel(page);

    const styleSummary = await page.evaluate(() => {
      const panel = document.getElementById('credits-panel');
      const backdrop = document.getElementById('credits-backdrop');
      const panelStyles = getComputedStyle(panel);
      const backdropStyles = getComputedStyle(backdrop);

      // Safari may only expose webkit-prefixed computed style properties.
      // Build the fallback key at runtime to avoid static deprecation flags.
      const wk = 'webkit';
      return {
        opacity: panelStyles.opacity,
        maskImage: panelStyles.maskImage || panelStyles[`${wk}MaskImage`],
        backdropFilter: backdropStyles.backdropFilter || backdropStyles[`${wk}BackdropFilter`],
      };
    });

    await expect
      .poll(
        async () =>
          Number(
            await page.evaluate(() => getComputedStyle(document.getElementById('credits-panel')).opacity),
          ),
        { timeout: 3000 },
      )
      .toBeGreaterThan(0.95);
    expect(styleSummary.maskImage).toContain('gradient');
    expect(styleSummary.backdropFilter).toContain('blur');

    await testInfo.attach('webkit-credits-panel', {
      contentType: 'image/png',
      body: await page.locator('#credits-panel').screenshot(),
    });
    await expect(page.locator('#btn-prev')).toBeEnabled();
    await page.click('#btn-prev');
    await expect(page.locator('#scene-stage')).not.toHaveAttribute('aria-label', creditsFrame.description, {
      timeout: 5000,
    });

    await testInfo.attach('webkit-credits-style-summary', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(styleSummary, null, 2)),
    });
  });
});
