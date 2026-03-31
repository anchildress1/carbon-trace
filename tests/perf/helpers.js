import { expect } from '@playwright/test';

/**
 * Dismiss the loading screen by waiting for the prompt, clicking, and waiting
 * for the screen to hide. Shared across all perf tests.
 */
export async function dismissLoadingScreen(page) {
  await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#loading-screen');
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * Advance one scene via ArrowRight and return the latency in ms.
 * Resolves once the scene-stage aria-label changes.
 */
export async function measureAdvanceLatencyMs(page) {
  const stage = page.locator('#scene-stage');
  const before = await stage.getAttribute('aria-label');
  const start = await page.evaluate(() => performance.now());

  await page.keyboard.press('ArrowRight');
  await expect(stage).not.toHaveAttribute('aria-label', before, { timeout: 5000 });

  const end = await page.evaluate(() => performance.now());
  return end - start;
}

/**
 * Retreat one scene via ArrowLeft and return the latency in ms.
 * Resolves once the scene-stage aria-label changes.
 */
export async function measureRetreatLatencyMs(page) {
  const stage = page.locator('#scene-stage');
  const before = await stage.getAttribute('aria-label');
  const start = await page.evaluate(() => performance.now());

  await page.keyboard.press('ArrowLeft');
  await expect(stage).not.toHaveAttribute('aria-label', before, { timeout: 5000 });

  const end = await page.evaluate(() => performance.now());
  return end - start;
}

/**
 * Measure loading-screen dismissal latency using in-page timing only.
 */
export async function measureLoadingScreenDismissLatencyMs(page, timeoutMs = 3000) {
  return page.evaluate(async (maxWaitMs) => {
    const loadingScreen = document.getElementById('loading-screen');
    if (!loadingScreen) {
      throw new Error('loading-screen element not found');
    }

    const start = performance.now();
    loadingScreen.click();

    if (!loadingScreen.hidden) {
      await new Promise((resolve, reject) => {
        const observer = new MutationObserver(() => {
          if (loadingScreen.hidden) {
            observer.disconnect();
            clearTimeout(timerId);
            resolve();
          }
        });

        const timerId = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Timed out waiting for loading screen to hide'));
        }, maxWaitMs);
        observer.observe(loadingScreen, { attributes: true, attributeFilter: ['hidden'] });
      });
    }

    return performance.now() - start;
  }, timeoutMs);
}

/**
 * Inject a PerformanceObserver for longtask entries via addInitScript.
 * Must be called BEFORE page.goto(). Results are collected later via
 * collectLongTasks(page).
 */
export async function injectLongTaskObserver(page) {
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
}

/**
 * Collect longtask durations recorded by injectLongTaskObserver.
 */
export async function collectLongTasks(page) {
  return page.evaluate(() => globalThis.__ctLongTasks || []);
}

/**
 * Clear accumulated long tasks so subsequent collectLongTasks calls
 * only return tasks recorded after this point.
 */
export async function clearLongTasks(page) {
  await page.evaluate(() => {
    globalThis.__ctLongTasks = [];
  });
}

/**
 * Collect paint timing entries (first-contentful-paint, etc.).
 */
export async function collectPaintMetrics(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('paint');
    const result = {};
    for (const entry of entries) {
      result[entry.name] = entry.startTime;
    }
    return result;
  });
}

/**
 * Sample rAF intervals for a given duration and return FPS statistics.
 */
export async function sampleRafStats(page, sampleWindowMs) {
  return page.evaluate(async (windowMs) => {
    const intervalsMs = [];
    const startedAt = performance.now();
    let previous = startedAt;

    await new Promise((resolve) => {
      let isFirstFrame = true;
      const tick = (timestamp) => {
        if (isFirstFrame) {
          // Discard the first interval — it measures from pre-rAF
          // (performance.now()) to the first callback, inflating the average.
          isFirstFrame = false;
        } else {
          intervalsMs.push(timestamp - previous);
        }
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

/**
 * Calculate the p-th percentile from a numeric array.
 */
export function percentile(samples, p) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

/**
 * Emulate a Pixel 3a-class device with 4x CPU throttle via CDP.
 * Returns the CDP session. Callers must reset in a finally block:
 *   await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
 *   await cdp.send('Emulation.clearDeviceMetricsOverride');
 *   await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
 */
export async function emulatePixelClassProxy(page) {
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
