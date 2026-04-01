/**
 * Baseline performance profiling suite.
 *
 * Captures quantitative metrics for all major functional flows. Each test
 * attaches a JSON artifact to the Playwright report for comparison across runs.
 * Guardrails are intentionally broad: this suite remains primarily
 * observational, but now fails on clear regressions.
 */
import { test, expect } from '@playwright/test';
import {
  dismissLoadingScreen,
  measureAdvanceLatencyMs,
  measureRetreatLatencyMs,
  measureLoadingScreenDismissLatencyMs,
  injectLongTaskObserver,
  collectLongTasks,
  clearLongTasks,
  collectPaintMetrics,
} from './helpers.js';
import { PERF_GUARDRAILS, attachJson } from './baseline-profiles.shared.js';

test.describe('baseline performance profiles', () => {
  test('page load metrics', async ({ page }, testInfo) => {
    await injectLongTaskObserver(page);

    await page.goto('/');
    await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
    const promptVisibleMs = await page.evaluate(() => performance.now());

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

    expect(promptVisibleMs).toBeLessThan(PERF_GUARDRAILS.pageLoadPromptVisibleMs);
    expect(navTiming).not.toBeNull();
    if (navTiming) {
      expect(navTiming.domContentLoadedMs).toBeGreaterThanOrEqual(0);
      expect(navTiming.loadEventMs).toBeGreaterThanOrEqual(0);
      expect(navTiming.domInteractiveMs).toBeGreaterThanOrEqual(0);
    }

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
    await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });

    const clickToVisibleMs = await measureLoadingScreenDismissLatencyMs(page);

    const sceneLabel = await page.locator('#scene-stage').getAttribute('aria-label');
    expect(clickToVisibleMs).toBeLessThan(PERF_GUARDRAILS.clickToBeginMs);
    expect(sceneLabel).toBeTruthy();

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
    const maxLatencyMs = Math.max(...latenciesMs);
    const avgLatencyMs = latenciesMs.reduce((s, v) => s + v, 0) / latenciesMs.length;
    const veryLongTasks = longTasks.filter((duration) => duration > PERF_GUARDRAILS.maxLongTaskMs);
    expect(maxLatencyMs).toBeLessThan(PERF_GUARDRAILS.navLatencyMs);
    expect(veryLongTasks).toHaveLength(0);

    await attachJson(testInfo, 'forward-nav-profile', {
      latenciesMs,
      maxLatencyMs,
      avgLatencyMs,
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

    // Clear long tasks accumulated during forward advances so we only
    // measure tasks triggered by the retreat phase.
    await clearLongTasks(page);

    const latenciesMs = [];
    for (let i = 0; i < 3; i++) {
      latenciesMs.push(await measureRetreatLatencyMs(page));
    }

    const longTasks = await collectLongTasks(page);
    const maxLatencyMs = Math.max(...latenciesMs);
    const avgLatencyMs = latenciesMs.reduce((s, v) => s + v, 0) / latenciesMs.length;
    const veryLongTasks = longTasks.filter((duration) => duration > PERF_GUARDRAILS.maxLongTaskMs);
    expect(maxLatencyMs).toBeLessThan(PERF_GUARDRAILS.navLatencyMs);
    expect(veryLongTasks).toHaveLength(0);

    await attachJson(testInfo, 'backward-nav-profile', {
      latenciesMs,
      maxLatencyMs,
      avgLatencyMs,
      longTaskCount: longTasks.length,
      longTaskDurationsMs: longTasks,
    });
  });

  test('pause/resume responsiveness', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene 1 so playback is active
    await measureAdvanceLatencyMs(page);

    // Measure pause and resume latency entirely in-page to avoid
    // Playwright protocol overhead inflating the numbers.
    const pauseLatencyMs = await page.evaluate(
      (maxWaitMs) =>
        new Promise((resolve, reject) => {
          const btn = document.getElementById('btn-pause');
          const start = performance.now();

          const observer = new MutationObserver(() => {
            if (btn.getAttribute('aria-pressed') === 'true') {
              observer.disconnect();
              clearTimeout(timerId);
              resolve(performance.now() - start);
            }
          });

          const timerId = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timed out waiting for pause'));
          }, maxWaitMs);
          observer.observe(btn, { attributes: true, attributeFilter: ['aria-pressed'] });
          document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        }),
      2000,
    );

    const resumeLatencyMs = await page.evaluate(
      (maxWaitMs) =>
        new Promise((resolve, reject) => {
          const btn = document.getElementById('btn-pause');
          const start = performance.now();

          const observer = new MutationObserver(() => {
            if (btn.getAttribute('aria-pressed') === 'false') {
              observer.disconnect();
              clearTimeout(timerId);
              resolve(performance.now() - start);
            }
          });

          const timerId = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Timed out waiting for resume'));
          }, maxWaitMs);
          observer.observe(btn, { attributes: true, attributeFilter: ['aria-pressed'] });
          document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        }),
      2000,
    );
    expect(pauseLatencyMs).toBeLessThan(PERF_GUARDRAILS.pauseResumeMs);
    expect(resumeLatencyMs).toBeLessThan(PERF_GUARDRAILS.pauseResumeMs);

    await attachJson(testInfo, 'pause-resume-profile', {
      pauseLatencyMs,
      resumeLatencyMs,
    });
  });

});
