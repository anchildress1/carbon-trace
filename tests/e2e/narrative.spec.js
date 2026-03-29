import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenesData = JSON.parse(readFileSync(resolve(__dirname, '../../src/scenes.json'), 'utf8'));
const TOTAL_FRAMES = scenesData.frames.length;
const SCENE_COUNT = scenesData.frames.filter(
  (f) => f.frameType === 'title' || f.frameType === 'scene' || f.frameType === 'credits',
).length;

function frameDescription(index) {
  return scenesData.frames[index]?.description || '';
}

function narrationSrcForFrame(index) {
  return (
    scenesData.frames[index]?.audioCues?.find((cue) => cue.type === 'narration')?.src || null
  );
}

function imageSrcForFrame(index) {
  return scenesData.frames[index]?.image || null;
}

function fileNameFromAssetPath(assetPath) {
  if (!assetPath) return '';
  return assetPath.split('/').pop() || '';
}

async function dismissLoadingScreen(page) {
  await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#loading-screen');
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 3000 });
}

async function advanceByKeyboard(page, count, startIndex = 0) {
  const stage = page.locator('#scene-stage');
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(startIndex + i + 1), {
      timeout: 5000,
    });
  }
}

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
    await expect(dots).toHaveCount(SCENE_COUNT);
  });

  test('shows mute button', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const muteBtn = page.locator('#btn-mute');
    await expect(muteBtn).toBeVisible();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Mute audio');
  });

  test('clicking scene area does not advance the scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Pause so btn-next triggers an instant hard-cut transition.
    await page.click('#btn-pause');
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // Click the stage area multiple times — none should advance
    await page.click('#scene-stage');
    await page.click('#scene-stage');
    await page.click('#scene-stage');

    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 3000 });
  });

  test('forward button advances scene', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('Space toggles pause instead of advancing', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const pauseBtn = page.locator('#btn-pause');
    // Starts paused
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Space unpauses
    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    // Space pauses again
    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Scene did not advance — still on title
    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');
    expect(label).toBe(frameDescription(0));
  });

  test('ghost-drift title text lifecycle renders and changes over time', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    const titleWord = scenesData.frames[0].narration.lines[0].text;
    await expect(page.locator('.narration-line', { hasText: titleWord })).toHaveCount(1, {
      timeout: 4000,
    });

    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    await expect(page.locator('.narration-line', { hasText: titleWord })).toHaveCount(0, {
      timeout: 5000,
    });
  });

  test('title narration words appear in configured order', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const words = scenesData.frames[0].narration.lines.map((line) => line.text.trim());
    const rendered = await page.locator('#narration-layer .narration-line').allTextContents();

    expect(rendered.slice(0, words.length)).toEqual(words);
  });

  test('scene narration playback honors configured enter delay', async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__ctPlayLog = [];
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function patchedPlay(...args) {
        globalThis.__ctPlayLog.push({
          src: this.currentSrc || this.src || '',
          t: performance.now(),
        });
        return originalPlay.apply(this, args);
      };
    });

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const navStart = await page.evaluate(() => performance.now());
    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(1), {
      timeout: 5000,
    });

    const narrationFile = fileNameFromAssetPath(narrationSrcForFrame(1));
    await page.waitForFunction(
      (expectedName) =>
        Array.isArray(globalThis.__ctPlayLog) &&
        globalThis.__ctPlayLog.some((entry) => entry.src.includes(expectedName)),
      narrationFile,
      { timeout: 10000 },
    );

    const narrationPlayTime = await page.evaluate(
      (expectedName) =>
        globalThis.__ctPlayLog.find((entry) => entry.src.includes(expectedName))?.t ?? null,
      narrationFile,
    );

    expect(narrationPlayTime).not.toBeNull();
    expect(narrationPlayTime - navStart).toBeGreaterThanOrEqual(450);
  });

  test('previous button is disabled on first frame', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const prevBtn = page.locator('#btn-prev');
    await expect(prevBtn).toBeDisabled();
  });

  test('previous button navigates back after advancing', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.click('#btn-prev');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });
  });

  test('ArrowLeft navigates back after advancing', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.keyboard.press('ArrowRight');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.keyboard.press('ArrowLeft');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });
  });

  test('replay button is enabled after playing narration scene', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene-01 (has narration audio)
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeEnabled();
  });

  test('clicking replay restarts narration content without advancing scene', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene-01 so replay is enabled
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const expectedLine = scenesData.frames[1].narration.lines[0].text;
    const narrationLayer = page.locator('#narration-layer');
    await expect(narrationLayer).toContainText(expectedLine, { timeout: 5000 });
    const labelBefore = await stage.getAttribute('aria-label');

    // Clear rendered lines and ensure replay repopulates them.
    await page.evaluate(() => {
      document.getElementById('narration-layer')?.replaceChildren();
    });
    await expect(narrationLayer).toBeEmpty();

    await page.click('#btn-replay');
    await expect(narrationLayer).toContainText(expectedLine, { timeout: 5000 });
    await expect(stage).toHaveAttribute('aria-label', labelBefore);
  });

  test('clicking replay restores narration text elements', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Advance to scene-01 so replay is enabled
    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(1), {
      timeout: 5000,
    });

    await page.click('#btn-replay');

    const lines = page.locator('.narration-line');
    await expect(lines).not.toHaveCount(0);
  });

  test('scene stage has description on initial load', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0));
  });

  test('scene stage description changes when scene advances', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    const initialLabel = await stage.getAttribute('aria-label');

    await page.click('#btn-next');

    await expect(stage).not.toHaveAttribute('aria-label', initialLabel, { timeout: 5000 });
  });

  test('forward button is disabled on credits frame', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    // Pause so each ArrowRight triggers an instant hard-jump (no fade animation).
    await page.keyboard.press('Space');

    await advanceByKeyboard(page, TOTAL_FRAMES - 1);

    const nextBtn = page.locator('#btn-next');
    await expect(nextBtn).toBeDisabled();
  });

  test('progress dots gain active class as scenes advance', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const firstDot = page.locator('.progress-dot').first();
    const secondDot = page.locator('.progress-dot').nth(1);
    const thirdDot = page.locator('.progress-dot').nth(2);

    // Title frame is scene index 1 — first dot active initially
    await expect(firstDot).toHaveClass(/active/);
    await expect(secondDot).not.toHaveClass(/active/);

    // Advance to scene 01 — first and second dots active
    await page.click('#btn-next');
    await expect(firstDot).toHaveClass(/active/);
    await expect(secondDot).toHaveClass(/active/);
    await expect(thirdDot).not.toHaveClass(/active/);
  });

  test('mute button aria-label toggles between mute and unmute', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const muteBtn = page.locator('#btn-mute');
    await expect(muteBtn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10000 });

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Unmute audio');

    await muteBtn.click();
    await expect(muteBtn).toHaveAttribute('aria-label', 'Mute audio');
  });
});

test.describe('carbon-trace — timer, buffering, and failure resilience', () => {
  test('auto-advances from title frame during active playback', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0));
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 20000 });
    expect(errors.length).toBe(0);
  });

  test('manual navigation remains stable when narration audio fails to load', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sceneOneNarration = fileNameFromAssetPath(narrationSrcForFrame(1));
    await page.route(`**/${sceneOneNarration}`, (route) => route.abort('failed'));

    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });
    expect(errors.length).toBe(0);
  });

  test('buffering pauses narration timeline and resumes it on playing event', async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__ctMediaHooks = [];
      const originalAddEventListener = HTMLMediaElement.prototype.addEventListener;
      HTMLMediaElement.prototype.addEventListener = function patchedAddEventListener(
        type,
        listener,
        options,
      ) {
        if (type === 'waiting' || type === 'playing') {
          let hook = globalThis.__ctMediaHooks.find((entry) => entry.node === this);
          if (!hook) {
            hook = { node: this, waiting: null, playing: null };
            globalThis.__ctMediaHooks.push(hook);
          }
          hook[type] = listener;
          // Keep waiting/playing deterministic in this test by manually invoking
          // the stored listeners instead of relying on native event timing.
          return undefined;
        }
        return originalAddEventListener.call(this, type, listener, options);
      };
    });

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    await page.waitForFunction(() => {
      const deep = Array.from(document.querySelectorAll('.narration-line')).find(
        (node) => node.textContent?.trim() === 'deep',
      );
      if (!deep) return false;
      return Number.parseFloat(getComputedStyle(deep).opacity) > 0.6;
    }, {
      timeout: 6000,
    });

    await page.waitForFunction(
      () =>
        Array.isArray(globalThis.__ctMediaHooks) &&
        globalThis.__ctMediaHooks.some(
          (hook) => typeof hook.waiting === 'function' && typeof hook.playing === 'function',
        ),
      { timeout: 10000 },
    );

    await page.evaluate(() => {
      const hook = globalThis.__ctMediaHooks.at(-1);
      hook?.waiting?.call(hook.node, new Event('waiting'));
    });
    await expect(stage).toHaveClass(/buffering/);
    await page.waitForTimeout(5500);
    await expect(stage).toHaveClass(/buffering/);
    const dustOpacityWhileBuffered = await page.evaluate(() => {
      const dust = Array.from(document.querySelectorAll('.narration-line')).find(
        (node) => node.textContent?.trim() === 'dust',
      );
      if (!dust) return -1;
      return Number.parseFloat(getComputedStyle(dust).opacity);
    });
    expect(dustOpacityWhileBuffered).toBeLessThan(0.2);

    await page.evaluate(() => {
      const hook = globalThis.__ctMediaHooks.at(-1);
      hook?.playing?.call(hook.node, new Event('playing'));
    });
    await expect(stage).not.toHaveClass(/buffering/);
    await page.waitForFunction(() => {
      const dust = Array.from(document.querySelectorAll('.narration-line')).find(
        (node) => node.textContent?.trim() === 'dust',
      );
      if (!dust) return false;
      return Number.parseFloat(getComputedStyle(dust).opacity) > 0.6;
    }, {
      timeout: 7000,
    });
  });

  test('ambient audio handoff occurs across scene transitions', async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__ctAmbientPlay = [];
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function patchedPlay(...args) {
        globalThis.__ctAmbientPlay.push(this.currentSrc || this.src || '');
        return originalPlay.apply(this, args);
      };
    });

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const sceneOneAmbient = fileNameFromAssetPath(
      scenesData.frames[1].audioCues.find((cue) => cue.type === 'ambient')?.src,
    );
    const sceneTwoAmbient = fileNameFromAssetPath(
      scenesData.frames[2].audioCues.find((cue) => cue.type === 'ambient')?.src,
    );

    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(1), {
      timeout: 5000,
    });
    await page.waitForFunction(
      (fileName) =>
        Array.isArray(globalThis.__ctAmbientPlay) &&
        globalThis.__ctAmbientPlay.some((src) => src.includes(fileName)),
      sceneOneAmbient,
      { timeout: 10000 },
    );

    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(2), {
      timeout: 5000,
    });
    await page.waitForFunction(
      (fileName) =>
        Array.isArray(globalThis.__ctAmbientPlay) &&
        globalThis.__ctAmbientPlay.some((src) => src.includes(fileName)),
      sceneTwoAmbient,
      { timeout: 10000 },
    );
  });

  test('scene image failure falls back without freezing navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const sceneTwoImage = fileNameFromAssetPath(imageSrcForFrame(2));
    await page.route(`**/${sceneTwoImage}`, (route) => route.abort('failed'));

    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });
    await expect(page.locator('#transition-loader')).toBeHidden();

    await page.click('#btn-prev');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    expect(errors.length).toBe(0);
  });

  test('page reload mid-experience cleanly restarts from title frame', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    const stage = page.locator('#scene-stage');
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });

    await page.reload();
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await expect(page.locator('#loading-screen')).toBeVisible();
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });
  });
});

test.describe('carbon-trace — scene alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('scene-01 description appears after advancing', async ({ page }) => {
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');
    expect(label).toContain('mine tunnel');
  });

  test('scene-02 description appears after advancing twice', async ({ page }) => {
    // Advance to scene-01 then scene-02 from title card
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    await page.click('#btn-next');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });
  });
});

test.describe('carbon-trace — positioned text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('overlay text elements have absolute positioning styles', async ({ page }) => {
    // Press play so narration renders on title frame
    await page.click('#loading-screen');

    const lines = page.locator('.narration-line--positioned');
    await expect(lines.first()).toBeVisible({ timeout: 5000 });
    const count = await lines.count();
    expect(count).toBeGreaterThan(0);

    const first = lines.first();
    const position = await first.evaluate((el) => el.style.position);
    expect(position).toBe('absolute');
  });

  test('positioned lines keep left alignment via CSS only', async ({ page }) => {
    // Press play so narration renders on title frame
    await page.click('#loading-screen');

    const lines = page.locator('.narration-line--positioned');
    await expect(lines.first()).toBeVisible({ timeout: 5000 });
    const first = lines.first();

    const computedAlign = await first.evaluate((el) => getComputedStyle(el).getPropertyValue('text-align'));
    expect(computedAlign).toBe('left');
  });
});

test.describe('carbon-trace — loading screen gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('loading screen is visible on title card', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toBeVisible();
  });

  test('loading screen has accessible label', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toHaveAttribute('aria-label', 'carbon-trace, begin experience');
  });

  test('loading screen shows click-to-begin prompt when ready', async ({ page }) => {
    const prompt = page.locator('#loading-prompt');
    await expect(prompt).toBeVisible({ timeout: 5000 });
  });

  test('clicking loading screen unpauses and hides it', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    const pauseBtn = page.locator('#btn-pause');

    await expect(screen).toBeVisible();
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await screen.click();

    await expect(screen).toBeHidden({ timeout: 2000 });
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('loading screen hides when navigating forward via keyboard', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toBeVisible();

    await page.keyboard.press('ArrowRight');

    await expect(screen).toBeHidden({ timeout: 2000 });
  });
});

test.describe('carbon-trace — pause/play', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('pause button aria-pressed toggles on click', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');

    // Starts paused behind loading screen
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Space bypasses loading screen and toggles pause
    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('navigation while paused does hardCut and stays paused', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const pauseBtn = page.locator('#btn-pause');
    // Starts paused behind loading screen
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // ArrowRight bypasses loading screen and navigates
    await page.keyboard.press('ArrowRight');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    // Stays paused after hardCut navigation
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('carbon-trace — captions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('caption button aria-pressed is false by default', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('caption button toggle updates aria-pressed', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');

    await captionBtn.click();
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'true');

    await captionBtn.click();
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('caption text appears when enabled and scene has captions', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await captionBtn.click();

    // dismissLoadingScreen already started playback.
    // Title frame has captions — some should appear
    const captionText = page.locator('.caption-text');
    await expect(captionText.first()).toBeVisible({ timeout: 5000 });
  });

  test('caption text updates when scene advances', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await captionBtn.click();

    const captionText = page.locator('.caption-text').first();
    await expect(captionText).toBeVisible({ timeout: 5000 });
    const titleCaption = await captionText.innerText();

    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(1), {
      timeout: 5000,
    });
    await expect(captionText).not.toHaveText(titleCaption, { timeout: 7000 });
  });

  test('captions are removed when user disables them', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await captionBtn.click();
    await expect(page.locator('.caption-text').first()).toBeVisible({ timeout: 5000 });

    await captionBtn.click();
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.caption-text')).toHaveCount(0);
  });

  test('localStorage persistence across page loads', async ({ page }) => {
    const captionBtn = page.locator('#btn-captions');
    await captionBtn.click();
    await expect(captionBtn).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const reloadedBtn = page.locator('#btn-captions');
    await expect(reloadedBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('carbon-trace — navigation interrupts', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('advancing mid-narration transitions cleanly', async ({ page }) => {
    // Advance from title (which has narration) to scene-01
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // No stale title narration text should remain
    const lines = page.locator('.narration-line');
    const lineTexts = await lines.allTextContents();
    const hasTitleText = lineTexts.some((t) => t.includes("I'm gonna tell you a story"));
    expect(hasTitleText).toBe(false);
  });

  test('replay restores narration text elements from scratch', async ({ page }) => {
    // Advance to scene-01 so replay is enabled (title starts paused with no narration)
    await page.click('#btn-next');
    await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', frameDescription(1), {
      timeout: 5000,
    });

    await page.locator('#btn-replay').waitFor({ state: 'visible', timeout: 5000 });
    await page.click('#btn-replay');

    const lines = page.locator('.narration-line');
    await expect(lines).not.toHaveCount(0);
  });

  test('rapid next-button clicks do not cause errors and land on correct frame', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    const stage = page.locator('#scene-stage');
    const seenLabels = [];
    for (let i = 0; i < 5; i++) {
      await page.click('#btn-next');
      seenLabels.push(await stage.getAttribute('aria-label'));
    }

    await expect(stage).not.toHaveAttribute('aria-label', frameDescription(0), { timeout: 10000 });
    expect(new Set(seenLabels).size).toBeGreaterThan(1);
    expect(errors.length).toBe(0);
  });
});

test.describe('carbon-trace narrative — mobile touch interactions', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('touch controls advance and retreat scenes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    await page.locator('#loading-screen').tap();

    const stage = page.locator('#scene-stage');
    await page.locator('#btn-next').tap();
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await page.locator('#btn-prev').tap();
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });
  });
});

test.describe('carbon-trace narrative — prefers-reduced-motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
  });

  test('forward button advances scene when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);

    await page.click('#btn-next');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('Space toggles pause when reduced motion is set', async ({ page }) => {
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });

    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    // Scene did not advance — still on title
    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');
    expect(label).toBe(frameDescription(0));
  });
});
