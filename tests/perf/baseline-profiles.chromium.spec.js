/**
 * Chromium-only baseline performance profiling suite.
 *
 * These checks rely on Chromium-specific behavior (stable rAF cadence and
 * memory APIs), so they are executed via --project=chromium in package scripts.
 */
import { test, expect } from '@playwright/test';
import {
  dismissLoadingScreen,
  measureAdvanceLatencyMs,
  measureRetreatLatencyMs,
  injectLongTaskObserver,
  collectLongTasks,
  sampleRafStats,
  percentile,
} from './helpers.js';
import { PERF_GUARDRAILS, attachJson } from './baseline-profiles.shared.js';

test.describe('baseline performance profiles (chromium)', () => {
  test('effects steady-state FPS on scene with water+glow', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene 5 (scene-05-rinse: water + glow effects).
    // Hardcoded to match the current scene order in scenes.json.
    for (let i = 0; i < 5; i++) {
      await measureAdvanceLatencyMs(page);
    }

    // Let effects settle
    await page.waitForTimeout(1000);

    const stats = await sampleRafStats(page, 3000);
    const p95FrameMs = percentile(stats.intervalsMs, 0.95);
    expect(stats.averageFps).toBeGreaterThanOrEqual(PERF_GUARDRAILS.minAverageFps);
    expect(p95FrameMs).toBeLessThan(PERF_GUARDRAILS.maxP95FrameMs);
    expect(stats.droppedFramePercent).toBeLessThan(PERF_GUARDRAILS.maxDroppedFramePercent);

    await attachJson(testInfo, 'effects-fps-profile', {
      scene: 'scene-05-rinse (water+glow)',
      averageFps: stats.averageFps,
      p95FrameMs,
      droppedFramePercent: stats.droppedFramePercent,
      sampledDurationMs: stats.sampledDurationMs,
      totalFrames: stats.frames,
    });
  });

  test('full navigation cycle memory', async ({ page }, testInfo) => {
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
    const veryLongTasks = longTasks.filter((duration) => duration > PERF_GUARDRAILS.maxLongTaskMs);
    expect(veryLongTasks).toHaveLength(0);

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
    if (memoryInfo) {
      expect(memoryInfo.bytes).toBeGreaterThan(0);
    }

    await attachJson(testInfo, 'full-cycle-profile', {
      totalLongTasks: longTasks.length,
      totalLongTaskMs: longTasks.reduce((s, d) => s + d, 0),
      memoryInfo,
    });
  });
});
