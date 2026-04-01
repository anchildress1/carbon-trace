import { test, expect } from '@playwright/test';
import { dismissLoadingScreen, sampleRafStats, percentile, emulatePixelClassProxy } from './helpers.js';
import { hasCreditsBackdropBlurRule, revealCreditsPanel } from './adr11-credits.shared.js';

test.describe('ADR-011 outstanding validation checks (chromium)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('Pixel-class proxy keeps credits animation near 60fps under full layer load', async (
    { page },
    testInfo,
  ) => {
    const cdp = await emulatePixelClassProxy(page);
    try {
      await revealCreditsPanel(page);

      const runtimeSummary = await page.evaluate(() => {
        const effectsCanvas = document.getElementById('effects-canvas');
        const traceCanvas = document.getElementById('trace-overlay');
        const state = globalThis.__ctE2EApp?.getState?.() || 'unknown';
        const supportsBackdropFilter =
          globalThis.CSS?.supports?.('backdrop-filter: blur(1px)') ||
          globalThis.CSS?.supports?.('-webkit-backdrop-filter: blur(1px)') ||
          false;

        return {
          state,
          effectsCanvasVisible: !!effectsCanvas && getComputedStyle(effectsCanvas).display !== 'none',
          traceCanvasVisible: !!traceCanvas && getComputedStyle(traceCanvas).display !== 'none',
          supportsBackdropFilter,
        };
      });

      expect(runtimeSummary.state).toBe('CREDITS');
      expect(runtimeSummary.effectsCanvasVisible).toBe(true);
      expect(runtimeSummary.traceCanvasVisible).toBe(true);
      expect(runtimeSummary.supportsBackdropFilter).toBe(true);
      expect(hasCreditsBackdropBlurRule).toBe(true);

      const frameStats = await sampleRafStats(page, 5000);
      const p95FrameMs = percentile(frameStats.intervalsMs, 0.95);

      expect(frameStats.averageFps).toBeGreaterThanOrEqual(45);
      expect(p95FrameMs).toBeLessThanOrEqual(33);
      expect(frameStats.droppedFramePercent).toBeLessThanOrEqual(15);

      await testInfo.attach('pixel-class-proxy-fps-summary', {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify(
            {
              ...runtimeSummary,
              averageFps: frameStats.averageFps,
              p95FrameMs,
              droppedFramePercent: frameStats.droppedFramePercent,
              sampledDurationMs: frameStats.sampledDurationMs,
              frames: frameStats.frames,
            },
            null,
            2,
          ),
        ),
      });
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });
});
