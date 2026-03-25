import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock leaf modules ---
vi.mock('gsap', () => {
  const set = vi.fn();
  const to = vi.fn((_target, opts) => {
    if (opts.onComplete) opts.onComplete();
    return { kill: vi.fn() };
  });
  const timeline = vi.fn(() => ({
    to: vi.fn().mockReturnThis(),
    fromTo: vi.fn().mockReturnThis(),
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill: vi.fn(),
    time: vi.fn().mockReturnValue(0),
    addLabel: vi.fn().mockReturnThis(),
    add: vi.fn().mockReturnThis(),
  }));
  return { gsap: { to, set, timeline }, default: { to, set, timeline } };
});

vi.mock('../../src/audio.js', () => ({
  scheduleAudioCues: vi.fn(),
  cancelAudioCues: vi.fn(),
  pauseAudioCues: vi.fn(),
  resumeAudioCues: vi.fn(),
  cueAudioCues: vi.fn(),
  cancelCue: vi.fn(),
  restartNarrationCue: vi.fn().mockReturnValue(true),
  reCueCue: vi.fn(),
  getNarrationCue: vi.fn(),
  setMuted: vi.fn(),
  onNarrationBufferChange: vi.fn(),
  isNarrationBuffering: vi.fn().mockReturnValue(false),
  preloadNarrationAhead: vi.fn(),
  clearNarrationCache: vi.fn(),
}));

vi.mock('../../src/text.js', () => ({
  buildNarrationTimeline: vi.fn(() => ({
    timeline: {
      play: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      kill: vi.fn(),
      time: vi.fn().mockReturnValue(0),
    },
    captionEntries: [],
  })),
  clearNarrationLayer: vi.fn(),
}));

vi.mock('../../src/effects-canvas.js', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  loadScene: vi.fn().mockResolvedValue(undefined),
  clearAll: vi.fn(),
  cancelPendingLoad: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}));

vi.mock('../../src/overlay.js', () => ({
  initOverlay: vi.fn(),
  updateProgress: vi.fn(),
  showControls: vi.fn(),
  focusActiveDot: vi.fn(),
}));

vi.mock('../../src/canvas.js', () => ({
  initSceneCanvas: vi.fn(),
  drawImage: vi.fn(),
  clearScene: vi.fn(),
  drawFallback: vi.fn(),
  loadImage: vi.fn().mockResolvedValue(null),
  getImageCache: vi.fn(() => new Map()),
}));

vi.mock('../../src/loader.js', () => ({
  preloadFirstFrameAudio: vi.fn(),
  preloadBackgroundAudio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/captions.js', () => ({
  initCaptions: vi.fn().mockReturnValue(false),
  setCaptionsEnabled: vi.fn(),
  areCaptionsEnabled: vi.fn().mockReturnValue(false),
  syncCaptionsToTime: vi.fn(),
  clearCaptionElements: vi.fn(),
}));

// Minimal scenes.json mock — 3 frames: title, scene, credits
// scene-01 includes ambient and music to exercise those code paths.
// narration.delay=500 exercises the delayed-narration timer paths.
vi.mock('../../src/scenes.json', () => ({
  default: {
    meta: {
      title: 'test',
      aspectRatio: '16:9',
      defaultTransition: { type: 'fade', duration: 400 },
      defaultHoldAfterNarration: 2000,
      frameDefaults: { textMode: 'ghost-drift' },
    },
    frames: [
      {
        id: 'title',
        frameType: 'title',

        holdAfterNarration: 2000,
        narration: {
          lines: [{ text: 'Opening line', enter: 0, exit: 3000 }],
          captions: [{ text: 'Opening line', start: 0, end: 3000 }],
        },
        audioCues: [
          { id: 'narration', type: 'narration', src: 'title-narration.m4a', enter: 0, volume: 1, loop: false, fadeIn: 0, fadeOut: 0 },
        ],
        effects: null,
        transition: { type: 'fade', duration: 400 },

      },
      {
        id: 'scene-01',
        frameType: 'scene',

        holdAfterNarration: 2000,
        image: 'scene-01.webp',
        narration: {
          lines: [{ text: 'Hello', enter: 0, exit: 2000 }],
          captions: [{ text: 'Hello', start: 0, end: 2000 }],
        },
        audioCues: [
          { id: 'narration', type: 'narration', src: 'narration.mp3', enter: 500, volume: 1, loop: false, fadeIn: 0, fadeOut: 0 },
          { id: 'ambient-01', type: 'ambient', src: 'ambient.mp3', enter: 0, volume: 0.5, loop: true, fadeIn: 1000, fadeOut: null },
          { id: 'end-song', type: 'ambient', src: 'credits-music.mp3', enter: 100, volume: 0.5, loop: true, fadeIn: 2000, fadeOut: null },
        ],
        effects: { regions: [{ type: 'glow', mask: 'diamond.png' }] },
        transition: { type: 'fade', duration: 400 },

      },
      {
        id: 'scene-02',
        frameType: 'scene',

        holdAfterNarration: 3000,
        image: 'scene-02.webp',
        narration: {
          lines: null,
          captions: null,
        },
        audioCues: null,
        effects: null,
        transition: { type: 'fade', duration: 400 },

      },
      {
        id: 'credits',
        frameType: 'credits',

        holdAfterNarration: 2000,
        image: 'credits.webp',
        narration: null,
        audioCues: null,
        effects: null,
        transition: { type: 'fade', duration: 400 },

      },
    ],
  },
}));

/**
 * Flush the microtask / promise queue without advancing the fake-timer clock.
 * Replaces vi.runAllTimersAsync() which fires auto-advance PausableTimers.
 */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

import { createApp } from '../../src/app.js';
import {
  scheduleAudioCues,
  cancelAudioCues,
  pauseAudioCues,
  resumeAudioCues,
  cueAudioCues,
  cancelCue,
  restartNarrationCue,
  reCueCue,
  onNarrationBufferChange,
} from '../../src/audio.js';
import { buildNarrationTimeline } from '../../src/text.js';
import {
  clearAll as clearEffects,
  cancelPendingLoad,
  loadScene as loadEffectsScene,
  pause as pauseEffects,
  resume as resumeEffects,
} from '../../src/effects-canvas.js';
import { clearScene, drawFallback, loadImage } from '../../src/canvas.js';
import { setCaptionsEnabled, areCaptionsEnabled, syncCaptionsToTime, clearCaptionElements } from '../../src/captions.js';
import { initOverlay, focusActiveDot } from '../../src/overlay.js';
import { preloadFirstFrameAudio } from '../../src/loader.js';

function buildDOM() {
  document.body.replaceChildren();

  const ids = [
    'loading-screen', 'scene-stage', 'scene-canvas',
    'effects-canvas', 'narration-layer', 'caption-layer', 'accessible-narration',
    'overlay-controls', 'progress-dots', 'btn-prev', 'btn-next',
    'btn-replay', 'btn-mute', 'btn-pause', 'btn-captions',
    'loading-prompt', 'transition-loader',
  ];

  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);

  for (const id of ids) {
    let el;
    if (id === 'scene-canvas' || id === 'effects-canvas') {
      el = document.createElement('canvas');
      el.getContext = vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        scale: vi.fn(),
        resetTransform: vi.fn(),
      }));
    } else if (id.startsWith('btn-') || id === 'loading-screen') {
      el = document.createElement('button');
    } else {
      el = document.createElement('div');
    }
    el.id = id;
    if (id === 'scene-stage') el.hidden = true;
    if (id === 'overlay-controls') el.hidden = true;
    if (id === 'transition-loader') el.hidden = true;
    root.appendChild(el);
  }
}

describe('app.js', () => {
  let app;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    buildDOM();
    loadImage.mockResolvedValue(new Image());
    globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });

    // Restore gsap.to to synchronous onComplete (tests like pendingPause override this)
    const { gsap } = await import('gsap');
    gsap.to.mockImplementation((_target, opts) => {
      if (opts.onComplete) opts.onComplete();
      return { kill: vi.fn() };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── createApp ──────────────────────────────────────────────────────

  describe('createApp', () => {
    it('throws if required DOM elements are missing', () => {
      document.body.replaceChildren();
      expect(() => createApp()).toThrow('Required element');
    });

    it('returns an object with advance, toggleMute, togglePause, getState', () => {
      app = createApp();
      expect(app).toHaveProperty('advance');
      expect(app).toHaveProperty('toggleMute');
      expect(app).toHaveProperty('togglePause');
      expect(app).toHaveProperty('getState');
    });

    it('starts in LOADING state', () => {
      app = createApp();
      expect(app.getState()).toBe('LOADING');
    });

    it('transitions to PAUSED after image preload completes', async () => {
      app = createApp();
      await flush();
      expect(app.getState()).toBe('PAUSED');
    });
  });

  // ── advance ────────────────────────────────────────────────────────

  describe('advance', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('does not advance from credits frame', async () => {
      app.togglePause();
      app.advance(); // title → scene-01
      await flush();
      app.advance(); // scene-01 → scene-02
      await flush();
      app.advance(); // scene-02 → credits
      await flush();

      expect(app.getState()).toBe('CREDITS');

      app.advance();
      await flush();
      expect(app.getState()).toBe('CREDITS');
    });
  });

  // ── togglePause ────────────────────────────────────────────────────

  describe('togglePause', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('starts paused (loading screen gate)', () => {
      expect(app.getState()).toBe('PAUSED');
    });

    it('toggles to SCENE_ACTIVE on first play', () => {
      app.togglePause();
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });

    it('toggles back to PAUSED', () => {
      app.togglePause();
      app.togglePause();
      expect(app.getState()).toBe('PAUSED');
    });

    it('calls pauseAudioCues when pausing', () => {
      app.togglePause();
      vi.clearAllMocks();
      app.togglePause();
      expect(pauseAudioCues).toHaveBeenCalled();
      expect(pauseEffects).toHaveBeenCalled();
    });

    it('calls resumeAudioCues when resuming', () => {
      app.togglePause();
      app.togglePause();
      vi.clearAllMocks();
      app.togglePause();
      expect(resumeAudioCues).toHaveBeenCalled();
    });

    it('calls resumeEffects when resuming', () => {
      app.togglePause();
      app.togglePause();
      vi.clearAllMocks();
      app.togglePause();
      expect(resumeEffects).toHaveBeenCalled();
    });

    it('updates aria-pressed on pause button', () => {
      const btn = document.getElementById('btn-pause');
      expect(btn.getAttribute('aria-pressed')).toBe('true');

      app.togglePause();
      expect(btn.getAttribute('aria-pressed')).toBe('false');

      app.togglePause();
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // ── navigation while paused (hard cut) ─────────────────────────────

  describe('navigation while paused (hard cut)', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.togglePause();
      expect(app.getState()).toBe('PAUSED');
    });

    it('remains paused after advancing', async () => {
      app.advance();
      await flush();
      expect(app.getState()).toBe('PAUSED');
    });

    it('calls cancelAudioCues for cleanup', async () => {
      vi.clearAllMocks();
      app.advance();
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('defers frame audio during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await flush();
      expect(cueAudioCues).not.toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('calls loadEffectsScene during hard cut to scene with effects', async () => {
      vi.clearAllMocks();
      app.advance(); // to scene-01 which has effects regions
      await flush();
      expect(loadEffectsScene).toHaveBeenCalled();
    });

    it('does not start ambient during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await flush();
      expect(cueAudioCues).not.toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('schedules fresh frame audio on resume after hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await flush();
      vi.clearAllMocks();
      app.togglePause();
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
          audioDurations: expect.any(Map),
        }),
      );
      expect(resumeAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── shouldAutoAdvance ──────────────────────────────────────────────

  describe('shouldAutoAdvance', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('does not auto-advance on title before full scene timer elapses', () => {
      app.togglePause();
      // Title timer: enter(0) + maxNarration(3000 from caption end) + hold(2000) = 5000ms.
      // Advance less than that — scene should not advance yet (ADR-009).
      vi.advanceTimersByTime(4000);
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });
  });

  // ── toggleMute ─────────────────────────────────────────────────────

  describe('toggleMute', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('toggles mute state on the button', () => {
      const btn = document.getElementById('btn-mute');
      btn.removeAttribute('aria-disabled');
      btn.click();
      expect(btn.getAttribute('aria-label')).toBe('Unmute audio');
      btn.click();
      expect(btn.getAttribute('aria-label')).toBe('Mute audio');
    });
  });

  // ── pendingPause ───────────────────────────────────────────────────

  describe('pendingPause (pause during transition)', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
    });

    it('toggle-toggle cancels pending pause', async () => {
      const { gsap } = await import('gsap');
      let storedOnComplete = null;
      gsap.to.mockImplementation((_target, opts) => {
        storedOnComplete = opts.onComplete;
        return { kill: vi.fn() };
      });

      app.advance();
      expect(app.getState()).toBe('TRANSITIONING');

      app.togglePause();
      app.togglePause();

      if (storedOnComplete) storedOnComplete();
      expect(app.getState()).not.toBe('PAUSED');
    });
  });

  // ── keyboard handling ──────────────────────────────────────────────

  describe('keyboard handling', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('Space toggles pause', () => {
      expect(app.getState()).toBe('PAUSED');
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });

    it('ArrowRight advances when playing', async () => {
      app.togglePause();
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('ArrowLeft retreats when on scene-01', async () => {
      app.togglePause();
      app.advance();
      await flush();

      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('focusActiveDot is called after user-initiated advance', async () => {
      app.togglePause();
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await flush();
      expect(focusActiveDot).toHaveBeenCalled();
    });

    it('focusActiveDot is called after user-initiated retreat', async () => {
      app.togglePause();
      app.advance();
      await flush();
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await flush();
      expect(focusActiveDot).toHaveBeenCalled();
    });
  });

  // ── first-play via keyboard ────────────────────────────────────────

  describe('first-play via keyboard', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('Space key triggers handleFirstPlay on first play', () => {
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      // handleFirstPlay calls scheduleFrameAudio → scheduleAudioCues
      expect(scheduleAudioCues).toHaveBeenCalled();
    });

    it('Space key hides loading screen on first play', () => {
      const screen = document.getElementById('loading-screen');
      expect(screen.hidden).toBe(false);
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      // Loading screen gets fade-out class; hidden is set after transition
      expect(screen.classList.contains('fade-out')).toBe(true);
    });

    it('double Space does not call handleFirstPlay twice', () => {
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      // First space: handleFirstPlay → scheduleAudioCues (after cancelAudioCues)
      const firstCallCount = scheduleAudioCues.mock.calls.length;
      expect(firstCallCount).toBe(1);

      vi.clearAllMocks();
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      // Second space: togglePause → doPause (no scheduleAudioCues)
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('draws fallback when image fails to load for a scene with image', async () => {
      loadImage.mockResolvedValue(null);
      app = createApp();
      await flush();
      expect(app.getState()).toBe('PAUSED');
      // Title frame has no image key, so clearScene is called for it
      expect(clearScene).toHaveBeenCalled();
    });

    it('draws fallback when image load resolves null', async () => {
      // All image loads fail
      loadImage.mockResolvedValue(null);
      app = createApp();
      await flush();
      app.togglePause();

      vi.clearAllMocks();
      app.advance();
      await flush();
      // scene-01 has an image key but load failed (null in cache)
      // waitForImage stores null, showFrame draws fallback
      expect(drawFallback).toHaveBeenCalled();
    });
  });

  // ── loading screen gate ────────────────────────────────────────────

  describe('loading screen gate', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('is visible after init', () => {
      const screen = document.getElementById('loading-screen');
      expect(screen.hidden).toBe(false);
    });

    it('fades out on click and resumes', () => {
      const screen = document.getElementById('loading-screen');
      screen.click();
      expect(app.getState()).toBe('SCENE_ACTIVE');
      expect(screen.classList.contains('fade-out')).toBe(true);
    });

    it('enables replay button on first play for non-credits frame', () => {
      const btn = document.getElementById('btn-replay');
      expect(btn.disabled).toBe(true);

      document.getElementById('loading-screen').click();
      expect(btn.disabled).toBe(false);
    });
  });

  // ── cleanup ────────────────────────────────────────────────────────

  describe('cleanup', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
    });

    it('calls cancelAudioCues on scene change', async () => {
      vi.clearAllMocks();
      app.advance();
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── ambient audio ──────────────────────────────────────────────────

  describe('ambient audio', () => {
    it('schedules ambient crossfade when advancing to a scene with ambient', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      vi.clearAllMocks();
      app.advance();
      await flush();
      // Ambient crossfade is now handled by scheduleAudioCues with crossfadeDurationMs opt
      expect(scheduleAudioCues).toHaveBeenCalled();
    });
  });

  // ── music scheduling ───────────────────────────────────────────────

  describe('music scheduling', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
    });

    it('schedules audio cues including music when advancing', async () => {
      vi.clearAllMocks();
      app.advance();
      await flush();
      // Music is now part of the unified audioCues array handled by scheduleAudioCues
      expect(scheduleAudioCues).toHaveBeenCalled();
    });
  });

  // ── narration scheduling ─────────────────────────────────────────

  describe('narration scheduling', () => {
    it('schedules audio cues with onNarrationEnd when advancing to narration scene', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      vi.clearAllMocks();
      app.advance();
      await flush();
      // Narration is now scheduled via unified scheduleAudioCues
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
        }),
      );
    });

    it('onNarrationEnd callback triggers auto-advance', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      await flush();

      // Call [0] is handleFirstPlay (title frame, audioCues=null).
      // Call [1] is showFrame for scene-01 with the real cues.
      const onend = scheduleAudioCues.mock.calls[1][1].onNarrationEnd;
      vi.clearAllMocks();

      // Simulate narration ending
      onend();

      // Auto-advance timer should have been set (2000ms holdAfterNarration)
      // Advances scene-01 → scene-02 (verify cancelAudioCues called)
      vi.advanceTimersByTime(2000);
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('stale onend callback is ignored after scene change', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      await flush();

      // Call [1] is the scene-01 scheduleAudioCues (call [0] is title from handleFirstPlay)
      const staleOnend = scheduleAudioCues.mock.calls[1][1].onNarrationEnd;

      // Navigate away before narration ends — cancelAudioCues called
      app.advance(); // to scene-02
      await flush();

      // Fire the stale onend — should be ignored (generation changed)
      staleOnend();

      // The stale onend should NOT have triggered auto-advance.
      // Advance less than scene-02's holdAfterNarration (3000ms) so only
      // the stale callback's effect is tested, not scene-02's own timer.
      vi.clearAllMocks();
      vi.advanceTimersByTime(2000);
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── accessible narration region ──────────────────────────────────

  describe('accessible narration region', () => {
    it('populates aria-live region with caption text when captions exist', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01 which has captions

      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('Hello');
    });

    it('clears aria-live region on frame with no narration', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      app.advance(); // to scene-02 (narration: { lines: null, captions: null })
      await flush();

      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('');
    });
  });

  // ── replay narration ───────────────────────────────────────────────

  describe('replay narration', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance();
      await flush();
      // On scene-01.
    });

    it('replays narration on btn-replay click', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // replayNarration reuses existing Howl via restartNarrationCue
      expect(restartNarrationCue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'narration' }),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
        }),
      );
      // cancelCue + scheduleAudioCues NOT called (restart succeeded)
      expect(cancelCue).not.toHaveBeenCalledWith('narration');
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('does not restart music on replay', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // Replay only restarts narration — ambient/music untouched
      expect(restartNarrationCue).toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('stays paused when replaying while paused', () => {
      app.togglePause();
      expect(app.getState()).toBe('PAUSED');
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      expect(app.getState()).toBe('PAUSED');
      // Replay while paused: cancelCue + reCueCue, not scheduleAudioCues
      expect(cancelCue).toHaveBeenCalledWith('narration');
      expect(reCueCue).toHaveBeenCalledWith('narration', expect.objectContaining({ type: 'narration' }));
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('plays narration from start on resume after replay-while-paused', () => {
      app.togglePause();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();
      app.togglePause(); // resume
      expect(app.getState()).toBe('SCENE_ACTIVE');
      // replayPending path calls cancelCue('narration') then scheduleAudioCues([narrationCue], ...)
      expect(cancelCue).toHaveBeenCalledWith('narration');
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'narration' })]),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
        }),
      );
    });

    it('multiple replays while paused are idempotent', () => {
      app.togglePause();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();
      expect(app.getState()).toBe('PAUSED');
      // Each replay while paused calls reCueCue
      expect(reCueCue).toHaveBeenCalledTimes(2);
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('clears buffering state on replay', () => {
      app.togglePause();
      // Simulate buffering state
      const stage = document.getElementById('scene-stage');
      stage.classList.add('buffering');
      document.getElementById('btn-replay').click();
      expect(stage.classList.contains('buffering')).toBe(false);
    });

    it('replayPending is cleared on navigation after replay-while-paused', async () => {
      app.togglePause();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();
      // Navigate to next scene instead of resuming
      app.advance();
      await flush();
      // Resume on the new scene — hard cut should schedule fresh frame audio.
      app.togglePause(); // resume
      expect(scheduleAudioCues).toHaveBeenCalled();
      expect(resumeAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── captions toggle ────────────────────────────────────────────────

  describe('captions toggle', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('enables captions on btn-captions click', () => {
      areCaptionsEnabled.mockReturnValue(false);
      const btn = document.getElementById('btn-captions');
      btn.click();
      expect(setCaptionsEnabled).toHaveBeenCalledWith(true);
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    });

    it('clears caption elements when disabling', () => {
      areCaptionsEnabled.mockReturnValue(true);
      vi.clearAllMocks();
      document.getElementById('btn-captions').click();
      expect(setCaptionsEnabled).toHaveBeenCalledWith(false);
      expect(clearCaptionElements).toHaveBeenCalled();
    });
  });

  // ── buffering ──────────────────────────────────────────────────────

  describe('buffering', () => {
    it('toggles buffering class on scene-stage', async () => {
      let bufferCb;
      onNarrationBufferChange.mockImplementation((cb) => {
        bufferCb = cb;
      });

      app = createApp();
      await flush();
      app.togglePause();

      const stage = document.getElementById('scene-stage');
      bufferCb(true);
      expect(stage.classList.contains('buffering')).toBe(true);
      bufferCb(false);
      expect(stage.classList.contains('buffering')).toBe(false);
    });
  });

  // ── button event listeners ─────────────────────────────────────────

  describe('button event listeners', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance();
      await flush();
    });

    it('btn-prev retreats to previous frame', async () => {
      vi.clearAllMocks();
      document.getElementById('btn-prev').click();
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('btn-next advances to next frame', () => {
      vi.clearAllMocks();
      document.getElementById('btn-next').click();
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('btn-pause toggles pause via listener', () => {
      document.getElementById('btn-pause').click();
      expect(app.getState()).toBe('PAUSED');
    });
  });

  // ── stage click ────────────────────────────────────────────────────

  describe('stage click', () => {
    it('does not advance on click outside controls', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      vi.clearAllMocks();
      document.getElementById('scene-stage').click();
      await flush();
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── auto-advance timer pause/resume ────────────────────────────────

  describe('auto-advance timer', () => {
    it('saves and restores auto-advance timer via PausableTimer', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance();
      await flush();

      // Extract the onNarrationEnd callback and fire it to trigger auto-advance timer
      // Call [0] is handleFirstPlay (title), call [1] is showFrame for scene-01
      const onend = scheduleAudioCues.mock.calls[1][1].onNarrationEnd;
      onend(); // scheduleAutoAdvance(2000)

      vi.advanceTimersByTime(500); // 500ms into auto-advance
      app.togglePause(); // pause — PausableTimer.pause() called

      vi.clearAllMocks();
      app.togglePause(); // resume — PausableTimer.resume() called

      // Advance past the remaining auto-advance time — triggers transition
      vi.clearAllMocks();
      vi.advanceTimersByTime(2000);
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── reduced motion ─────────────────────────────────────────────────

  describe('reduced motion', () => {
    it('transitions without gsap fade in reduced motion', async () => {
      globalThis.matchMedia.mockReturnValue({ matches: true });
      app = createApp();
      await flush();
      app.togglePause();
      app.advance();
      await flush();
      expect(app.getState()).toBe('SCENE_ACTIVE');
      // Ambient crossfade is now handled by scheduleAudioCues
      expect(scheduleAudioCues).toHaveBeenCalled();
    });
  });

  // ── registerAudio ──────────────────────────────────────────────────

  describe('registerAudio', () => {
    it('enables mute button when first audio registers', () => {
      let audioCb;
      preloadFirstFrameAudio.mockImplementation((frames, cb) => {
        audioCb = cb;
      });

      const btn = document.getElementById('btn-mute');
      btn.setAttribute('aria-disabled', 'true');

      app = createApp();
      audioCb({ src: 'ambient.mp3', duration: 10 });
      expect(btn.hasAttribute('aria-disabled')).toBe(false);
    });
  });

  // ── waitForImage ───────────────────────────────────────────────────

  describe('waitForImage', () => {
    it('shows spinner when image takes long to load', async () => {
      // Prevent images from caching during init
      loadImage.mockResolvedValue(null);
      app = createApp();
      await flush();

      // Override loadImage to take 500ms for the transition
      loadImage.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(new Image()), 500)),
      );

      app.togglePause();
      app.advance(); // transition needs scene-01.webp, calls waitForImage

      vi.advanceTimersByTime(300); // spinner timer fires
      expect(document.getElementById('transition-loader').hidden).toBe(false);

      vi.advanceTimersByTime(200); // total 500ms, image loads
      await flush();
      expect(document.getElementById('transition-loader').hidden).toBe(true);
    });
  });

  // ── overlay dot navigation ─────────────────────────────────────────

  describe('overlay dot navigation', () => {
    it('navigates to scene via dot click callback', async () => {
      let dotClickCb;
      initOverlay.mockImplementation((count, cb) => {
        dotClickCb = cb;
      });

      app = createApp();
      await flush();
      app.togglePause();

      vi.clearAllMocks();
      dotClickCb(2); // scene index 2 → frame index 1 (scene-01)
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── coverage: no-audio auto-advance (scene-02) ────────────────────

  describe('no-audio auto-advance (scene-02)', () => {
    it('auto-advances after holdAfterNarration when narration.audio is null', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // title → scene-01 (transition completes synchronously via mock gsap)

      // Now advance to scene-02 — flush to complete async transition.
      app.advance(); // scene-01 → scene-02
      await flush();

      vi.clearAllMocks();
      vi.advanceTimersByTime(3000);
      // Auto-advance fires → transition to credits
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('calls clearEffects on showFrame when frame has no effects', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // title → scene-01
      await flush();
      vi.clearAllMocks();
      app.advance(); // scene-01 → scene-02 (effects: null)
      await flush();
      expect(clearEffects).toHaveBeenCalled();
    });

    it('calls cancelPendingLoad before clearEffects on no-effects frames', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // title → scene-01
      await flush();
      vi.clearAllMocks();

      const callOrder = [];
      cancelPendingLoad.mockImplementation(() => callOrder.push('cancelPendingLoad'));
      clearEffects.mockImplementation(() => callOrder.push('clearEffects'));

      app.advance(); // scene-01 → scene-02 (effects: null)
      await flush();

      expect(cancelPendingLoad).toHaveBeenCalled();
      // cancelPendingLoad is called twice: once during cleanupCurrentScene
      // (invalidates stale in-flight loads from the outgoing frame) and once
      // in showFrame's no-effects branch (explicit cancel before clearEffects).
      expect(callOrder).toEqual(['cancelPendingLoad', 'cancelPendingLoad', 'clearEffects']);
    });

    it('calls cancelPendingLoad during cleanup to invalidate stale in-flight loads', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // title → scene-01 (has effects)
      await flush();
      vi.clearAllMocks();

      // Advancing again triggers cleanupCurrentScene for scene-01.
      // cancelPendingLoad must be called to prevent stale texture loads
      // from resolving and adding sprites during the fade-out window.
      app.advance(); // scene-01 → scene-02
      await flush();

      expect(cancelPendingLoad).toHaveBeenCalled();
    });

    it('calls loadEffectsScene on showFrame when frame has effect regions', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      vi.clearAllMocks();
      app.advance(); // title → scene-01 (has glow region)
      await flush();
      expect(loadEffectsScene).toHaveBeenCalled();
    });

    it('animated transition awaits effectsReady before fade-in', async () => {
      const { gsap } = await import('gsap');
      const onCompletes = [];
      gsap.to.mockImplementation((_target, opts) => {
        onCompletes.push(opts.onComplete);
        return { kill: vi.fn() };
      });

      let resolveEffects;
      loadEffectsScene.mockReturnValue(
        new Promise((resolve) => {
          resolveEffects = resolve;
        }),
      );

      app = createApp();
      await flush();
      app.togglePause(); // resume

      app.advance(); // title → scene-01 (has effects)

      // Fire fade-out onComplete → starts async fadeIn
      if (onCompletes[0]) onCompletes[0]();
      await flush();

      // Effects haven't resolved yet — fade-in tween should not exist
      expect(onCompletes.length).toBe(1);

      // Resolve effects — fadeIn can proceed
      resolveEffects();
      await flush();

      // Now the fade-in tween should have been created
      expect(onCompletes.length).toBe(2);
    });
  });

  // ── coverage: pending navigation during transition ─────────────────

  describe('pending navigation during transition', () => {
    it('queues second advance and executes after first completes', async () => {
      const { gsap } = await import('gsap');
      let storedOnComplete = null;
      gsap.to.mockImplementation((_target, opts) => {
        storedOnComplete = opts.onComplete;
        return { kill: vi.fn() };
      });

      app = createApp();
      await flush();
      app.togglePause();

      app.advance(); // starts transition (deferred onComplete)
      expect(app.getState()).toBe('TRANSITIONING');

      app.advance(); // queued as pendingNavIndex

      // Complete first transition
      if (storedOnComplete) storedOnComplete();
      await flush();

      // Pending nav should have fired
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── coverage: pause queued during transition (lands paused) ────────

  describe('pause queued during transition (single toggle)', () => {
    it('lands in PAUSED when pause is toggled once during transition', async () => {
      const { gsap } = await import('gsap');
      const onCompletes = [];
      gsap.to.mockImplementation((_target, opts) => {
        onCompletes.push(opts.onComplete);
        return { kill: vi.fn() };
      });

      app = createApp();
      await flush();
      app.togglePause(); // resume → SCENE_ACTIVE

      app.advance(); // starts fade-out transition
      app.togglePause(); // queue pendingPause

      // Complete fade-out → triggers async fadeIn (which awaits effects)
      if (onCompletes[0]) onCompletes[0]();
      // Flush microtasks so the async fadeIn completes past its await
      // and queues the fade-in GSAP tween (onCompletes[1]).
      await flush();
      // Complete fade-in → landOnFrame checks pendingPause
      if (onCompletes[1]) onCompletes[1]();
      await flush();

      expect(app.getState()).toBe('PAUSED');
    });
  });

  // ── coverage: caption sync on late enable ──────────────────────────

  describe('caption sync on late enable', () => {
    it('calls syncCaptionsToTime when enabling captions with active entries', async () => {
      buildNarrationTimeline.mockReturnValue({
        timeline: {
          play: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          kill: vi.fn(),
          time: vi.fn().mockReturnValue(1.5),
        },
        captionEntries: [{ text: 'test', startSec: 0, endSec: 2, el: null }],
      });

      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01 (has captions)
      await flush();

      areCaptionsEnabled.mockReturnValue(false);
      vi.clearAllMocks();
      document.getElementById('btn-captions').click();

      expect(syncCaptionsToTime).toHaveBeenCalledWith(
        expect.any(Array),
        1.5,
        expect.any(HTMLElement),
      );
    });
  });

  // ── edge: rapid replay while playing ──────────────────────────────

  describe('rapid replay while playing', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      await flush();
    });

    it('three rapid replays reuse existing Howl each time', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();

      expect(app.getState()).toBe('SCENE_ACTIVE');
      // restartNarrationCue called each time (3×) — no new Howls created
      expect(restartNarrationCue).toHaveBeenCalledTimes(3);
      // cancelCue + scheduleAudioCues NOT called (restart succeeded each time)
      expect(cancelCue).not.toHaveBeenCalledWith('narration');
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('stale onend from first replay does not trigger auto-advance after third', () => {
      // Capture onNarrationEnd from first replay
      document.getElementById('btn-replay').click();
      const firstOnend = restartNarrationCue.mock.calls[0]?.[1]?.onNarrationEnd;

      // Two more replays (generation increments each time)
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();

      // Fire stale onend — should be ignored (generation changed).
      // Advance less than scene-01's full auto-advance timer so only
      // the stale callback's effect is tested, not the scene's own timer.
      if (firstOnend) firstOnend();
      vi.advanceTimersByTime(2000);

      // Should still be on scene-01, no spurious advance
      expect(app.getState()).toBe('SCENE_ACTIVE');
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── edge: retreat to title then advance again ─────────────────────

  describe('retreat to title then advance', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      await flush();
    });

    it('retreats to title and re-advances to scene-01 with narration', async () => {
      vi.clearAllMocks();
      // Retreat to title (index 0)
      document.getElementById('btn-prev').click();
      await flush();

      // Title: no narration audio scheduled yet (handleFirstPlay not called)
      expect(app.getState()).toBe('SCENE_ACTIVE');

      // Advance back to scene-01
      vi.clearAllMocks();
      app.advance();
      await flush();

      // Should schedule all audio cues fresh (narration + ambient via scheduleAudioCues)
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
        }),
      );
    });
  });

  // ── edge: replay during buffering ─────────────────────────────────

  describe('replay during buffering', () => {
    it('clears buffering state and schedules fresh narration', async () => {
      let bufferCb;
      onNarrationBufferChange.mockImplementation((cb) => {
        bufferCb = cb;
      });

      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      await flush();

      // Simulate buffer stall
      bufferCb(true);
      const stage = document.getElementById('scene-stage');
      expect(stage.classList.contains('buffering')).toBe(true);

      vi.clearAllMocks();
      document.getElementById('btn-replay').click();

      expect(stage.classList.contains('buffering')).toBe(false);
      expect(restartNarrationCue).toHaveBeenCalled();
    });
  });

  // ── edge: dot navigation to current scene (no-op) ─────────────────

  describe('dot navigation to current scene', () => {
    it('does not trigger transition when clicking dot for current scene', async () => {
      let dotClickCb;
      initOverlay.mockImplementation((count, cb) => {
        dotClickCb = cb;
      });

      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01 (frame index 1, scene index 1)
      await flush();

      vi.clearAllMocks();
      // Click the dot for the current scene (scene index 2 → frame index 1)
      dotClickCb(2);

      // Should NOT trigger a transition
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── edge: keyboard guards inside overlay-controls ──────────────────

  describe('keyboard events inside overlay-controls', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause(); // resume → SCENE_ACTIVE
    });

    it('Space inside overlay-controls still toggles pause', () => {
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
      );

      // Space on non-button element toggles pause
      expect(app.getState()).toBe('PAUSED');
    });

    it('Enter inside overlay-controls still advances', () => {
      vi.clearAllMocks();
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );

      // Enter on non-button element advances
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('ArrowRight inside overlay-controls still advances', () => {
      vi.clearAllMocks();
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );

      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('ArrowLeft still retreats from inside overlay-controls', async () => {
      app.advance(); // to scene-01
      await flush();

      vi.clearAllMocks();
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );

      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('Space on a focused button does not toggle pause', () => {
      const btn = document.getElementById('btn-mute');
      btn.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
      );

      // Button should handle its own activation — global shortcut defers
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });

    it('Enter on a focused button does not advance', () => {
      vi.clearAllMocks();
      const btn = document.getElementById('btn-replay');
      btn.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );

      // Button should handle its own activation — global shortcut defers
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });

    it('ArrowRight on a focused button still advances (arrows are global)', () => {
      vi.clearAllMocks();
      const btn = document.getElementById('btn-mute');
      btn.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );

      // Arrow keys are not guarded — they work globally
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── edge: togglePause during LOADING state ────────────────────────

  describe('togglePause during LOADING state', () => {
    it('is a no-op before init completes', () => {
      app = createApp();
      // State is LOADING — init hasn't resolved yet
      expect(app.getState()).toBe('LOADING');

      app.togglePause();
      // Should still be LOADING — togglePause returns early
      expect(app.getState()).toBe('LOADING');
      expect(pauseAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── edge: rapid play/pause toggle ───────────────────────────────

  describe('rapid play/pause toggle', () => {
    it('survives 5 rapid toggles and lands in consistent state', async () => {
      app = createApp();
      await flush();
      app.togglePause(); // resume (firstPlay)
      vi.clearAllMocks();

      app.togglePause(); // pause
      app.togglePause(); // resume
      app.togglePause(); // pause
      app.togglePause(); // resume
      app.togglePause(); // pause

      expect(app.getState()).toBe('PAUSED');
      expect(pauseAudioCues).toHaveBeenCalled();
    });
  });

  // ── edge: multi-type cancelAudioCues ────────────────────────────

  describe('cancelAudioCues on scene with multiple cue types', () => {
    it('calls cancelAudioCues which clears all cue types on transition', async () => {
      app = createApp();
      await flush();
      app.togglePause(); // resume
      app.advance(); // to scene-01 (has narration + ambient + music cues)
      await flush();

      vi.clearAllMocks();
      app.advance(); // to scene-02 (audioCues: null)
      await flush();

      // cancelAudioCues called during cleanupCurrentScene — stops all cue types
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── edge: no audio before start ─────────────────────────────────

  describe('loading screen audio suppression', () => {
    it('does not call scheduleAudioCues before loading screen click', async () => {
      app = createApp();
      await flush();

      // App is paused behind loading screen. No audio should be scheduled.
      expect(app.getState()).toBe('PAUSED');
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── loading screen → audio scheduling ─────────────────────────────

  describe('loading screen audio scheduling', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('schedules audio cues for the title frame on loading screen click', () => {
      vi.clearAllMocks();
      document.getElementById('loading-screen').click();

      // handleFirstPlay must call scheduleAudioCues with the title frame's audioCues
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'narration', src: 'title-narration.m4a' }),
        ]),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
          crossfadeDurationMs: 800,
          audioDurations: expect.any(Map),
        }),
      );
    });

    it('cancels stale cues before scheduling fresh audio on first play', () => {
      const callOrder = [];
      cancelAudioCues.mockImplementation(() => callOrder.push('cancel'));
      scheduleAudioCues.mockImplementation(() => callOrder.push('schedule'));

      document.getElementById('loading-screen').click();

      // doResume calls cancelAudioCues, then handleFirstPlay → scheduleFrameAudio
      // The last cancel must precede the first schedule.
      const lastCancel = callOrder.lastIndexOf('cancel');
      const firstSchedule = callOrder.indexOf('schedule');
      expect(lastCancel).toBeGreaterThanOrEqual(0);
      expect(firstSchedule).toBeGreaterThan(lastCancel);
    });

    it('plays narration timeline from position 0 on first play', () => {
      document.getElementById('loading-screen').click();

      // handleFirstPlay calls textTimeline.play(0) — not just resume
      expect(buildNarrationTimeline).toHaveBeenCalled();
      const tl = buildNarrationTimeline.mock.results[0].value.timeline;
      expect(tl.play).toHaveBeenCalledWith(0);
    });
  });

  // ── narration–caption alignment ───────────────────────────────────

  describe('narration–caption alignment', () => {
    it('passes captionDelay=0 for title frame (narration enter=0)', async () => {
      app = createApp();
      await flush();

      // buildNarration runs during showFrame(0) in init — before loading screen click.
      // Title narration cue has enter: 0 → captionDelay must be 0.
      expect(buildNarrationTimeline).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(HTMLElement),
        expect.objectContaining({ captionDelay: 0 }),
      );
    });

    it('passes captionDelay=500 for scene-01 (narration enter=500)', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      vi.clearAllMocks();
      app.advance(); // title → scene-01
      await flush();

      // scene-01 narration cue has enter: 500 → captionDelay must be 500
      expect(buildNarrationTimeline).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(HTMLElement),
        expect.objectContaining({ captionDelay: 500 }),
      );
    });

    it('passes captions array to buildNarrationTimeline when frame has captions', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      vi.clearAllMocks();
      app.advance(); // to scene-01 which has captions
      await flush();

      expect(buildNarrationTimeline).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(HTMLElement),
        expect.objectContaining({
          captions: expect.arrayContaining([
            expect.objectContaining({ text: 'Hello', start: 0, end: 2000 }),
          ]),
          captionContainer: expect.any(HTMLElement),
          isCaptionEnabled: expect.any(Function),
        }),
      );
    });
  });

  // ── title auto-advance ─────────────────────────────────────────────

  describe('title auto-advance', () => {
    it('auto-advances title frame when onNarrationEnd fires', async () => {
      app = createApp();
      await flush();
      vi.clearAllMocks();

      // Click loading screen → handleFirstPlay → scheduleAudioCues for title
      document.getElementById('loading-screen').click();

      // Extract onNarrationEnd from the scheduleAudioCues call for the title frame
      const titleCall = scheduleAudioCues.mock.calls.find(
        (call) => call[0]?.some((c) => c.src === 'title-narration.m4a'),
      );
      expect(titleCall).toBeDefined();

      const onNarrationEnd = titleCall[1].onNarrationEnd;
      expect(onNarrationEnd).toBeInstanceOf(Function);

      vi.clearAllMocks();
      onNarrationEnd(); // simulate narration ending

      // holdAfterNarration is 2000ms
      vi.advanceTimersByTime(2000);

      // Should have triggered transition (cancelAudioCues called during cleanup)
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('auto-advance does not call focusActiveDot', async () => {
      app = createApp();
      await flush();
      vi.clearAllMocks();

      document.getElementById('loading-screen').click();

      const titleCall = scheduleAudioCues.mock.calls.find(
        (call) => call[0]?.some((c) => c.src === 'title-narration.m4a'),
      );
      const onNarrationEnd = titleCall[1].onNarrationEnd;

      vi.clearAllMocks();
      onNarrationEnd();
      vi.advanceTimersByTime(2000);

      expect(focusActiveDot).not.toHaveBeenCalled();
    });

    it('does not auto-advance title if user navigates before narration ends', async () => {
      app = createApp();
      await flush();

      document.getElementById('loading-screen').click();

      const titleCall = scheduleAudioCues.mock.calls.find(
        (call) => call[0]?.some((c) => c.src === 'title-narration.m4a'),
      );
      const staleOnend = titleCall[1].onNarrationEnd;

      // User manually advances before narration ends
      app.advance();
      await flush();

      // Fire stale callback — generation check should reject it.
      // Advance less than scene-01's full auto-advance timer so only
      // the stale callback's effect is tested, not the scene's own timer.
      vi.clearAllMocks();
      staleOnend();
      vi.advanceTimersByTime(2000);
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── replay → auto-advance ─────────────────────────────────────────

  describe('replay auto-advance', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      await flush();
    });

    it('auto-advances after replay narration ends while playing', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();

      // Extract onNarrationEnd from the replay's restartNarrationCue call
      const replayCall = restartNarrationCue.mock.calls[0];
      expect(replayCall).toBeDefined();
      expect(replayCall[1].onNarrationEnd).toBeInstanceOf(Function);

      const onend = replayCall[1].onNarrationEnd;
      vi.clearAllMocks();
      onend(); // narration ends after replay

      // scene-01 holdAfterNarration=2000
      vi.advanceTimersByTime(2000);
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('auto-advances after replay-while-paused then resume then narration ends', () => {
      app.togglePause(); // pause
      document.getElementById('btn-replay').click(); // replay while paused
      vi.clearAllMocks();
      app.togglePause(); // resume

      // resumeReplayPendingAudio → scheduleReplayNarration → scheduleAudioCues
      const replayCall = scheduleAudioCues.mock.calls.find(
        (call) => call[0]?.some((c) => c.type === 'narration'),
      );
      expect(replayCall).toBeDefined();

      const onend = replayCall[1].onNarrationEnd;
      vi.clearAllMocks();
      onend(); // narration ends

      vi.advanceTimersByTime(2000);
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });
});
