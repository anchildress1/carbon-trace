/**
 * Baseline performance profiling suite.
 *
 * Captures quantitative metrics for all major functional flows. Each test
 * attaches a JSON artifact to the Playwright report for comparison across runs.
 * No thresholds are enforced — this is observational profiling only.
 */
import { test } from '@playwright/test';
import {
  dismissLoadingScreen,
  measureAdvanceLatencyMs,
  measureRetreatLatencyMs,
  injectLongTaskObserver,
  collectLongTasks,
  collectPaintMetrics,
  sampleRafStats,
  percentile,
} from './helpers.js';

function attachJson(testInfo, name, data) {
  return testInfo.attach(name, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(data, null, 2)),
  });
}

test.describe('baseline performance profiles', () => {
  test('page load metrics', async ({ page }, testInfo) => {
    await injectLongTaskObserver(page);

    const navStart = Date.now();
    await page.goto('/');
    await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
    const promptVisibleMs = Date.now() - navStart;

    const paintMetrics = await collectPaintMetrics(page);
    const longTasks = await collectLongTasks(page);

    const navTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return null;
      return {
        domContentLoadedMs: nav.domContentLoadedEventEnd - nav.startTime,
        loadEventMs: nav.loadEventEnd - nav.startTime,
        domInteractiveMs: nav.domInteractive - nav.startTime,
        transferSizeBytes: nav.transferSize,
      };
    });

    const resourceSummary = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource');
      let totalTransferBytes = 0;
      let totalDurationMs = 0;
      const byType = {};
      for (const r of resources) {
        totalTransferBytes += r.transferSize || 0;
        totalDurationMs += r.duration;
        const ext = r.name.split('.').pop()?.split('?')[0] || 'other';
        byType[ext] = (byType[ext] || 0) + (r.transferSize || 0);
      }
      return { count: resources.length, totalTransferBytes, totalDurationMs, byType };
    });

    await attachJson(testInfo, 'page-load-profile', {
      promptVisibleMs,
      paintMetrics,
      navTiming,
      resourceSummary,
      longTaskCount: longTasks.length,
      longTaskDurationsMs: longTasks,
      totalLongTaskMs: longTasks.reduce((s, d) => s + d, 0),
    });
  });

  test('click-to-begin latency', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const start = Date.now();
    await page.click('#loading-screen');
    await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 3000 });
    const clickToVisibleMs = Date.now() - start;

    const sceneLabel = await page.locator('#scene-stage').getAttribute('aria-label');

    await attachJson(testInfo, 'click-to-begin-profile', {
      clickToVisibleMs,
      sceneLabel,
    });
  });

  test('forward navigation latency (3 advances)', async ({ page }, testInfo) => {
    await injectLongTaskObserver(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const latenciesMs = [];
    for (let i = 0; i < 3; i++) {
      latenciesMs.push(await measureAdvanceLatencyMs(page));
    }

    const longTasks = await collectLongTasks(page);

    await attachJson(testInfo, 'forward-nav-profile', {
      latenciesMs,
      maxLatencyMs: Math.max(...latenciesMs),
      avgLatencyMs: latenciesMs.reduce((s, v) => s + v, 0) / latenciesMs.length,
      longTaskCount: longTasks.length,
      longTaskDurationsMs: longTasks,
    });
  });

  test('backward navigation latency (3 retreats)', async ({ page }, testInfo) => {
    await injectLongTaskObserver(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene 4 first so we have room to retreat
    for (let i = 0; i < 4; i++) {
      await measureAdvanceLatencyMs(page);
    }

    const latenciesMs = [];
    for (let i = 0; i < 3; i++) {
      latenciesMs.push(await measureRetreatLatencyMs(page));
    }

    const longTasks = await collectLongTasks(page);

    await attachJson(testInfo, 'backward-nav-profile', {
      latenciesMs,
      maxLatencyMs: Math.max(...latenciesMs),
      avgLatencyMs: latenciesMs.reduce((s, v) => s + v, 0) / latenciesMs.length,
      longTaskCount: longTasks.length,
      longTaskDurationsMs: longTasks,
    });
  });

  test('effects steady-state FPS on scene with water+glow', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'FPS sampling runs in chromium only for consistent rAF timing.',
    );

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene 5 (water + glow effects)
    for (let i = 0; i < 5; i++) {
      await measureAdvanceLatencyMs(page);
    }

    // Let effects settle
    await page.waitForTimeout(1000);

    const stats = await sampleRafStats(page, 3000);
    const p95FrameMs = percentile(stats.intervalsMs, 0.95);

    await attachJson(testInfo, 'effects-fps-profile', {
      scene: 'scene-05-rinse (water+glow)',
      averageFps: stats.averageFps,
      p95FrameMs,
      droppedFramePercent: stats.droppedFramePercent,
      sampledDurationMs: stats.sampledDurationMs,
      totalFrames: stats.frames,
    });
  });

  test('pause/resume responsiveness', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene 1 so playback is active
    await measureAdvanceLatencyMs(page);

    const pauseBtn = page.locator('#btn-pause');

    // Measure pause latency
    const pauseStart = Date.now();
    await page.keyboard.press('Space');
    await pauseBtn.waitFor({ state: 'visible', timeout: 2000 });
    await page.waitForFunction(
      () => document.getElementById('btn-pause')?.getAttribute('aria-pressed') === 'true',
      { timeout: 2000 },
    );
    const pauseLatencyMs = Date.now() - pauseStart;

    // Measure resume latency
    const resumeStart = Date.now();
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () => document.getElementById('btn-pause')?.getAttribute('aria-pressed') === 'false',
      { timeout: 2000 },
    );
    const resumeLatencyMs = Date.now() - resumeStart;

    await attachJson(testInfo, 'pause-resume-profile', {
      pauseLatencyMs,
      resumeLatencyMs,
    });
  });

  test('full navigation cycle memory', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Memory measurement requires chromium CDP.',
    );

    await injectLongTaskObserver(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Navigate forward through 5 scenes
    for (let i = 0; i < 5; i++) {
      await measureAdvanceLatencyMs(page);
    }

    // Navigate back 3 scenes
    for (let i = 0; i < 3; i++) {
      await measureRetreatLatencyMs(page);
    }

    const longTasks = await collectLongTasks(page);

    // Attempt memory measurement (may not be available in all contexts)
    const memoryInfo = await page.evaluate(async () => {
      if (performance.measureUserAgentSpecificMemory) {
        try {
          return await performance.measureUserAgentSpecificMemory();
        } catch {
          return null;
        }
      }
      // Fall back to non-standard memory API
      if (performance.memory) {
        return {
          bytes: performance.memory.usedJSHeapSize,
          breakdown: [
            {
              bytes: performance.memory.usedJSHeapSize,
              types: ['JS'],
            },
          ],
        };
      }
      return null;
    });

    await attachJson(testInfo, 'full-cycle-profile', {
      totalLongTasks: longTasks.length,
      totalLongTaskMs: longTasks.reduce((s, d) => s + d, 0),
      memoryInfo,
    });
  });
});
