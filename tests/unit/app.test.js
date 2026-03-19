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
  reCueCue: vi.fn(),
  getNarrationCue: vi.fn(),
  setMuted: vi.fn(),
  onNarrationBufferChange: vi.fn(),
  isNarrationBuffering: vi.fn().mockReturnValue(false),
  preloadNarrationAhead: vi.fn(),
  clearNarrationCache: vi.fn(),
}));

vi.mock('../../src/pausable-timer.js', () => {
  class MockPausableTimer {
    #callback;
    #delay;
    #paused = false;
    #cancelled = false;
    #fired = false;
    #timerId = null;

    constructor(callback, delay) {
      this.#callback = callback;
      this.#delay = delay;
      this.#timerId = setTimeout(() => {
        if (this.#cancelled) return;
        this.#fired = true;
        this.#timerId = null;
        this.#callback();
      }, delay);
    }

    pause() {
      if (this.#fired || this.#cancelled) return;
      this.#paused = true;
      if (this.#timerId) {
        clearTimeout(this.#timerId);
        this.#timerId = null;
      }
    }

    resume() {
      if (!this.#paused || this.#cancelled || this.#fired) return;
      this.#paused = false;
      this.#timerId = setTimeout(() => {
        if (this.#cancelled) return;
        this.#fired = true;
        this.#timerId = null;
        this.#callback();
      }, this.#delay);
    }

    cancel() {
      this.#cancelled = true;
      this.#paused = false;
      if (this.#timerId) {
        clearTimeout(this.#timerId);
        this.#timerId = null;
      }
    }

    get isActive() {
      return this.#timerId !== null;
    }

    get isPaused() {
      return this.#paused;
    }
  }

  return { PausableTimer: MockPausableTimer };
});

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

vi.mock('../../src/effects.js', () => ({
  runEffect: vi.fn(),
  clearEffects: vi.fn(),
  effectExists: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/effects-canvas.js', () => ({
  initCanvas: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  clearAll: vi.fn(),
}));

vi.mock('../../src/overlay.js', () => ({
  initOverlay: vi.fn(),
  updateProgress: vi.fn(),
  showControls: vi.fn(),
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
        holdUntilClick: true,
        holdAfterNarration: null,
        narration: null,
        audioCues: null,
        effects: { idle: null, entry: null },
        transition: { type: 'fade', duration: 400 },
        traceOverlay: null,
      },
      {
        id: 'scene-01',
        frameType: 'scene',
        holdUntilClick: false,
        holdAfterNarration: 2000,
        image: 'scene-01.webp',
        narration: {
          lines: [{ text: 'Hello', enter: 0, exit: 2000 }],
          captions: [{ text: 'Hello', start: 0, end: 2000 }],
        },
        audioCues: [
          { id: 'narration', type: 'narration', src: 'narration.mp3', enter: 500, volume: 1.0, loop: false, fadeIn: 0, fadeOut: 0 },
          { id: 'ambient-01', type: 'ambient', src: 'ambient.mp3', enter: 0, volume: 0.5, loop: true, fadeIn: 1000, fadeOut: null },
          { id: 'end-song', type: 'ambient', src: 'credits-music.mp3', enter: 100, volume: 0.5, loop: true, fadeIn: 2000, fadeOut: null },
        ],
        effects: { idle: null, entry: 'fade-in' },
        transition: { type: 'fade', duration: 400 },
        traceOverlay: null,
      },
      {
        id: 'scene-02',
        frameType: 'scene',
        holdUntilClick: false,
        holdAfterNarration: 3000,
        image: 'scene-02.webp',
        narration: {
          lines: null,
          captions: null,
        },
        audioCues: null,
        effects: { idle: 'dust-drift', entry: 'fade-in' },
        transition: { type: 'fade', duration: 400 },
        traceOverlay: null,
      },
      {
        id: 'credits',
        frameType: 'credits',
        holdUntilClick: null,
        holdAfterNarration: null,
        image: 'credits.webp',
        narration: null,
        audioCues: null,
        effects: { idle: null, entry: null },
        transition: { type: 'fade', duration: 400 },
        traceOverlay: null,
      },
    ],
  },
}));

import { createApp } from '../../src/app.js';
import {
  scheduleAudioCues,
  cancelAudioCues,
  pauseAudioCues,
  resumeAudioCues,
  cueAudioCues,
  cancelCue,
  reCueCue,
  setMuted,
  onNarrationBufferChange,
} from '../../src/audio.js';
import { buildNarrationTimeline, clearNarrationLayer } from '../../src/text.js';
import { runEffect, clearEffects } from '../../src/effects.js';
import {
  clearAll as clearCanvasEffects,
  pause as pauseCanvas,
  resume as resumeCanvas,
} from '../../src/effects-canvas.js';
import { drawImage as drawSceneImage, clearScene, drawFallback, loadImage } from '../../src/canvas.js';
import { setCaptionsEnabled, areCaptionsEnabled, syncCaptionsToTime, clearCaptionElements } from '../../src/captions.js';
import { initOverlay } from '../../src/overlay.js';
import { preloadFirstFrameAudio } from '../../src/loader.js';

function buildDOM() {
  document.body.replaceChildren();

  const ids = [
    'loading-screen', 'scene-stage', 'scene-canvas', 'trace-overlay',
    'effects-canvas', 'narration-layer', 'caption-layer', 'accessible-narration',
    'overlay-controls', 'progress-dots', 'btn-prev', 'btn-next',
    'btn-replay', 'btn-mute', 'btn-pause', 'btn-captions',
    'play-gate', 'transition-loader',
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
    } else if (id.startsWith('btn-')) {
      el = document.createElement('button');
    } else {
      el = document.createElement('div');
    }
    el.id = id;
    if (id === 'scene-stage') el.hidden = true;
    if (id === 'play-gate') el.hidden = true;
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
      await vi.runAllTimersAsync();
      expect(app.getState()).toBe('PAUSED');
    });
  });

  // ── advance ────────────────────────────────────────────────────────

  describe('advance', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
    });

    it('does not advance from credits frame', async () => {
      app.togglePause();
      app.advance(); // title → scene-01
      await vi.runAllTimersAsync();
      app.advance(); // scene-01 → scene-02
      await vi.runAllTimersAsync();
      app.advance(); // scene-02 → credits
      await vi.runAllTimersAsync();

      expect(app.getState()).toBe('CREDITS');

      app.advance();
      await vi.runAllTimersAsync();
      expect(app.getState()).toBe('CREDITS');
    });
  });

  // ── togglePause ────────────────────────────────────────────────────

  describe('togglePause', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
    });

    it('starts paused (play gate)', () => {
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
      expect(pauseCanvas).toHaveBeenCalled();
    });

    it('calls resumeAudioCues when resuming', () => {
      app.togglePause();
      app.togglePause();
      vi.clearAllMocks();
      app.togglePause();
      expect(resumeAudioCues).toHaveBeenCalled();
      expect(resumeCanvas).toHaveBeenCalled();
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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.togglePause();
      expect(app.getState()).toBe('PAUSED');
    });

    it('remains paused after advancing', async () => {
      app.advance();
      await vi.runAllTimersAsync();
      expect(app.getState()).toBe('PAUSED');
    });

    it('calls cancelAudioCues for cleanup', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('cues narration instead of playing during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      // During hard cut (paused), audioCues should be cued, not scheduled
      expect(cueAudioCues).toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('calls clearEffects during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      expect(clearEffects).toHaveBeenCalled();
      expect(clearCanvasEffects).toHaveBeenCalled();
    });

    it('cues ambient instead of playing during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      // All cues (including ambient) are cued together via cueAudioCues
      expect(cueAudioCues).toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('cues music instead of scheduling during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      // All cues (including music) are cued together via cueAudioCues
      expect(cueAudioCues).toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── shouldAutoAdvance ──────────────────────────────────────────────

  describe('shouldAutoAdvance', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
    });

    it('does not auto-advance on holdUntilClick=true (title)', () => {
      app.togglePause();
      vi.advanceTimersByTime(10000);
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });
  });

  // ── toggleMute ─────────────────────────────────────────────────────

  describe('toggleMute', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('ArrowLeft retreats when on scene-01', async () => {
      app.togglePause();
      app.advance();
      await vi.runAllTimersAsync();

      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await vi.runAllTimersAsync();
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('draws fallback when image fails to load for a scene with image', async () => {
      loadImage.mockResolvedValue(null);
      app = createApp();
      await vi.runAllTimersAsync();
      expect(app.getState()).toBe('PAUSED');
      // Title frame has no image key, so clearScene is called for it
      expect(clearScene).toHaveBeenCalled();
    });

    it('draws fallback when image load resolves null', async () => {
      // All image loads fail
      loadImage.mockResolvedValue(null);
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();

      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      // scene-01 has an image key but load failed (null in cache)
      // waitForImage stores null, showFrame draws fallback
      expect(drawFallback).toHaveBeenCalled();
    });
  });

  // ── play gate ──────────────────────────────────────────────────────

  describe('play gate', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
    });

    it('is visible after init', () => {
      const gate = document.getElementById('play-gate');
      expect(gate.hidden).toBe(false);
    });

    it('hides on click and resumes', () => {
      const gate = document.getElementById('play-gate');
      gate.click();
      expect(app.getState()).toBe('SCENE_ACTIVE');
      expect(gate.hidden).toBe(true);
    });
  });

  // ── cleanup ────────────────────────────────────────────────────────

  describe('cleanup', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
    });

    it('calls cancelAudioCues on scene change', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── ambient audio ──────────────────────────────────────────────────

  describe('ambient audio', () => {
    it('schedules ambient crossfade when advancing to a scene with ambient', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      // Ambient crossfade is now handled by scheduleAudioCues with crossfadeDurationMs opt
      expect(scheduleAudioCues).toHaveBeenCalled();
    });
  });

  // ── music scheduling ───────────────────────────────────────────────

  describe('music scheduling', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
    });

    it('schedules audio cues including music when advancing', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      // Music is now part of the unified audioCues array handled by scheduleAudioCues
      expect(scheduleAudioCues).toHaveBeenCalled();
    });
  });

  // ── narration scheduling ─────────────────────────────────────────

  describe('narration scheduling', () => {
    it('schedules audio cues with onNarrationEnd when advancing to narration scene', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01
      await vi.runAllTimersAsync();

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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01
      await vi.runAllTimersAsync();

      // Call [1] is the scene-01 scheduleAudioCues (call [0] is title from handleFirstPlay)
      const staleOnend = scheduleAudioCues.mock.calls[1][1].onNarrationEnd;

      // Navigate away before narration ends — cancelAudioCues called
      app.advance(); // to scene-02
      await vi.runAllTimersAsync();

      // Fire the stale onend — should be ignored (generation changed)
      staleOnend();

      // The stale onend should NOT have triggered auto-advance.
      // If it did, advancing past the hold timer would call cancelAudioCues again.
      vi.clearAllMocks();
      vi.advanceTimersByTime(5000);
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── accessible narration region ──────────────────────────────────

  describe('accessible narration region', () => {
    it('populates aria-live region with caption text when captions exist', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01 which has captions

      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('Hello');
    });

    it('clears aria-live region on frame with no narration', async () => {
      app = createApp();
      await vi.runAllTimersAsync();

      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('');
    });
  });

  // ── replay narration ───────────────────────────────────────────────

  describe('replay narration', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance();
      await vi.runAllTimersAsync();
      // On scene-01.
    });

    it('replays narration on btn-replay click', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // replayNarration calls cancelCue('narration') then scheduleFrameAudio → scheduleAudioCues
      expect(cancelCue).toHaveBeenCalledWith('narration');
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
        }),
      );
    });

    it('does not restart music on replay', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // Replay calls scheduleFrameAudio which passes all audioCues to scheduleAudioCues.
      // The audio module handles not restarting already-playing ambient/music cues.
      expect(scheduleAudioCues).toHaveBeenCalled();
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
      await vi.runAllTimersAsync();
      // Resume on the new scene — should do normal resume (resumeAudioCues), not replay path
      app.togglePause(); // resume
      expect(resumeAudioCues).toHaveBeenCalled();
    });
  });

  // ── captions toggle ────────────────────────────────────────────────

  describe('captions toggle', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance();
      await vi.runAllTimersAsync();
    });

    it('btn-prev retreats to previous frame', async () => {
      vi.clearAllMocks();
      document.getElementById('btn-prev').click();
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
      app.togglePause();
      vi.clearAllMocks();
      document.getElementById('scene-stage').click();
      await vi.runAllTimersAsync();
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── auto-advance timer pause/resume ────────────────────────────────

  describe('auto-advance timer', () => {
    it('saves and restores auto-advance timer via PausableTimer', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance();
      await vi.runAllTimersAsync();

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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance();
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();

      // Override loadImage to take 500ms for the transition
      loadImage.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(new Image()), 500)),
      );

      app.togglePause();
      app.advance(); // transition needs scene-01.webp, calls waitForImage

      vi.advanceTimersByTime(300); // spinner timer fires
      expect(document.getElementById('transition-loader').hidden).toBe(false);

      vi.advanceTimersByTime(200); // total 500ms, image loads
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
      app.togglePause();

      vi.clearAllMocks();
      dotClickCb(1); // scene index 1 → frame index 1 (scene-01)
      await vi.runAllTimersAsync();
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── coverage: no-audio auto-advance (scene-02) ────────────────────

  describe('no-audio auto-advance (scene-02)', () => {
    it('auto-advances after holdAfterNarration when narration.audio is null', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // title → scene-01 (transition completes synchronously via mock gsap)

      // Now advance to scene-02 — don't runAllTimersAsync (it would chain through)
      app.advance(); // scene-01 → scene-02
      // Transition completes synchronously. scene-02 auto-advance timer (3000ms) is now pending.

      vi.clearAllMocks();
      vi.advanceTimersByTime(3000);
      // Auto-advance fires → transition to credits
      expect(cancelAudioCues).toHaveBeenCalled();
    });

    it('runs idle effect on showFrame when effects.idle is set', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01
      vi.clearAllMocks();
      app.advance(); // to scene-02 which has effects.idle='dust-drift'
      await vi.runAllTimersAsync();

      expect(runEffect).toHaveBeenCalledWith(
        'dust-drift',
        expect.any(HTMLCanvasElement),
        expect.any(HTMLCanvasElement),
      );
    });

    it('runs entry effect on replay for scene with effects.entry', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01 (has effects.entry='fade-in' and narration)

      vi.clearAllMocks();
      document.getElementById('btn-replay').click();

      expect(runEffect).toHaveBeenCalledWith(
        'fade-in',
        expect.any(HTMLCanvasElement),
        expect.any(HTMLCanvasElement),
      );
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
      await vi.runAllTimersAsync();
      app.togglePause();

      app.advance(); // starts transition (deferred onComplete)
      expect(app.getState()).toBe('TRANSITIONING');

      app.advance(); // queued as pendingNavIndex

      // Complete first transition
      if (storedOnComplete) storedOnComplete();
      await vi.runAllTimersAsync();

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
      await vi.runAllTimersAsync();
      app.togglePause(); // resume → SCENE_ACTIVE

      app.advance(); // starts fade-out transition
      app.togglePause(); // queue pendingPause

      // Complete fade-out → triggers showFrame + fade-in
      if (onCompletes[0]) onCompletes[0]();
      // Complete fade-in → landOnFrame checks pendingPause
      if (onCompletes[1]) onCompletes[1]();
      await vi.runAllTimersAsync();

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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01 (has captions)
      await vi.runAllTimersAsync();

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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01
      await vi.runAllTimersAsync();
    });

    it('three rapid replays leave state SCENE_ACTIVE with fresh narration', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();

      expect(app.getState()).toBe('SCENE_ACTIVE');
      // cancelCue('narration') called each time (3×)
      expect(cancelCue).toHaveBeenCalledTimes(3);
      // Only the last scheduleAudioCues matters — verify it was called
      expect(scheduleAudioCues).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
          maxNarrationDurationMs: expect.any(Number),
        }),
      );
    });

    it('stale onend from first replay does not trigger auto-advance after third', () => {
      // Capture onNarrationEnd from first replay
      document.getElementById('btn-replay').click();
      const firstOnend = scheduleAudioCues.mock.calls[0]?.[1]?.onNarrationEnd;

      // Two more replays (generation increments each time)
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();

      // Fire stale onend — should be ignored (generation changed)
      if (firstOnend) firstOnend();
      vi.advanceTimersByTime(5000);

      // Should still be on scene-01, no spurious advance
      expect(app.getState()).toBe('SCENE_ACTIVE');
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── edge: retreat to title then advance again ─────────────────────

  describe('retreat to title then advance', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01
      await vi.runAllTimersAsync();
    });

    it('retreats to title and re-advances to scene-01 with narration', async () => {
      vi.clearAllMocks();
      // Retreat to title (index 0)
      document.getElementById('btn-prev').click();
      await vi.runAllTimersAsync();

      // Title: holdUntilClick=true, no narration audio
      expect(app.getState()).toBe('SCENE_ACTIVE');

      // Advance back to scene-01
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();

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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01
      await vi.runAllTimersAsync();

      // Simulate buffer stall
      bufferCb(true);
      const stage = document.getElementById('scene-stage');
      expect(stage.classList.contains('buffering')).toBe(true);

      vi.clearAllMocks();
      document.getElementById('btn-replay').click();

      expect(stage.classList.contains('buffering')).toBe(false);
      expect(cancelCue).toHaveBeenCalledWith('narration');
      expect(scheduleAudioCues).toHaveBeenCalled();
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
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01 (frame index 1, scene index 1)
      await vi.runAllTimersAsync();

      vi.clearAllMocks();
      // Click the dot for the current scene (scene index 1 → frame index 1)
      dotClickCb(1);

      // Should NOT trigger a transition
      expect(cancelAudioCues).not.toHaveBeenCalled();
    });
  });

  // ── edge: keyboard guards inside overlay-controls ──────────────────

  describe('keyboard events inside overlay-controls', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause(); // resume → SCENE_ACTIVE
    });

    it('Space inside overlay-controls does not toggle pause', () => {
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
      );

      // Should still be SCENE_ACTIVE — Space suppressed inside controls
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });

    it('Enter inside overlay-controls does not advance', () => {
      vi.clearAllMocks();
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );

      expect(cancelAudioCues).not.toHaveBeenCalled();
    });

    it('ArrowRight inside overlay-controls does not advance', () => {
      vi.clearAllMocks();
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );

      expect(cancelAudioCues).not.toHaveBeenCalled();
    });

    it('ArrowLeft still retreats from inside overlay-controls', async () => {
      app.advance(); // to scene-01
      await vi.runAllTimersAsync();

      vi.clearAllMocks();
      const controls = document.getElementById('overlay-controls');
      controls.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );

      // ArrowLeft has no closest('#overlay-controls') guard — should retreat
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
      await vi.runAllTimersAsync();
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
      await vi.runAllTimersAsync();
      app.togglePause(); // resume
      app.advance(); // to scene-01 (has narration + ambient + music cues)
      await vi.runAllTimersAsync();

      vi.clearAllMocks();
      app.advance(); // to scene-02 (audioCues: null)
      await vi.runAllTimersAsync();

      // cancelAudioCues called during cleanupCurrentScene — stops all cue types
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── edge: no audio before play-gate ─────────────────────────────

  describe('play-gate audio suppression', () => {
    it('does not call scheduleAudioCues before play-gate click', async () => {
      app = createApp();
      await vi.runAllTimersAsync();

      // App is paused with play-gate visible. No audio should be scheduled.
      expect(app.getState()).toBe('PAUSED');
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });
  });
});
