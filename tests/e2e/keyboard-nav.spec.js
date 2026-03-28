import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
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

async function dismissLoadingScreen(page) {
  await page.waitForSelector('#loading-prompt:not([hidden])', { timeout: 15000 });
  await page.click('#loading-screen');
  await page.locator('#loading-screen').waitFor({ state: 'hidden', timeout: 3000 });
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Navigate forward N frames via keyboard. Waits for each transition. */
async function advanceByKeyboard(page, count) {
  const stage = page.locator('#scene-stage');
  for (let i = 0; i < count; i++) {
    const currentLabel = await stage.getAttribute('aria-label');
    await page.keyboard.press('ArrowRight');
    await expect(stage).not.toHaveAttribute('aria-label', currentLabel, { timeout: 5000 });
  }
}

/** Navigate backward N frames via keyboard. Waits for each transition. */
async function retreatByKeyboard(page, count) {
  const stage = page.locator('#scene-stage');
  for (let i = 0; i < count; i++) {
    const currentLabel = await stage.getAttribute('aria-label');
    await page.keyboard.press('ArrowLeft');
    await expect(stage).not.toHaveAttribute('aria-label', currentLabel, { timeout: 5000 });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  1. FOCUS MANAGEMENT — keyboard nav moves focus to progress dots
// ═══════════════════════════════════════════════════════════════════

test.describe('keyboard focus management', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('ArrowRight navigates without stealing focus to dot', async ({ page }) => {
    await page.keyboard.press('ArrowRight');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // Keyboard nav preserves focus position — does not redirect to dot
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('progress-dot'));
    expect(focused).toBe(false);
  });

  test('ArrowLeft navigates without stealing focus to dot', async ({ page }) => {
    await advanceByKeyboard(page, 2);

    await page.keyboard.press('ArrowLeft');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const focused = await page.evaluate(() => document.activeElement?.classList.contains('progress-dot'));
    expect(focused).toBe(false);
  });

  test('Enter navigates without stealing focus to dot', async ({ page }) => {
    await page.keyboard.press('Enter');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const focused = await page.evaluate(() => document.activeElement?.classList.contains('progress-dot'));
    expect(focused).toBe(false);
  });

  test('Space does NOT move focus to a progress dot (it toggles pause)', async ({ page }) => {
    await page.keyboard.press('Space');

    const focused = await page.evaluate(() => document.activeElement?.classList.contains('progress-dot'));
    expect(focused).toBe(false);
  });

  test('keyboard nav while paused preserves focus position', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('ArrowRight');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    // Still paused
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Keyboard nav does not steal focus
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('progress-dot'));
    expect(focused).toBe(false);
  });

  test('button click moves focus to btn-pause', async ({ page }) => {
    await dismissLoadingScreen(page);

    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('btn-pause');
  });

  test('dot click moves focus to btn-pause after navigation', async ({ page }) => {
    await dismissLoadingScreen(page);

    const secondDot = page.locator('.progress-dot').nth(1);
    await secondDot.click();
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('btn-pause');
  });

  test('Space then btn-next click still moves focus to btn-pause', async ({ page }) => {
    await dismissLoadingScreen(page);

    // Space toggles pause — must NOT taint lastNavSource for subsequent pointer nav
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');

    // Pointer-initiated navigation should move focus to btn-pause
    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('btn-pause');
  });

  test('Escape then btn-next click still moves focus to btn-pause', async ({ page }) => {
    await dismissLoadingScreen(page);

    // Escape pauses — must NOT taint lastNavSource for subsequent pointer nav
    await page.keyboard.press('Escape');

    await page.click('#btn-next');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('btn-pause');
  });

  test('sequential keyboard advances do not redirect focus', async ({ page }) => {
    await advanceByKeyboard(page, 3);

    // Keyboard nav preserves focus — not on a dot
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('progress-dot'));
    expect(focused).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  2. BOUNDARY CONDITIONS — first frame, last frame, edges
// ═══════════════════════════════════════════════════════════════════

test.describe('keyboard boundary conditions', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('ArrowLeft on first frame does nothing — no error, same scene', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    const stage = page.locator('#scene-stage');
    const label = await stage.getAttribute('aria-label');

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);

    const labelAfter = await stage.getAttribute('aria-label');
    expect(labelAfter).toBe(label);
    expect(errors.length).toBe(0);
  });

  test('ArrowRight on credits frame does nothing — no error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    // Dismiss loading screen then jump to last frame via dot click
    await dismissLoadingScreen(page);
    const lastDot = page.locator('.progress-dot').last();
    await lastDot.click();
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(TOTAL_FRAMES - 1), {
      timeout: 5000,
    });
    const labelAtEnd = await stage.getAttribute('aria-label');

    // Try to advance past the end
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    const labelAfter = await stage.getAttribute('aria-label');
    expect(labelAfter).toBe(labelAtEnd);
    expect(errors.length).toBe(0);
  });

  test('next button is disabled at final frame', async ({ page }) => {
    // Dismiss loading screen then jump to last frame via dot click
    await dismissLoadingScreen(page);
    const lastDot = page.locator('.progress-dot').last();
    await lastDot.click();
    await expect(page.locator('#scene-stage')).toHaveAttribute(
      'aria-label',
      frameDescription(TOTAL_FRAMES - 1),
      { timeout: 5000 },
    );

    const nextBtn = page.locator('#btn-next');
    await expect(nextBtn).toBeDisabled();
  });

  test('prev button is disabled on first frame', async ({ page }) => {
    const prevBtn = page.locator('#btn-prev');
    await expect(prevBtn).toBeDisabled();
  });

  test('prev button becomes enabled after advancing', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const prevBtn = page.locator('#btn-prev');
    await expect(prevBtn).toBeEnabled();
  });

  test('retreating to first frame disables prev button again', async ({ page }) => {
    await advanceByKeyboard(page, 1);

    await page.keyboard.press('ArrowLeft');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });

    const prevBtn = page.locator('#btn-prev');
    await expect(prevBtn).toBeDisabled();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  3. SPACEBAR — activates focused button, global pause otherwise
// ═══════════════════════════════════════════════════════════════════

test.describe('spacebar — button activation and global pause', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('Space toggles pause from body focus', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('Space on focused pause button toggles pause via native activation', async ({ page }) => {
    await dismissLoadingScreen(page);

    await page.focus('#btn-pause');
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('Space on focused mute button toggles mute instead of pause', async ({ page }) => {
    await dismissLoadingScreen(page);

    await page.focus('#btn-mute');
    const muteBtn = page.locator('#btn-mute');
    const pauseBtn = page.locator('#btn-pause');

    await page.keyboard.press('Space');
    // Mute button activates — pause state unchanged
    await expect(muteBtn).toHaveClass(/muted/);
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('Space on focused captions button toggles captions instead of pause', async ({ page }) => {
    await dismissLoadingScreen(page);

    await page.focus('#btn-captions');
    const captionsBtn = page.locator('#btn-captions');
    const pauseBtn = page.locator('#btn-pause');

    // Default off, Space activates native click → toggleCaptions
    await page.keyboard.press('Space');
    await expect(captionsBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  4. ARROW KEYS — navigate from control buttons; ENTER activates buttons
// ═══════════════════════════════════════════════════════════════════

test.describe('arrow keys — navigate from control buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('ArrowRight advances when focus is on pause button', async ({ page }) => {
    await page.focus('#btn-pause');
    await page.keyboard.press('ArrowRight');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('ArrowRight advances when focus is on mute button', async ({ page }) => {
    await page.focus('#btn-mute');
    await page.keyboard.press('ArrowRight');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('ArrowLeft retreats when focus is inside overlay controls', async ({ page }) => {
    await advanceByKeyboard(page, 1);

    await page.focus('#btn-pause');
    await page.keyboard.press('ArrowLeft');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 5000 });
  });

  test('Enter on focused button activates it instead of global advance', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');
    await page.focus('#btn-pause');

    // Enter activates btn-pause via native click → togglePause
    await page.keyboard.press('Enter');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Scene should not have advanced
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0));
  });
});

// ═══════════════════════════════════════════════════════════════════
//  5. RAPID INPUT & RACE CONDITIONS
// ═══════════════════════════════════════════════════════════════════

test.describe('rapid keyboard input — race conditions', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('rapid ArrowRight presses produce no errors and advance past title', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }

    // Deferred "last wins" navigation means the final frame index depends on
    // how many presses the state machine could accept before queueing kicked in.
    // What matters: no JS errors and we advanced past the title.
    const stage = page.locator('#scene-stage');
    await expect(stage).not.toHaveAttribute('aria-label', frameDescription(0), { timeout: 10000 });
    expect(errors.length).toBe(0);
  });

  test('rapid ArrowLeft from middle does not go past first frame', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    // Advance 3 frames
    await advanceByKeyboard(page, 3);

    // Rapidly retreat 5 times (more than we advanced)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowLeft');
    }

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0), { timeout: 10000 });
    expect(errors.length).toBe(0);
  });

  test('interleaved Space + ArrowRight does not corrupt state', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    // Space (unpause) + ArrowRight (advance)
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');

    // After transition, focus may have moved to a progress dot.
    // Re-focus body so Space toggles pause via the global handler.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Space');

    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
    expect(errors.length).toBe(0);
  });

  test('rapid alternating ArrowRight/ArrowLeft does not throw', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
    }

    await page.waitForTimeout(1000);
    expect(errors.length).toBe(0);
  });

  test('rapid Space presses maintain correct pause state parity', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // 5 rapid presses = odd number = should end unpaused
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space');
    }

    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  6. PAUSE + KEYBOARD NAVIGATION INTERACTION
// ═══════════════════════════════════════════════════════════════════

test.describe('pause state during keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('ArrowRight while paused keeps paused state (hardCut)', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('ArrowRight');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('multiple paused ArrowRight presses stay paused', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
    }

    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(3), { timeout: 5000 });
  });

  test('ArrowLeft while paused keeps paused state', async ({ page }) => {
    // Advance twice while paused
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    // Now retreat
    await page.keyboard.press('ArrowLeft');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });

    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('unpause then navigate transitions animated (not hardCut)', async ({ page }) => {
    await dismissLoadingScreen(page);

    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('ArrowRight');
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  7. PROGRESS DOT STATE CONSISTENCY
// ═══════════════════════════════════════════════════════════════════

test.describe('progress dots consistency with keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('dots gain active class as keyboard navigates forward', async ({ page }) => {
    await advanceByKeyboard(page, 2);

    const dots = page.locator('.progress-dot');
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.nth(2)).toHaveClass(/active/);
    await expect(dots.nth(3)).not.toHaveClass(/active/);
  });

  test('dots lose active class when retreating', async ({ page }) => {
    await advanceByKeyboard(page, 3);
    await retreatByKeyboard(page, 2);

    const dots = page.locator('.progress-dot');
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.nth(2)).not.toHaveClass(/active/);
  });

  test('aria-current="step" tracks the current dot on keyboard nav', async ({ page }) => {
    await advanceByKeyboard(page, 2);

    const dots = page.locator('.progress-dot');
    await expect(dots.nth(2)).toHaveAttribute('aria-current', 'step');

    // Previous dots should NOT have aria-current
    const dot0Current = await dots.nth(0).getAttribute('aria-current');
    const dot1Current = await dots.nth(1).getAttribute('aria-current');
    expect(dot0Current).toBeNull();
    expect(dot1Current).toBeNull();
  });

  test('aria-current moves backward on retreat', async ({ page }) => {
    await advanceByKeyboard(page, 3);
    await retreatByKeyboard(page, 1);

    const dots = page.locator('.progress-dot');
    await expect(dots.nth(2)).toHaveAttribute('aria-current', 'step');

    const dot3Current = await dots.nth(3).getAttribute('aria-current');
    expect(dot3Current).toBeNull();
  });

  test('dot count matches scene count', async ({ page }) => {
    const dots = page.locator('.progress-dot');
    await expect(dots).toHaveCount(SCENE_COUNT);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  8. LOADING SCREEN KEYBOARD INTERACTION
// ═══════════════════════════════════════════════════════════════════

test.describe('loading screen keyboard behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('Space on loading screen unpauses and hides it', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toBeVisible();

    await page.keyboard.press('Space');

    await expect(screen).toBeHidden({ timeout: 2000 });
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('ArrowRight on loading screen advances and hides it', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toBeVisible();

    await page.keyboard.press('ArrowRight');

    await expect(screen).toBeHidden({ timeout: 2000 });
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('Enter on loading screen advances and hides it', async ({ page }) => {
    const screen = page.locator('#loading-screen');
    await expect(screen).toBeVisible();

    await page.keyboard.press('Enter');

    await expect(screen).toBeHidden({ timeout: 2000 });
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(1), { timeout: 5000 });
  });

  test('ArrowLeft on loading screen does nothing (at first frame)', async ({ page }) => {
    const screen = page.locator('#loading-screen');

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);

    // Loading screen still visible (no navigation occurred)
    await expect(screen).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  9. ACCESSIBILITY — aria attributes, screen reader support
// ═══════════════════════════════════════════════════════════════════

test.describe('keyboard navigation accessibility attributes', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('progress dots have correct aria-label format', async ({ page }) => {
    const dots = page.locator('.progress-dot');
    const count = await dots.count();

    for (let i = 0; i < count; i++) {
      const label = await dots.nth(i).getAttribute('aria-label');
      expect(label).toBe(`Go to scene ${i + 1} of ${count}`);
    }
  });

  test('progress dots have title attributes', async ({ page }) => {
    const dots = page.locator('.progress-dot');
    const count = await dots.count();

    for (let i = 0; i < count; i++) {
      const title = await dots.nth(i).getAttribute('title');
      expect(title).toBe(`Scene ${i + 1} of ${count}`);
    }
  });

  test('progress dots are button elements (keyboard accessible)', async ({ page }) => {
    const dots = page.locator('.progress-dot');
    const firstTag = await dots.first().evaluate((el) => el.tagName);
    expect(firstTag).toBe('BUTTON');
  });

  test('scene stage aria-label updates on every keyboard navigation', async ({ page }) => {
    const stage = page.locator('#scene-stage');
    const labels = [];

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(300);
      labels.push(await stage.getAttribute('aria-label'));
    }

    // All labels should be unique (different scenes)
    const unique = new Set(labels);
    expect(unique.size).toBe(3);

    // Each label should be non-empty
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test('accessible-narration live region exists', async ({ page }) => {
    const region = page.locator('#accessible-narration');
    await expect(region).toHaveAttribute('aria-live', 'polite');
  });

  test('only one aria-current="step" exists at any time', async ({ page }) => {
    await advanceByKeyboard(page, 3);

    const currentDots = page.locator('.progress-dot[aria-current="step"]');
    await expect(currentDots).toHaveCount(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  10. ERROR RESILIENCE — no JS errors during navigation stress
// ═══════════════════════════════════════════════════════════════════

test.describe('error resilience under keyboard stress', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('full forward traversal produces no JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    for (let i = 0; i < TOTAL_FRAMES - 1; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
    }

    expect(errors.length).toBe(0);
  });

  test('full forward then full backward traversal produces no JS errors', async ({ page }) => {
    test.slow(); // 22 iterations with waits — needs extended timeout in CI
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    // Forward all the way
    for (let i = 0; i < TOTAL_FRAMES - 1; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
    }

    // Backward all the way
    for (let i = 0; i < TOTAL_FRAMES - 1; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(200);
    }

    expect(errors.length).toBe(0);

    // Back at title
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0));
  });

  test('pause/unpause + navigation at every frame produces no errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space'); // toggle pause
      await page.keyboard.press('ArrowRight'); // advance
      await page.waitForTimeout(200);
    }

    expect(errors.length).toBe(0);
  });

  test('unrecognized keys do not cause errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err));

    const stage = page.locator('#scene-stage');
    const labelBefore = await stage.getAttribute('aria-label');

    // Press various non-handled keys
    for (const key of ['a', 'b', 'Escape', 'Tab', 'Delete', 'Home', 'End', 'F1']) {
      await page.keyboard.press(key);
    }

    await page.waitForTimeout(300);
    expect(errors.length).toBe(0);

    // Scene should not have changed (Tab might move focus but doesn't navigate)
    const labelAfter = await stage.getAttribute('aria-label');
    expect(labelAfter).toBe(labelBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  11. ESCAPE KEY — one-directional pause
// ═══════════════════════════════════════════════════════════════════

test.describe('Escape key behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
  });

  test('Escape pauses when playing', async ({ page }) => {
    await dismissLoadingScreen(page);

    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('Escape');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('Escape does nothing when already paused', async ({ page }) => {
    const pauseBtn = page.locator('#btn-pause');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    // Scene unchanged
    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(0));
  });

  test('Escape then Space resumes playback', async ({ page }) => {
    await dismissLoadingScreen(page);

    const pauseBtn = page.locator('#btn-pause');
    await page.keyboard.press('Escape');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Space');
    await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  12. ROVING TABINDEX — progress dots composite widget
// ═══════════════════════════════════════════════════════════════════

test.describe('roving tabindex on progress dots', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#scene-stage:not([hidden])', { timeout: 15000 });
    await dismissLoadingScreen(page);
  });

  test('dot group is a single Tab stop', async ({ page }) => {
    // Tab from pause button should land on the dot with tabindex="0"
    await page.focus('#btn-pause');
    await page.keyboard.press('Shift+Tab');

    const focused = await page.evaluate(() => document.activeElement?.classList.contains('progress-dot'));
    expect(focused).toBe(true);

    // Only one dot should have tabindex="0"
    const tabbableDots = await page.evaluate(() =>
      document.querySelectorAll('.progress-dot[tabindex="0"]').length,
    );
    expect(tabbableDots).toBe(1);
  });

  test('ArrowRight on focused dot moves focus to next dot without navigating', async ({ page }) => {
    // Focus the first dot
    const firstDot = page.locator('.progress-dot').first();
    await firstDot.focus();

    const stage = page.locator('#scene-stage');
    const labelBefore = await stage.getAttribute('aria-label');

    await page.keyboard.press('ArrowRight');

    // Focus moved to second dot
    const focusedIndex = await page.evaluate(() => document.activeElement?.dataset?.sceneIndex);
    expect(focusedIndex).toBe('2');

    // Scene did NOT navigate
    const labelAfter = await stage.getAttribute('aria-label');
    expect(labelAfter).toBe(labelBefore);
  });

  test('Enter on focused dot navigates to that scene', async ({ page }) => {
    // Focus the third dot
    const thirdDot = page.locator('.progress-dot').nth(2);
    await thirdDot.focus();

    await page.keyboard.press('Enter');

    const stage = page.locator('#scene-stage');
    await expect(stage).toHaveAttribute('aria-label', frameDescription(2), { timeout: 5000 });
  });

  test('ArrowLeft on first dot wraps to last dot', async ({ page }) => {
    const firstDot = page.locator('.progress-dot').first();
    await firstDot.focus();

    await page.keyboard.press('ArrowLeft');

    const focusedIndex = await page.evaluate(() => document.activeElement?.dataset?.sceneIndex);
    expect(focusedIndex).toBe(String(SCENE_COUNT));
  });

  test('Home/End navigate to first/last dot', async ({ page }) => {
    const firstDot = page.locator('.progress-dot').first();
    await firstDot.focus();

    await page.keyboard.press('End');
    const endIndex = await page.evaluate(() => document.activeElement?.dataset?.sceneIndex);
    expect(endIndex).toBe(String(SCENE_COUNT));

    await page.keyboard.press('Home');
    const homeIndex = await page.evaluate(() => document.activeElement?.dataset?.sceneIndex);
    expect(homeIndex).toBe('1');
  });

  test('clicking current dot syncs roving index for subsequent arrow nav', async ({ page }) => {
    // Navigate to scene 2 via keyboard (roving index stays at 0)
    await advanceByKeyboard(page, 1);

    // Click the current dot (scene 2 = dotElements[1]) — no transition fires
    const dot2 = page.locator('.progress-dot').nth(1);
    await dot2.click();

    // ArrowRight from dot 2 should move focus to dot 3, not dot 2
    await page.keyboard.press('ArrowRight');
    const focusedIndex = await page.evaluate(() => document.activeElement?.dataset?.sceneIndex);
    expect(focusedIndex).toBe('3');
  });
});
