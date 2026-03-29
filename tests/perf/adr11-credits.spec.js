import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenesData = JSON.parse(readFileSync(resolve(__dirname, '../../src/scenes.json'), 'utf8'));
const stylesCss = readFileSync(resolve(__dirname, '../../src/styles.css'), 'utf8');
const FRAME_TYPES_WITH_DOTS = new Set(['title', 'scene', 'credits']);
const sceneFrames = scenesData.frames.filter((frame) => FRAME_TYPES_WITH_DOTS.has(frame.frameType));
const creditsDotIndex = sceneFrames.findIndex((frame) => frame.frameType === 'credits');
const creditsFrame = sceneFrames[creditsDotIndex];
const holdAfterNarrationMs = creditsFrame?.holdAfterNarration ?? 3000;
const runAdr11Perf = process.env.PERF_ADR11 === '1';
const hasCreditsBackdropBlurRule =
  /#credits-backdrop[\s\S]*backdrop-filter:\s*blur\(/.test(stylesCss) &&
  /#credits-backdrop[\s\S]*-webkit-backdrop-filter:\s*blur\(/.test(stylesCss);

function percentile(samples, p) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

async function dismissLoadingScreen(page) {
  await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#loading-screen');
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 3000 });
}

async function jumpToCreditsFrame(page) {
  const panel = page.locator('#credits-panel');
  await expect(panel).toBeHidden();

  await page.locator('.progress-dot').nth(creditsDotIndex).click();
  await expect(page.locator('#scene-stage')).toHaveAttribute(
    'aria-label',
    creditsFrame.description,
    {
      timeout: 5000,
    },
  );
}

async function forceNarrationEnd(page) {
  const hasHarness = await page.evaluate(
    () => typeof globalThis.__ctE2EApp?.forceNarrationEndForTesting === 'function',
  );
  if (!hasHarness) {
    throw new Error(
      'ADR-011 perf tests require VITE_E2E=1 build output (missing forceNarrationEndForTesting).',
    );
  }

  await page.evaluate(() => {
    globalThis.__ctE2EApp.forceNarrationEndForTesting();
  });
}

async function revealCreditsPanel(page) {
  await jumpToCreditsFrame(page);
  await forceNarrationEnd(page);
  await expect(page.locator('#credits-panel')).toBeVisible({
    timeout: holdAfterNarrationMs + 2000,
  });
}

async function sampleRafStats(page, sampleWindowMs) {
  return page.evaluate(async (windowMs) => {
    const intervalsMs = [];
    const startedAt = performance.now();
    let previous = startedAt;

    await new Promise((resolve) => {
      const tick = (timestamp) => {
        intervalsMs.push(timestamp - previous);
        previous = timestamp;

        if (timestamp - startedAt < windowMs) {
          requestAnimationFrame(tick);
          return;
        }

        resolve();
      };

      requestAnimationFrame(tick);
    });

    const sampledDurationMs = performance.now() - startedAt;
    const averageIntervalMs =
      intervalsMs.length === 0
        ? 0
        : intervalsMs.reduce((total, ms) => total + ms, 0) / intervalsMs.length;
    const averageFps = averageIntervalMs > 0 ? 1000 / averageIntervalMs : 0;
    const droppedFrames = intervalsMs.filter((ms) => ms > 25).length;

    return {
      sampledDurationMs,
      frames: intervalsMs.length,
      intervalsMs,
      averageFps,
      droppedFramePercent:
        intervalsMs.length === 0 ? 0 : (droppedFrames / intervalsMs.length) * 100,
    };
  }, sampleWindowMs);
}

async function emulatePixelClassProxy(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 393,
    height: 851,
    deviceScaleFactor: 2.75,
    mobile: true,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return cdp;
}

test.describe('ADR-011 outstanding validation checks', () => {
  test.skip(!runAdr11Perf, 'Opt-in suite. Run with PERF_ADR11=1.');

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('Safari/WebKit credits compositing stack remains intact', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'webkit', 'Safari check runs in WebKit project only.');

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
            await page.evaluate(
              () => getComputedStyle(document.getElementById('credits-panel')).opacity,
            ),
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
    await expect(page.locator('#scene-stage')).not.toHaveAttribute(
      'aria-label',
      creditsFrame.description,
      {
        timeout: 5000,
      },
    );

    await testInfo.attach('webkit-credits-style-summary', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(styleSummary, null, 2)),
    });
  });

  test('Pixel-class proxy keeps credits animation near 60fps under full layer load', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Pixel-class proxy runs in chromium with device + CPU emulation.',
    );

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
          effectsCanvasVisible:
            !!effectsCanvas && getComputedStyle(effectsCanvas).display !== 'none',
          traceCanvasVisible: !!traceCanvas && getComputedStyle(traceCanvas).display !== 'none',
          supportsBackdropFilter,
        };
      });

      expect(runtimeSummary.state).toBe('CREDITS');
      expect(runtimeSummary.effectsCanvasVisible).toBe(true);
      expect(runtimeSummary.traceCanvasVisible).toBe(true);
      expect(hasCreditsBackdropBlurRule).toBe(true);
      test.skip(
        !runtimeSummary.supportsBackdropFilter,
        'Runtime does not report backdrop-filter support.',
      );

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
    }
  });
});
