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
  playAmbient: vi.fn(),
  crossfadeAmbient: vi.fn(),
  playNarration: vi.fn(),
  cueNarration: vi.fn(),
  stopNarration: vi.fn(),
  pauseNarration: vi.fn(),
  resumeNarration: vi.fn(),
  pauseAmbient: vi.fn(),
  resumeAmbient: vi.fn(),
  setMuted: vi.fn(),
  onNarrationBufferChange: vi.fn(),
  preloadNarrationAhead: vi.fn(),
  clearNarrationCache: vi.fn(),
  playMusic: vi.fn(),
  fadeMusic: vi.fn(),
  pauseMusic: vi.fn(),
  resumeMusic: vi.fn(),
  stopMusic: vi.fn(),
  stopAll: vi.fn(),
  isNarrationBuffering: vi.fn().mockReturnValue(false),
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
        ambient: null,
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
          audio: 'narration.mp3',
          delay: 500,
        },
        ambient: { src: 'ambient.mp3', volume: 0.5, loop: true },
        effects: { idle: null, entry: null },
        transition: { type: 'fade', duration: 400 },
        traceOverlay: null,
        music: {
          src: 'credits-music.mp3',
          startVolume: 0,
          fullVolume: 0.5,
          crescendoMs: 2000,
          enter: 100,
          exit: 5000,
        },
      },
      {
        id: 'credits',
        frameType: 'credits',
        holdUntilClick: null,
        holdAfterNarration: null,
        image: 'credits.webp',
        narration: null,
        ambient: null,
        effects: { idle: null, entry: null },
        transition: { type: 'fade', duration: 400 },
        traceOverlay: null,
      },
    ],
  },
}));

import { createApp } from '../../src/app.js';
import {
  stopNarration,
  pauseNarration,
  resumeNarration,
  playNarration,
  cueNarration,
  crossfadeAmbient,
  playMusic,
  fadeMusic,
  stopMusic,
  pauseMusic,
  resumeMusic,
  pauseAmbient,
  resumeAmbient,
  setMuted,
  onNarrationBufferChange,
} from '../../src/audio.js';
import { clearNarrationLayer } from '../../src/text.js';
import { clearEffects } from '../../src/effects.js';
import {
  clearAll as clearCanvasEffects,
  pause as pauseCanvas,
  resume as resumeCanvas,
} from '../../src/effects-canvas.js';
import { drawImage as drawSceneImage, clearScene, drawFallback, loadImage } from '../../src/canvas.js';
import { setCaptionsEnabled, areCaptionsEnabled, clearCaptionElements } from '../../src/captions.js';
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
      app.advance();
      await vi.runAllTimersAsync();
      app.advance();
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

    it('calls pauseNarration and pauseAmbient when pausing', () => {
      app.togglePause();
      vi.clearAllMocks();
      app.togglePause();
      expect(pauseNarration).toHaveBeenCalled();
      expect(pauseAmbient).toHaveBeenCalled();
      expect(pauseMusic).toHaveBeenCalled();
      expect(pauseCanvas).toHaveBeenCalled();
    });

    it('calls resumeNarration and resumeAmbient when resuming', () => {
      app.togglePause();
      app.togglePause();
      vi.clearAllMocks();
      app.togglePause();
      expect(resumeNarration).toHaveBeenCalled();
      expect(resumeAmbient).toHaveBeenCalled();
      expect(resumeMusic).toHaveBeenCalled();
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

    it('calls stopNarration for cleanup', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      expect(stopNarration).toHaveBeenCalled();
    });

    it('cues narration instead of playing during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      // During hard cut (paused), narration should be cued, not played
      expect(cueNarration).toHaveBeenCalledWith('narration.mp3');
      expect(playNarration).not.toHaveBeenCalled();
    });

    it('calls clearEffects during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      expect(clearEffects).toHaveBeenCalled();
      expect(clearCanvasEffects).toHaveBeenCalled();
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
      expect(stopNarration).toHaveBeenCalled();
    });

    it('ArrowLeft retreats when on scene-01', async () => {
      app.togglePause();
      app.advance();
      await vi.runAllTimersAsync();

      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await vi.runAllTimersAsync();
      expect(stopNarration).toHaveBeenCalled();
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

    it('stops narration and music on scene change', async () => {
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      expect(stopNarration).toHaveBeenCalled();
      expect(stopMusic).toHaveBeenCalled();
    });
  });

  // ── ambient audio ──────────────────────────────────────────────────

  describe('ambient audio', () => {
    it('applies crossfadeAmbient when advancing to a scene with ambient', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      vi.clearAllMocks();
      app.advance();
      await vi.runAllTimersAsync();
      expect(crossfadeAmbient).toHaveBeenCalledWith('ambient.mp3', 0.5, 800, true);
    });
  });

  // ── music scheduling ───────────────────────────────────────────────

  describe('music scheduling', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance();
      // Transition completes synchronously (image cached). Timers now pending.
    });

    it('schedules music after enter delay', () => {
      vi.advanceTimersByTime(100);
      expect(playMusic).toHaveBeenCalledWith('credits-music.mp3', 0);
      expect(fadeMusic).toHaveBeenCalledWith(0.5, 2000);
    });

    it('schedules music exit fade', () => {
      vi.advanceTimersByTime(100); // music starts
      vi.clearAllMocks();
      vi.advanceTimersByTime(4900); // exit: 5000 - enter: 100 = 4900
      expect(fadeMusic).toHaveBeenCalledWith(0, 2000);
    });
  });

  // ── narration auto-advance ─────────────────────────────────────────

  describe('narration auto-advance', () => {
    it('schedules auto-advance after narration ends', async () => {
      let capturedOnend;
      playNarration.mockImplementation((src, onend) => {
        capturedOnend = onend;
      });

      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance();

      // Narration delay: 500ms → playNarration called
      vi.advanceTimersByTime(500);
      expect(playNarration).toHaveBeenCalledWith('narration.mp3', expect.any(Function));

      // Simulate narration ending → scheduleAutoAdvance(2000)
      capturedOnend();
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();
      expect(app.getState()).toBe('CREDITS');
    });
  });

  // ── narration generation counter ──────────────────────────────────

  describe('narration generation counter', () => {
    it('ignores stale onend callback after scene change', async () => {
      let capturedOnend;
      playNarration.mockImplementation((src, onend) => {
        capturedOnend = onend;
      });

      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause(); // resume → SCENE_ACTIVE
      app.advance(); // to scene-01
      vi.advanceTimersByTime(500); // narration delay fires
      expect(playNarration).toHaveBeenCalledWith('narration.mp3', expect.any(Function));

      const staleOnend = capturedOnend;

      // Navigate away (to credits) before narration ends
      app.advance();
      await vi.runAllTimersAsync();
      expect(app.getState()).toBe('CREDITS');

      // Fire the stale onend — should be ignored (generation changed)
      vi.clearAllMocks();
      staleOnend();
      vi.advanceTimersByTime(5000);
      // Should remain on credits, no auto-advance scheduled
      expect(app.getState()).toBe('CREDITS');
    });
  });

  // ── replay narration ───────────────────────────────────────────────

  describe('replay narration', () => {
    beforeEach(async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance();
      // On scene-01. narrationTimer (500ms) and musicTimer (100ms) pending.
    });

    it('replays narration on btn-replay click', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // replayNarration clears existing narrationTimer, then buildNarration
      // sets a new 500ms delay timer
      vi.advanceTimersByTime(500);
      expect(playNarration).toHaveBeenCalledWith('narration.mp3', expect.any(Function));
    });

    it('clears active narration timer on replay', () => {
      vi.advanceTimersByTime(200); // partially elapsed narration timer
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // Old timer cleared; new 500ms timer set by buildNarration
      vi.advanceTimersByTime(500);
      expect(playNarration).toHaveBeenCalledWith('narration.mp3', expect.any(Function));
    });

    it('does not restart music on replay', () => {
      vi.advanceTimersByTime(100); // music starts
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      vi.advanceTimersByTime(500);
      // Replay should restart narration but NOT re-trigger music
      expect(playNarration).toHaveBeenCalled();
      expect(playMusic).not.toHaveBeenCalled();
    });

    it('unpauses when replaying while paused', () => {
      app.togglePause();
      expect(app.getState()).toBe('PAUSED');
      document.getElementById('btn-replay').click();
      expect(app.getState()).toBe('SCENE_ACTIVE');
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
      expect(stopNarration).toHaveBeenCalled();
    });

    it('btn-next advances to next frame', async () => {
      vi.clearAllMocks();
      document.getElementById('btn-next').click();
      await vi.runAllTimersAsync();
      expect(app.getState()).toBe('CREDITS');
    });

    it('btn-pause toggles pause via listener', () => {
      document.getElementById('btn-pause').click();
      expect(app.getState()).toBe('PAUSED');
    });
  });

  // ── document click ─────────────────────────────────────────────────

  describe('document click', () => {
    it('advances on click outside controls', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      vi.clearAllMocks();
      document.getElementById('scene-stage').click();
      await vi.runAllTimersAsync();
      expect(stopNarration).toHaveBeenCalled();
    });
  });

  // ── timer pause/resume ─────────────────────────────────────────────

  describe('timer pause/resume', () => {
    describe('before narration plays', () => {
      beforeEach(async () => {
        app = createApp();
        await vi.runAllTimersAsync();
        app.togglePause();
        app.advance();
        // On scene-01. narrationTimer=500ms, musicTimer=100ms. No time elapsed.
      });

      it('saves and restores narration + music timers', () => {
        vi.advanceTimersByTime(50); // 50ms into both timers
        app.togglePause(); // saves remaining: narration=450, music=50
        vi.clearAllMocks();
        app.togglePause(); // restores both

        vi.advanceTimersByTime(50); // music fires
        expect(playMusic).toHaveBeenCalled();
        vi.advanceTimersByTime(400); // narration fires
        expect(playNarration).toHaveBeenCalled();
      });

      it('saves and restores music exit timer', () => {
        vi.advanceTimersByTime(100); // music starts, exit timer set (4900ms)
        vi.advanceTimersByTime(100); // 100ms into exit timer
        vi.clearAllMocks();
        app.togglePause(); // saves exitTimerRemaining ≈ 4800
        app.togglePause(); // restores exit timer

        vi.advanceTimersByTime(4800); // exit timer fires
        expect(fadeMusic).toHaveBeenCalledWith(0, 2000);
      });
    });

    describe('after narration ends', () => {
      it('saves and restores auto-advance timer', async () => {
        let capturedOnend;
        playNarration.mockImplementation((src, onend) => {
          capturedOnend = onend;
        });

        app = createApp();
        await vi.runAllTimersAsync();
        app.togglePause();
        app.advance();
        vi.advanceTimersByTime(500); // narration delay fires
        capturedOnend(); // auto-advance timer set (2000ms)

        vi.advanceTimersByTime(500); // 500ms into auto-advance
        app.togglePause(); // saves remaining ≈ 1500
        vi.clearAllMocks();
        app.togglePause(); // restores

        vi.advanceTimersByTime(1500);
        await vi.runAllTimersAsync();
        expect(app.getState()).toBe('CREDITS');
      });
    });
  });

  // ── cleanup with active timers ─────────────────────────────────────

  describe('cleanup with active timers', () => {
    it('clears narration and music exit timers during scene change', async () => {
      app = createApp();
      await vi.runAllTimersAsync();
      app.togglePause();
      app.advance(); // to scene-01
      vi.advanceTimersByTime(200); // music started (100ms), exit timer active, narrationTimer active

      vi.clearAllMocks();
      app.advance(); // to credits — cleanupCurrentScene runs
      await vi.runAllTimersAsync();

      // Advance way past all original timer deadlines
      vi.advanceTimersByTime(10000);
      // fadeMusic(0,...) should NOT have fired — exit timer was cleared
      expect(fadeMusic).not.toHaveBeenCalled();
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
      expect(crossfadeAmbient).toHaveBeenCalled();
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
      audioCb('ambient.mp3');
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
      expect(stopNarration).toHaveBeenCalled();
    });
  });
});
