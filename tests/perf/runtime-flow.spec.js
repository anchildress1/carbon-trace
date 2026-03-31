import { test, expect } from '@playwright/test';
import {
  dismissLoadingScreen,
  measureAdvanceLatencyMs,
  injectLongTaskObserver,
  collectLongTasks,
} from './helpers.js';

test.describe('runtime perf flow', () => {
  test('scene transitions stay responsive during active playback', async ({ page }, testInfo) => {
    await injectLongTaskObserver(page);

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

    const longTaskDurationsMs = await collectLongTasks(page);
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
