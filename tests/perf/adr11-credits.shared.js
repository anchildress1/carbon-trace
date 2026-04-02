import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenesData = JSON.parse(readFileSync(resolve(__dirname, '../../src/scenes.json'), 'utf8'));
const stylesCss = readFileSync(resolve(__dirname, '../../src/styles.css'), 'utf8');
const FRAME_TYPES_WITH_DOTS = new Set(['title', 'scene', 'credits']);
const sceneFrames = scenesData.frames.filter((frame) => FRAME_TYPES_WITH_DOTS.has(frame.frameType));
const creditsDotIndex = sceneFrames.findIndex((frame) => frame.frameType === 'credits');
export const creditsFrame = sceneFrames[creditsDotIndex];
const holdAfterNarrationMs = creditsFrame?.holdAfterNarration ?? 3000;
export const hasCreditsBackdropBlurRule =
  /#credits-backdrop[\s\S]*backdrop-filter:\s*blur\(/.test(stylesCss) &&
  /#credits-backdrop[\s\S]*-webkit-backdrop-filter:\s*blur\(/.test(stylesCss);

async function jumpToCreditsFrame(page) {
  const panel = page.locator('#credits-panel');
  await expect(panel).toBeHidden();

  await page.locator('.progress-dot').nth(creditsDotIndex).click();
  await expect(page.locator('#scene-stage')).toHaveAttribute('aria-label', creditsFrame.description, {
    timeout: 5000,
  });
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

export async function revealCreditsPanel(page) {
  await jumpToCreditsFrame(page);
  await forceNarrationEnd(page);
  await expect(page.locator('#credits-panel')).toBeVisible({
    timeout: holdAfterNarrationMs + 2000,
  });
}
