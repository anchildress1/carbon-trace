import { test, expect } from '@playwright/test';

async function dismissLoadingScreen(page) {
  await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#loading-screen');
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 3000 });
}

async function measureAdvanceLatencyMs(page) {
  const stage = page.locator('#scene-stage');
  const before = await stage.getAttribute('aria-label');
  const start = Date.now();

  await page.keyboard.press('ArrowRight');
  await expect(stage).not.toHaveAttribute('aria-label', before, { timeout: 5000 });

  return Date.now() - start;
}

test.describe('runtime perf flow', () => {
  test('scene transitions stay responsive during active playback', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      globalThis.__ctLongTasks = [];
      if (!('PerformanceObserver' in globalThis)) return;

      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            globalThis.__ctLongTasks.push(entry.duration);
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        // Browser may not support longtask entries under all conditions.
      }
    });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const latenciesMs = [];
    for (let i = 0; i < 3; i++) {
      latenciesMs.push(await measureAdvanceLatencyMs(page));
    }

    const maxLatencyMs = Math.max(...latenciesMs);
    expect(maxLatencyMs).toBeLessThan(3500);

    const longTaskDurationsMs = await page.evaluate(() => globalThis.__ctLongTasks || []);
    const veryLongTasks = longTaskDurationsMs.filter((duration) => duration > 1000);
    expect(veryLongTasks).toHaveLength(0);

    await testInfo.attach('runtime-perf-summary', {
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          latenciesMs,
          maxLatencyMs,
          longTaskDurationsMs,
        }),
      ),
    });
  });
});
