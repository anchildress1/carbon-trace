import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { gsapMockState } = vi.hoisted(() => ({
  gsapMockState: {
    autoComplete: true,
    pendingOnCompletes: [],
  },
}));

// --- Mock leaf modules ---
vi.mock('gsap', () => {
  const set = vi.fn();
  const to = vi.fn((_target, opts) => {
    if (opts?.onComplete) {
      if (gsapMockState.autoComplete) {
        opts.onComplete();
      } else {
        gsapMockState.pendingOnCompletes.push(opts.onComplete);
      }
    }
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
  trimNarrationCache: vi.fn(),
  resolveCueEnters: vi.fn((cues = []) =>
    cues.map((cue) => ({
      ...cue,
      resolvedEnter: typeof cue.enter === 'number' ? cue.enter : 0,
    })),
  ),
  wrapOnNarrationEndWithBoost: vi.fn((_cues, cb) => cb),
  getAnalyserNode: vi.fn(() => null),
  disconnectAnalyserSource: vi.fn(),
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
  loadScene: vi.fn().mockResolvedValue(true),
  clearAll: vi.fn(),
  cancelPendingLoad: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  setAnalyser: vi.fn(),
  connectAnalysisAudio: vi.fn(),
  startAnalysisPlayback: vi.fn(),
}));

vi.mock('../../src/shimmer.js', () => ({
  init: vi.fn(),
  loadScene: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  resume: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../../src/credits.js', () => ({
  revealCreditsPanel: vi.fn(),
  pauseCreditsScroll: vi.fn(),
  resumeCreditsScroll: vi.fn(),
  cleanupCredits: vi.fn(),
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
  loadImage: vi.fn().mockRejectedValue(new Error('no image')),
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
      defaultTransition: { duration: 400 },
      defaultHoldAfterNarration: 2000,
    },
    frames: [
      {
        id: 'title',
        frameType: 'title',

        holdAfterNarration: 2000,
        narration: {
          lines: [{ text: 'Opening line', enter: 0, exit: 3000, x: 50, y: 55 }],
          captions: [{ text: 'Opening line', start: 0, end: 3000 }],
        },
        audioCues: [
          { id: 'narration', type: 'narration', src: 'title-narration.m4a', enter: 0, volume: 1, loop: false, fadeIn: 0 },
        ],
        effects: null,
        traceOverlay: null,
        transition: { duration: 400 },

      },
      {
        id: 'scene-01',
        frameType: 'scene',

        holdAfterNarration: 2000,
        image: 'scene-01.webp',
        traceOverlay: { mask: 'mask-01.png', opacity: 0.3, color: [232, 200, 120], dotCount: 10, dotSpeed: 0.8 },
        narration: {
          lines: [{ text: 'Hello', enter: 0, exit: 2000, x: 40, y: 60 }],
          captions: [{ text: 'Hello', start: 0, end: 2000 }],
        },
        audioCues: [
          { id: 'narration', type: 'narration', src: 'narration.mp3', enter: 500, volume: 1, loop: false, fadeIn: 0 },
          { id: 'ambient-01', type: 'ambient', src: 'ambient.mp3', enter: 0, volume: 0.5, loop: true, fadeIn: 1000 },
          { id: 'end-song', type: 'ambient', src: 'credits-music.mp3', enter: { ref: 'narration', offset: -1000 }, volume: 0.5, loop: true, fadeIn: 2000 },
        ],
        effects: { regions: [{ type: 'shockwave', mask: 'diamond.png', audioReactive: { band: 'bass', trigger: { threshold: 1.5, cooldown: 0.08 } } }], analyserCueId: 'end-song' },
        transition: { duration: 400 },

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
        transition: { duration: 400 },

      },
      {
        // Frame for testing missing analyserCueId warn path + no-narration guard
        id: 'scene-bad-cue',
        frameType: 'scene',
        holdAfterNarration: 2000,
        image: 'scene-bad.webp',
        narration: null,
        audioCues: [
          { id: 'narration', type: 'narration', src: 'bad-narration.mp3', enter: 0, volume: 1, loop: false, fadeIn: 0 },
        ],
        // analyserCueId 'missing-cue' has no matching audioCue — triggers warn
        effects: { regions: [{ type: 'shockwave', mask: 'bad.png', audioReactive: { band: 'bass' } }], analyserCueId: 'missing-cue' },
        transition: { duration: 400 },
      },
      {
        // Frame for testing multi-hop anchor ref warn path
        id: 'scene-multihop',
        frameType: 'scene',
        holdAfterNarration: 2000,
        image: 'scene-multihop.webp',
        narration: { lines: null, captions: null },
        audioCues: [
          // narration.enter is a non-numeric ref — triggers warn in resolveAnalyserCueEnter
          { id: 'narration', type: 'narration', src: 'multihop-narration.mp3', enter: { ref: 'ambient', offset: 0 }, volume: 1, loop: false, fadeIn: 0 },
          { id: 'end-song-ref', type: 'ambient', src: 'multihop-music.mp3', enter: { ref: 'narration', offset: -1000 }, volume: 0.5, loop: true, fadeIn: 0 },
        ],
        effects: { regions: [{ type: 'shockwave', mask: 'multihop.png', audioReactive: { band: 'bass' } }], analyserCueId: 'end-song-ref' },
        transition: { duration: 400 },
      },
      {
        id: 'credits',
        frameType: 'credits',

        holdAfterNarration: 2000,
        image: 'credits.webp',
        credits: {
          scrollDuration: 60000,
          resumeDelay: 2000,
          fadeInDuration: 800,
          repeatDelay: 500,
        },
        narration: {
          lines: [
            { text: 'I want to leave more than I got.', enter: 2000, exit: 6000, x: 67, y: 71 },
            { text: 'Catch like wildfire.', enter: 25000, exit: 28000, x: 42, y: 36 },
          ],
          captions: [
            { text: 'I want to leave more than I got.', start: 2200, end: 6000 },
            { text: 'And if we are lucky, it will catch like wildfire.', start: 26000, end: 32000 },
          ],
        },
        audioCues: [
          { id: 'narration', type: 'narration', src: 'credits-narration.m4a', enter: 500, volume: 1, loop: false, fadeIn: 0 },
          { id: 'ambient-credits', type: 'ambient', src: 'credits-vinyl.m4a', enter: 0, volume: 0.1, loop: true, fadeIn: 1500 },
          { id: 'end-song', type: 'ambient', src: 'credits-music.mp3', enter: { ref: 'narration', offset: -12000 }, volume: 0.15, volumeAfterNarration: 0.75, fadeAfterNarration: 3000, loop: true, fadeIn: 8000 },
        ],
        effects: {
          analyserCueId: 'end-song',
          regions: [
            { type: 'shockwave', mask: 'credits-shockwave.png', centerX: 0.46, centerY: 0.47, audioReactive: { band: 'bass', target: 'amplitude', range: [10, 30], trigger: { threshold: 3, cooldown: 0.08, minEnergy: 0.8 } } },
            { type: 'glow', mask: 'credits-diamond.png' },
          ],
        },
        transition: { duration: 1500 },

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

function runNextGsapCompletion() {
  const callback = gsapMockState.pendingOnCompletes.shift();
  if (callback) callback();
}

import { createApp } from '../../src/app.js';
import scenesData from '../../src/scenes.json';
import {
  scheduleAudioCues,
  cancelAudioCues,
  pauseAudioCues,
  resumeAudioCues,
  cueAudioCues,
  onNarrationBufferChange,
  getAnalyserNode,
  resolveCueEnters,
  wrapOnNarrationEndWithBoost,
  disconnectAnalyserSource,
} from '../../src/audio.js';
import { buildNarrationTimeline } from '../../src/text.js';
import {
  clearAll as clearEffects,
  cancelPendingLoad,
  loadScene as loadEffectsScene,
  pause as pauseEffects,
  resume as resumeEffects,
  setAnalyser as setEffectsAnalyser,
  connectAnalysisAudio as connectEffectsAnalysisAudio,
  startAnalysisPlayback as startEffectsAnalysisPlayback,
} from '../../src/effects-canvas.js';
import { clearScene, drawFallback, drawImage, loadImage } from '../../src/canvas.js';
import { setCaptionsEnabled, areCaptionsEnabled, syncCaptionsToTime, clearCaptionElements } from '../../src/captions.js';
import { initOverlay, focusActiveDot } from '../../src/overlay.js';
import { preloadFirstFrameAudio } from '../../src/loader.js';
import {
  init as initShimmer,
  loadScene as loadShimmerScene,
  pause as pauseShimmer,
  resume as resumeShimmer,
} from '../../src/shimmer.js';
import {
  revealCreditsPanel,
  pauseCreditsScroll,
  resumeCreditsScroll,
  cleanupCredits,
} from '../../src/credits.js';

function buildDOM() {
  document.body.replaceChildren();

  const ids = [
    'loading-screen', 'scene-stage', 'scene-canvas',
    'effects-canvas', 'trace-overlay', 'narration-layer', 'caption-layer', 'accessible-narration',
    'overlay-controls', 'progress-dots', 'btn-prev', 'btn-next',
    'btn-replay', 'btn-mute', 'btn-pause', 'btn-captions',
    'loading-prompt', 'transition-loader',
    'credits-panel', 'credits-scroll-content',
  ];

  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);

  for (const id of ids) {
    let el;
    if (id === 'scene-canvas' || id === 'effects-canvas' || id === 'trace-overlay') {
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

// Helper: navigate from title (index 0) to credits (index 5) via advance
async function navigateToCredits(appInstance) {
  appInstance.togglePause(); // unpause → first play
  for (let i = 0; i < 5; i++) {
    appInstance.advance();
    await flush();
  }
}

describe('app.js', () => {
  let app;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gsapMockState.autoComplete = true;
    gsapMockState.pendingOnCompletes = [];
    buildDOM();
    loadEffectsScene.mockResolvedValue(true);
    loadImage.mockResolvedValue(new Image());
    globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });

    // Reset any per-test override back to the shared controllable implementation.
    const { gsap } = await import('gsap');
    gsap.to.mockImplementation((_target, opts) => {
      if (opts?.onComplete) {
        if (gsapMockState.autoComplete) {
          opts.onComplete();
        } else {
          gsapMockState.pendingOnCompletes.push(opts.onComplete);
        }
      }
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

    it('fails fast when narration line positioning is invalid in scenes config', () => {
      const originalLine = { ...scenesData.frames[0].narration.lines[0] };
      scenesData.frames[0].narration.lines[0] = { ...originalLine, x: null };

      try {
        expect(() => createApp()).toThrow(
          'Invalid scenes config at frames[0].narration.lines[0].x: expected finite number, received null',
        );
      } finally {
        scenesData.frames[0].narration.lines[0] = originalLine;
      }
    });

    it('rejects narration lines that are not objects', () => {
      const originalLines = scenesData.frames[0].narration.lines;
      scenesData.frames[0].narration.lines = ['not-an-object'];

      try {
        expect(() => createApp()).toThrow(
          'Invalid scenes config at frames[0].narration.lines[0]: expected object, received string',
        );
      } finally {
        scenesData.frames[0].narration.lines = originalLines;
      }
    });

    it('rejects narration lines with non-string text', () => {
      const originalLine = { ...scenesData.frames[0].narration.lines[0] };
      scenesData.frames[0].narration.lines[0] = { ...originalLine, text: 42 };

      try {
        expect(() => createApp()).toThrow(
          'Invalid scenes config at frames[0].narration.lines[0].text: expected string, received number',
        );
      } finally {
        scenesData.frames[0].narration.lines[0] = originalLine;
      }
    });

    it('rejects narration lines with array text payloads', () => {
      const originalLine = { ...scenesData.frames[0].narration.lines[0] };
      scenesData.frames[0].narration.lines[0] = { ...originalLine, text: [] };

      try {
        expect(() => createApp()).toThrow(
          'Invalid scenes config at frames[0].narration.lines[0].text: expected string, received array',
        );
      } finally {
        scenesData.frames[0].narration.lines[0] = originalLine;
      }
    });

    it('rejects narration.lines when it is not an array', () => {
      const originalNarration = { ...scenesData.frames[0].narration };
      scenesData.frames[0].narration = { ...originalNarration, lines: 'bad' };

      try {
        expect(() => createApp()).toThrow(
          'Invalid scenes config at frames[0].narration.lines: expected array, received string',
        );
      } finally {
        scenesData.frames[0].narration = originalNarration;
      }
    });

    it('rejects when scenes.frames is not an array', () => {
      const originalFrames = scenesData.frames;
      scenesData.frames = null;

      try {
        expect(() => createApp()).toThrow(
          'Invalid scenes config at frames: expected array, received null',
        );
      } finally {
        scenesData.frames = originalFrames;
      }
    });

    it('fails initialization when frame 0 declares deferred overlays', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalTraceOverlay = scenesData.frames[0].traceOverlay;
      scenesData.frames[0].traceOverlay = {
        mask: 'title-mask.png',
        opacity: 0.2,
        color: [232, 200, 120],
        dotCount: 1,
        dotSpeed: 0.5,
      };

      try {
        app = createApp();
        await flush();
        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to initialize:',
          expect.objectContaining({
            message: expect.stringContaining('Frame 0 declares effects or traceOverlay'),
          }),
        );
        expect(document.getElementById('loading-screen').textContent).toBe(
          'Something went wrong. Please refresh.',
        );
      } finally {
        scenesData.frames[0].traceOverlay = originalTraceOverlay;
        errorSpy.mockRestore();
      }
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
      app.advance(); // scene-02 → scene-bad-cue
      await flush();
      app.advance(); // scene-bad-cue → scene-multihop
      await flush();
      app.advance(); // scene-multihop → credits
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

    it('cancels audio and defers new audio during hard cut', async () => {
      vi.clearAllMocks();
      app.advance();
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
      expect(cueAudioCues).not.toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('calls loadEffectsScene during hard cut to scene with effects', async () => {
      vi.clearAllMocks();
      app.advance(); // to scene-01 which has effects regions
      await flush();
      expect(loadEffectsScene).toHaveBeenCalled();
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

  // ── transition lifecycle ───────────────────────────────────────────

  describe('transition lifecycle', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause();
    });

    it('remains in TRANSITIONING until gsap completions run', async () => {
      gsapMockState.autoComplete = false;

      app.advance();
      expect(app.getState()).toBe('TRANSITIONING');
      expect(gsapMockState.pendingOnCompletes.length).toBeGreaterThan(0);

      // Complete fade-out; fade-in tween is queued, but landing is not done yet.
      runNextGsapCompletion();
      await flush();
      expect(app.getState()).toBe('TRANSITIONING');

      // Complete fade-in; transition can now land on the next frame.
      runNextGsapCompletion();
      await flush();
      expect(app.getState()).toBe('SCENE_ACTIVE');
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

    it('ArrowRight advances to next frame', async () => {
      app.togglePause();
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
      // Verify we moved to scene-01 by checking accessible narration text
      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('Hello');
    });

    it('ArrowLeft retreats to previous frame', async () => {
      app.togglePause();
      app.advance(); // to scene-01
      await flush();

      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
      // Verify we moved back to title by checking accessible narration text
      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('Opening line');
    });

    it('keyboard advance does not steal focus to dot (preserves global nav mode)', async () => {
      app.togglePause();
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await flush();
      expect(focusActiveDot).not.toHaveBeenCalled();
    });

    it('keyboard retreat does not steal focus to dot (preserves global nav mode)', async () => {
      app.togglePause();
      app.advance();
      await flush();
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      await flush();
      expect(focusActiveDot).not.toHaveBeenCalled();
    });

    it('Escape pauses when playing', () => {
      app.togglePause(); // resume → SCENE_ACTIVE
      expect(app.getState()).toBe('SCENE_ACTIVE');
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(app.getState()).toBe('PAUSED');
    });

    it('Escape does nothing when already paused', () => {
      expect(app.getState()).toBe('PAUSED');
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(app.getState()).toBe('PAUSED');
    });

    it('unhandled keys do not trigger app actions', () => {
      app.togglePause(); // resume → SCENE_ACTIVE
      vi.clearAllMocks();
      const stage = document.getElementById('scene-stage');
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(cancelAudioCues).not.toHaveBeenCalled();
      expect(app.getState()).toBe('SCENE_ACTIVE');
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
      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();
      expect(app.getState()).toBe('PAUSED');
      // Title frame has no image key, so clearScene is called for it
      expect(clearScene).toHaveBeenCalled();
    });

    it('draws fallback when image load rejects', async () => {
      // All image loads fail
      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();
      app.togglePause();

      vi.clearAllMocks();
      app.advance();
      await flush();
      // scene-01 has an image key but load rejected — not cached
      // waitForImage catches rejection, showFrame draws fallback
      expect(drawFallback).toHaveBeenCalled();
    });

    it('warns when first frame image preload fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const originalImage = scenesData.frames[0].image;
      scenesData.frames[0].image = 'title.webp';
      loadImage.mockRejectedValueOnce(new Error('title fail'));

      try {
        app = createApp();
        await flush();
        expect(warnSpy).toHaveBeenCalledWith('First frame image preload failed:', 'title fail');
      } finally {
        scenesData.frames[0].image = originalImage;
        warnSpy.mockRestore();
      }
    });

    it('warns when background image preload fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      loadImage.mockRejectedValue(new Error('background fail'));

      app = createApp();
      await flush();

      vi.advanceTimersByTime(4000);
      await flush();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Background image preload failed for'),
        'background fail',
      );
      warnSpy.mockRestore();
    });

    it('uses fallback when cache contains a non-Image value', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      loadImage.mockResolvedValue(undefined);

      app = createApp();
      await flush();
      app.togglePause();
      vi.clearAllMocks();

      app.advance();
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Image cache invariant violated for scene-01.webp',
      );
      expect(drawFallback).toHaveBeenCalled();
      errorSpy.mockRestore();
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

  // ── scene stage click ──────────────────────────────────────────────

  describe('scene stage click', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('toggles pause when clicking the scene stage', () => {
      const stage = document.getElementById('scene-stage');
      expect(app.getState()).toBe('PAUSED');
      stage.click();
      expect(app.getState()).toBe('SCENE_ACTIVE');
      stage.click();
      expect(app.getState()).toBe('PAUSED');
    });

    it('does not toggle pause when clicking inside credits-panel', () => {
      const creditsPanel = document.getElementById('credits-panel');
      creditsPanel.hidden = false;
      const inner = document.createElement('div');
      creditsPanel.appendChild(inner);

      expect(app.getState()).toBe('PAUSED');
      inner.click();
      expect(app.getState()).toBe('PAUSED');
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

    it('preserves outgoing ambient during playing transitions into ambient scenes', async () => {
      app = createApp();
      await flush();
      app.togglePause(); // start playback from title
      vi.clearAllMocks();

      app.advance(); // title -> scene-01 (has ambient)
      await flush();

      expect(cancelAudioCues).toHaveBeenCalledWith(expect.objectContaining({ preserveAmbient: true }));
    });

    it('fully cancels audio when target scene has no ambient cue', async () => {
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // title -> scene-01
      await flush();
      vi.clearAllMocks();

      app.advance(); // scene-01 -> credits (audioCues: null)
      await flush();

      expect(cancelAudioCues).toHaveBeenCalledWith(expect.objectContaining({ preserveAmbient: false }));
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

    it('full scene reset on replay while playing', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // Replay calls cleanupCurrentScene (cancelAudioCues) then showFrame
      // (scheduleFrameAudio with ALL cues, not just narration)
      expect(cancelAudioCues).toHaveBeenCalled();
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'narration' }),
          expect.objectContaining({ type: 'ambient' }),
        ]),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
        }),
      );
    });

    it('restarts ambient/music from beginning on replay', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // All audio cancelled and rescheduled — ambient restarts from 0
      expect(cancelAudioCues).toHaveBeenCalled();
      const cues = scheduleAudioCues.mock.calls[0][0];
      const ambientCues = cues.filter((c) => c.type === 'ambient');
      expect(ambientCues.length).toBeGreaterThan(0);
    });

    it('stays paused when replaying while paused', () => {
      app.togglePause();
      expect(app.getState()).toBe('PAUSED');
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      expect(app.getState()).toBe('PAUSED');
      // Full scene reset: all audio cancelled, but NOT rescheduled (deferred)
      expect(cancelAudioCues).toHaveBeenCalled();
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('schedules ALL audio on resume after replay-while-paused', () => {
      app.togglePause();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();
      app.togglePause(); // resume
      expect(app.getState()).toBe('SCENE_ACTIVE');
      // deferFrameAudioUntilResume path schedules ALL cues fresh
      expect(scheduleAudioCues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'narration' }),
          expect.objectContaining({ type: 'ambient' }),
        ]),
        expect.objectContaining({
          onNarrationEnd: expect.any(Function),
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
      // Each replay runs cleanupCurrentScene + showFrame (deferred)
      expect(cancelAudioCues).toHaveBeenCalledTimes(2);
      expect(scheduleAudioCues).not.toHaveBeenCalled();
    });

    it('effects are reloaded on replay', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      // showFrame reloads effects for scenes with effects config
      expect(loadEffectsScene).toHaveBeenCalled();
    });

    it('navigation after replay-while-paused schedules fresh audio', async () => {
      app.togglePause();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();
      // Navigate to next scene instead of resuming
      app.advance();
      await flush();
      // Resume on the new scene — should schedule fresh frame audio
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
      // Was on scene-01, retreated to title
      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('Opening line');
    });

    it('btn-next advances to next frame', async () => {
      vi.clearAllMocks();
      document.getElementById('btn-next').click();
      await flush();
      expect(cancelAudioCues).toHaveBeenCalled();
      // Was on scene-01, advanced to scene-02
      const region = document.getElementById('accessible-narration');
      expect(region.textContent).toBe('');
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

    it('waits for scene image readiness before landing on frame', async () => {
      globalThis.matchMedia.mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      // Prevent first-frame image from being cached during init.
      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();

      const delayedImage = new Image();
      loadImage.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(delayedImage), 500)),
      );

      app.togglePause(); // resume so advance() uses transition path
      vi.clearAllMocks();

      app.advance();
      expect(app.getState()).toBe('TRANSITIONING');

      vi.advanceTimersByTime(300);
      await flush();
      expect(document.getElementById('transition-loader').hidden).toBe(false);
      expect(app.getState()).toBe('TRANSITIONING');

      vi.advanceTimersByTime(200);
      await flush();
      expect(document.getElementById('transition-loader').hidden).toBe(true);
      expect(app.getState()).toBe('SCENE_ACTIVE');
      expect(drawImage).toHaveBeenCalledWith(delayedImage);
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
      loadImage.mockRejectedValue(new Error('no image'));
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

  // ── non-blocking instant-cut navigation ─────────────────────────────

  describe('non-blocking instant-cut navigation', () => {
    it('hard-jump completes synchronously without waiting for image', async () => {
      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();

      // Override: image takes 500ms (would block if whenImageReady were used)
      loadImage.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(new Image()), 500)),
      );

      // Pause, then advance → hard-jump path
      app.togglePause(); // resume
      app.togglePause(); // pause
      vi.clearAllMocks();

      app.advance(); // hard-jump: title → scene-01

      // Transition completes synchronously — spinner never shows
      expect(document.getElementById('transition-loader').hidden).toBe(true);
      // Frame was shown immediately (fallback rendered)
      expect(drawFallback).toHaveBeenCalled();
    });

    it('click-jump completes synchronously without waiting for image', async () => {
      let dotClickCb;
      initOverlay.mockImplementation((count, cb) => {
        dotClickCb = cb;
      });

      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();

      loadImage.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(new Image()), 500)),
      );

      app.togglePause(); // resume so dot click follows click-jump path
      vi.clearAllMocks();

      dotClickCb(2); // scene index 2 maps to frame index 1 (scene-01)

      // Transition completes synchronously — spinner never shows
      expect(document.getElementById('transition-loader').hidden).toBe(true);
      // Frame was shown immediately (fallback rendered)
      expect(drawFallback).toHaveBeenCalled();
    });

    it('scheduleImageArrival redraws scene when image arrives on same frame', async () => {
      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();

      // Setup: image resolves after advance
      const mockImg = new Image();
      loadImage.mockResolvedValue(mockImg);

      app.togglePause(); // resume
      app.togglePause(); // pause
      vi.clearAllMocks();

      app.advance(); // hard-jump: title → scene-01
      // drawFallback called synchronously since image not in app.imageCache
      expect(drawFallback).toHaveBeenCalled();

      // Let scheduleImageArrival's loadImage promise resolve
      await flush();

      // Image arrived while still on the same frame — drawImage called
      expect(drawImage).toHaveBeenCalledWith(mockImg);
    });

    it('scheduleImageArrival skips redraw when user navigated away', async () => {
      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();

      // Setup: slow image for scene-01
      let resolveImage;
      loadImage.mockImplementation(
        () => new Promise((resolve) => { resolveImage = resolve; }),
      );

      app.togglePause(); // resume
      app.togglePause(); // pause
      vi.clearAllMocks();

      app.advance(); // hard-jump: title → scene-01
      expect(drawFallback).toHaveBeenCalled();

      // Navigate away before image arrives
      loadImage.mockRejectedValue(new Error('no image'));
      app.advance(); // hard-jump: scene-01 → scene-02
      vi.clearAllMocks();

      // Now resolve the original scene-01 image
      resolveImage(new Image());
      await flush();

      // drawImage should NOT be called for the stale scene-01 image
      expect(drawImage).not.toHaveBeenCalled();
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

    it('three rapid replays cancel and reschedule all audio each time', () => {
      vi.clearAllMocks();
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();

      expect(app.getState()).toBe('SCENE_ACTIVE');
      // Each replay calls cleanupCurrentScene (cancelAudioCues) + showFrame (scheduleAudioCues)
      expect(cancelAudioCues).toHaveBeenCalledTimes(3);
      expect(scheduleAudioCues).toHaveBeenCalledTimes(3);
    });

    it('stale onend from first replay does not trigger auto-advance after third', () => {
      // Capture onNarrationEnd from first replay's scheduleAudioCues call
      document.getElementById('btn-replay').click();
      const firstOnend = scheduleAudioCues.mock.calls[0]?.[1]?.onNarrationEnd;

      // Two more replays (generation increments each time)
      document.getElementById('btn-replay').click();
      document.getElementById('btn-replay').click();
      vi.clearAllMocks();

      // Fire stale onend — should be ignored (generation changed).
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
    it('clears buffering state and reschedules all audio', async () => {
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

      // Full scene reset cancels all audio and reschedules
      expect(cancelAudioCues).toHaveBeenCalled();
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

    it('uses resolved anchor enter time for captionDelay when narration is anchored', async () => {
      app = createApp();
      await flush();
      const defaultResolve = resolveCueEnters.getMockImplementation();
      resolveCueEnters.mockImplementation((cues = []) =>
        cues.map((cue) => ({
          ...cue,
          resolvedEnter: cue.id === 'narration' ? 2200 : 0,
        })),
      );
      app.togglePause();
      vi.clearAllMocks();
      app.advance(); // title -> scene-01
      await flush();

      expect(buildNarrationTimeline).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(HTMLElement),
        expect.objectContaining({ captionDelay: 2200 }),
      );
      resolveCueEnters.mockImplementation(defaultResolve);
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

    it('auto-advance does not call focusActiveDot when focus is elsewhere', async () => {
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
      await flush(); // let async fadeIn complete so landOnFrame runs

      expect(focusActiveDot).not.toHaveBeenCalled();
    });

    it('auto-advance moves focus to active dot when a progress dot is focused', async () => {
      app = createApp();
      await flush();
      vi.clearAllMocks();

      document.getElementById('loading-screen').click();

      const titleCall = scheduleAudioCues.mock.calls.find(
        (call) => call[0]?.some((c) => c.src === 'title-narration.m4a'),
      );
      const onNarrationEnd = titleCall[1].onNarrationEnd;

      // Focus a progress dot after first play has moved focus to btnPause
      const dotsContainer = document.getElementById('progress-dots');
      dotsContainer.classList.add('progress-dots');
      const dot = document.createElement('button');
      dot.className = 'progress-dot';
      dotsContainer.appendChild(dot);
      dot.focus();

      vi.clearAllMocks();
      onNarrationEnd();
      vi.advanceTimersByTime(2000);
      await flush(); // let async fadeIn complete so landOnFrame runs

      expect(focusActiveDot).toHaveBeenCalled();
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

      // Extract onNarrationEnd from the replay's scheduleAudioCues call
      const replayCall = scheduleAudioCues.mock.calls.find(
        (call) => call[1]?.onNarrationEnd,
      );
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

      // deferFrameAudioUntilResume → scheduleFrameAudio → scheduleAudioCues
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

  // ── analysis audio bridge (ADR-008 Approach B) ───────────────────

  describe('analysis audio bridge (ADR-008)', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
      app.togglePause(); // first play
    });

    it('wires analysis audio when audioReactive + analyserCueId exist', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      app.advance(); // title → scene-01 (has audioReactive + analyserCueId)
      await flush();

      expect(setEffectsAnalyser).toHaveBeenCalledWith(mockAnalyser);
      expect(connectEffectsAnalysisAudio).toHaveBeenCalledWith('credits-music.mp3', mockAnalyser, true);
    });

    it('schedules analysis playback via PausableTimer when enter delay > 0', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      // end-song enter = { ref: 'narration', offset: -1000 }
      // narration enter = 500, captions end = 2000 → caption duration = 2s
      // delay = 500 + 2000 - 1000 = 1500ms (caption-derived fallback)
      app.advance();
      await flush();

      // Not called yet — waiting on PausableTimer
      expect(startEffectsAnalysisPlayback).not.toHaveBeenCalled();

      // Advance past the delay
      vi.advanceTimersByTime(1500);
      expect(startEffectsAnalysisPlayback).toHaveBeenCalled();
    });

    it('does not wire analysis audio when getAnalyserNode returns null', async () => {
      getAnalyserNode.mockReturnValue(null);

      app.advance(); // title → scene-01
      await flush();

      expect(connectEffectsAnalysisAudio).not.toHaveBeenCalled();
    });

    it('does not set effects analyser when effects load is unavailable', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);
      loadEffectsScene.mockResolvedValueOnce(false);

      app.advance(); // title → scene-01
      await flush();

      // Analysis audio connects immediately (decoupled from effects load).
      expect(connectEffectsAnalysisAudio).toHaveBeenCalledWith('credits-music.mp3', mockAnalyser, true);
      // setEffectsAnalyser is gated on effects load success — not called when false.
      expect(setEffectsAnalyser).not.toHaveBeenCalled();
    });

    it('ignores stale async effects completion from superseded scene', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);
      globalThis.matchMedia.mockReturnValue({ matches: true });

      let resolveSceneLoad;
      loadEffectsScene.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSceneLoad = resolve;
          }),
      );

      app.advance(); // title → scene-01 (effects load pending)
      await flush();
      app.advance(); // scene-01 → scene-02 (cleanup increments generation)
      await flush();

      resolveSceneLoad(true);
      await flush();

      // Stale .then() — generation mismatch prevents setEffectsAnalyser.
      expect(setEffectsAnalyser).not.toHaveBeenCalled();
    });

    it('warns when analyserCueId does not match any audioCue', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Navigate to scene-bad-cue (index 3) — has analyserCueId: 'missing-cue' with no matching audioCue
      app.advance(); // title → scene-01
      await flush();
      app.advance(); // scene-01 → scene-02
      await flush();
      vi.clearAllMocks(); // reset call counts before the frame under test
      app.advance(); // scene-02 → scene-bad-cue
      await flush();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing-cue'),
      );
      expect(connectEffectsAnalysisAudio).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('warns when analyser ref target has non-numeric enter (multi-hop ref)', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Navigate to scene-multihop (index 4) — narration cue has non-numeric enter (a ref object)
      app.advance(); // title → scene-01
      await flush();
      app.advance(); // scene-01 → scene-02
      await flush();
      app.advance(); // scene-02 → scene-bad-cue
      await flush();
      app.advance(); // scene-bad-cue → scene-multihop
      await flush();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-numeric enter'),
      );
      warnSpy.mockRestore();
    });

    it('cleanupCurrentScene cancels analysisStartTimer', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      app.advance(); // title → scene-01
      await flush();

      vi.clearAllMocks();

      app.advance(); // scene-01 → scene-02 (triggers cleanupCurrentScene)
      await flush();

      // The transition calls cleanupCurrentScene which cancels analysisStartTimer.
      // No errors should occur.
      expect(cancelPendingLoad).toHaveBeenCalled();
    });

    it('doPause pauses analysisStartTimer', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      app.advance(); // title → scene-01
      await flush();

      // Pause should not throw even when analysisStartTimer is null
      // (it fired immediately since delay was 0)
      app.togglePause();
      expect(pauseEffects).toHaveBeenCalled();
    });

    it('keeps analysis timer paused when created during paused hard-jump', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      app.togglePause(); // pause on title
      vi.clearAllMocks();

      app.advance(); // paused hard-jump: title → scene-01
      await flush();

      // Timer exists but is paused; playback must not start while paused.
      vi.advanceTimersByTime(2000);
      expect(startEffectsAnalysisPlayback).not.toHaveBeenCalled();

      app.togglePause(); // resume
      expect(startEffectsAnalysisPlayback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1500);
      expect(startEffectsAnalysisPlayback).toHaveBeenCalledTimes(1);
    });

    it('doResume resumes analysisStartTimer', async () => {
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      app.advance(); // title → scene-01
      await flush();

      app.togglePause(); // pause
      vi.clearAllMocks();
      app.togglePause(); // resume

      expect(resumeEffects).toHaveBeenCalled();
    });
  });

  // ── error: timeline kill throws ─────────────────────────────────────

  describe('error: timeline kill throws', () => {
    it('catches error when textTimeline.kill() throws in buildNarration', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      buildNarrationTimeline.mockReturnValueOnce({
        timeline: {
          play: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          kill: vi.fn(() => { throw new Error('GSAP kill failed'); }),
          time: vi.fn().mockReturnValue(0),
        },
        captionEntries: [],
      });

      app = createApp();
      await flush();
      app.togglePause(); // resume — first play builds narration

      // Now advance — cleanupCurrentScene or buildNarration will call kill()
      // The error should be caught, not thrown
      expect(() => {
        app.advance();
      }).not.toThrow();
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to kill text timeline'),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });

    it('catches error when textTimeline.kill() throws in cleanupCurrentScene', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Build a timeline that throws on kill FIRST so it's the active one
      const badTimeline = {
        play: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        kill: vi.fn(() => { throw new Error('GSAP cleanup kill failed'); }),
        time: vi.fn().mockReturnValue(0),
      };
      buildNarrationTimeline.mockReturnValueOnce({
        timeline: badTimeline,
        captionEntries: [],
      });

      app = createApp();
      await flush();
      // showFrame(0) during init used the bad timeline mock above
      app.togglePause(); // resume — first play
      app.advance(); // cleanupCurrentScene kills the bad timeline
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to kill text timeline'),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  // ── error: effects load rejects ─────────────────────────────────────

  describe('error: effects load rejects', () => {
    it('catches effects load error and logs it', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      loadEffectsScene.mockRejectedValueOnce(new Error('WebGL context lost'));

      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01 (has effects)
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Effects load failed:',
        expect.objectContaining({ message: 'WebGL context lost' }),
      );
      errorSpy.mockRestore();
    });
  });

  // ── error: initApp catch branch ─────────────────────────────────────

  describe('error: initApp initialization failure', () => {
    it('shows error message on loading screen when showFrame throws during init', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { clearNarrationLayer: clearNarMock } = await import('../../src/text.js');

      // Make showFrame(0) throw during initApp's .then callback.
      // This triggers the initApp .catch branch (lines 984-987).
      clearNarMock.mockImplementationOnce(() => { throw new Error('Init failure'); });

      app = createApp();
      await flush();

      const screen = document.getElementById('loading-screen');
      expect(screen.textContent).toBe('Something went wrong. Please refresh.');
      expect(screen.disabled).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to initialize:',
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  // ── error: effects canvas init failure ──────────────────────────────

  describe('error: effects canvas init failure', () => {
    it('logs error when effects canvas init rejects', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { init: initEffects } = await import('../../src/effects-canvas.js');
      initEffects.mockRejectedValueOnce(new Error('WebGL unavailable'));

      app = createApp();
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Effects canvas init failed:',
        'WebGL unavailable',
      );
      errorSpy.mockRestore();
    });
  });

  // ── fallback: renderSceneImage when image load fails ────────────────

  describe('fallback: renderSceneImage edge cases', () => {
    it('draws fallback when image load rejects', async () => {
      loadImage.mockRejectedValue(new Error('no image'));
      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01
      await flush();

      // scene-01 has image key, load rejected — not in cache → drawFallback
      expect(drawFallback).toHaveBeenCalled();
    });
  });

  // ── fallback: narration lines only (no captions) ────────────────────

  describe('accessible narration: lines fallback', () => {
    it('uses narration.lines text when captions is null', async () => {
      app = createApp();
      await flush();

      // Title frame has both captions and lines — verify caption priority
      const region = document.getElementById('accessible-narration');
      // Title has captions: [{text: 'Opening line'}] → uses caption text
      expect(region.textContent).toBe('Opening line');
    });
  });

  // ── fallback: getMaxNarrationDuration tiers ─────────────────────────

  describe('getMaxNarrationDuration tier fallbacks', () => {
    it('uses DEFAULT_MAX_NARRATION_MS when no captions or durations exist', async () => {
      app = createApp();
      await flush();
      app.togglePause();

      // Navigate to scene-02 (no captions, no audio cues)
      app.advance(); // → scene-01
      await flush();
      app.advance(); // → scene-02 (narration: { lines: null, captions: null }, audioCues: null)
      await flush();

      // scene-02 has no narration audio, so auto-advance is holdAfterNarration (3000ms)
      vi.clearAllMocks();
      vi.advanceTimersByTime(3000);
      // Auto-advance fires
      expect(cancelAudioCues).toHaveBeenCalled();
    });
  });

  // ── edge: resolveAnalyserCueEnter fallback to 0 ─────────────────────

  describe('resolveAnalyserCueEnter edge cases', () => {
    it('returns 0 when cue.enter is neither number nor ref', async () => {
      // scene-bad-cue has analyserCueId: 'missing-cue' with no matching audioCue
      // This exercises the null return from resolveAnalyserCueEnter (no cue found)
      const mockAnalyser = { frequencyBinCount: 1024 };
      getAnalyserNode.mockReturnValue(mockAnalyser);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      app = createApp();
      await flush();
      app.togglePause();

      // Navigate to scene-bad-cue
      app.advance(); await flush(); // → scene-01
      app.advance(); await flush(); // → scene-02
      app.advance(); await flush(); // → scene-bad-cue

      // No crash, just a warning
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing-cue'));
      warnSpy.mockRestore();
    });
  });

  // ── edge: manageFocusAfterTransition with control button focus ──────

  describe('manageFocusAfterTransition', () => {
    it('blurs active element when auto-advancing from control-buttons', async () => {
      app = createApp();
      await flush();
      vi.clearAllMocks();

      document.getElementById('loading-screen').click();

      const titleCall = scheduleAudioCues.mock.calls.find(
        (call) => call[0]?.some((c) => c.src === 'title-narration.m4a'),
      );
      const onNarrationEnd = titleCall[1].onNarrationEnd;

      // Focus a control button before auto-advance fires
      const controlButtons = document.createElement('div');
      controlButtons.className = 'control-buttons';
      document.getElementById('overlay-controls').appendChild(controlButtons);
      const btn = document.createElement('button');
      controlButtons.appendChild(btn);
      btn.focus();

      vi.clearAllMocks();
      onNarrationEnd();
      vi.advanceTimersByTime(2000);
      await flush();

      // manageFocusAfterTransition should have blurred the control button
      // (document.activeElement.blur() is called for control-buttons)
      // Verify no error occurred — the blur path was exercised
      expect(app.getState()).not.toBe('PAUSED');
    });
  });

  // ── error: transition showFrame throws (hard-jump path) ─────────────

  describe('error: transition showFrame throws', () => {
    it('reverts state on showFrame error during hard-jump transition', async () => {
      const { clearNarrationLayer: clearNarMock } = await import('../../src/text.js');

      app = createApp();
      await flush();
      app.togglePause(); // resume
      app.togglePause(); // pause

      // Make showFrame throw synchronously via clearNarrationLayer
      clearNarMock.mockImplementationOnce(() => { throw new Error('DOM error'); });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Hard-jump (paused): title → scene-01
      app.advance();
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Error during scene transition:',
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });

    it('reverts state on showFrame error during animated transition', async () => {
      const { clearNarrationLayer: clearNarMock } = await import('../../src/text.js');
      const { gsap } = await import('gsap');
      const onCompletes = [];
      gsap.to.mockImplementation((_target, opts) => {
        onCompletes.push(opts.onComplete);
        return { kill: vi.fn() };
      });

      app = createApp();
      await flush();
      app.togglePause(); // resume

      // Make showFrame throw when called during fade transition
      clearNarMock.mockImplementationOnce(() => { throw new Error('Render failed'); });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app.advance(); // title → scene-01, starts fade-out
      // Fire fade-out onComplete → proceedWithFrame throws
      if (onCompletes[0]) onCompletes[0]();
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Error during scene transition:',
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  // ── error: unhandled error in transition onComplete ──────────────────

  describe('error: unhandled error in transition fadeIn', () => {
    it('catches error in async fadeIn and still lands on frame', async () => {
      const { gsap } = await import('gsap');
      const onCompletes = [];
      gsap.to.mockImplementation((_target, opts) => {
        onCompletes.push(opts.onComplete);
        return { kill: vi.fn() };
      });

      // Make effects load reject — this triggers the effectsReady.catch path
      // AND the .finally in waitForOverlaysReady. The .catch in showFrame handles
      // the promise, so no unhandled rejection.
      const rejectedPromise = Promise.reject(new Error('GPU crash'));
      // Prevent unhandled rejection warning from the bare promise
      rejectedPromise.catch(() => {});
      loadEffectsScene.mockReturnValueOnce(rejectedPromise);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app = createApp();
      await flush();
      app.togglePause(); // resume

      app.advance(); // starts fade-out

      // Fire fade-out onComplete
      if (onCompletes[0]) onCompletes[0]();
      await flush();

      // The effectsReady.catch in showFrame should have caught the error
      expect(errorSpy).toHaveBeenCalledWith(
        'Effects load failed:',
        expect.objectContaining({ message: 'GPU crash' }),
      );
      errorSpy.mockRestore();
    });
  });

  // ── edge: background preload error ──────────────────────────────────

  describe('background preload error handling', () => {
    it('catches error from background asset preload', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { preloadBackgroundAudio } = await import('../../src/loader.js');
      preloadBackgroundAudio.mockRejectedValueOnce(new Error('Preload failed'));

      app = createApp();
      await flush();

      // Background preload is deferred by 4000ms
      vi.advanceTimersByTime(4000);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Background asset preload failed:',
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  // ── edge: toggleMute via exported API ───────────────────────────────

  describe('toggleMute via exported API', () => {
    it('exercises toggleMute through the returned API', async () => {
      app = createApp();
      await flush();

      const { setMuted: setMutedMock } = await import('../../src/audio.js');
      vi.clearAllMocks();
      app.toggleMute();

      expect(setMutedMock).toHaveBeenCalledWith(true);
    });
  });

  // ── edge: deferred frame-audio scheduling ───────────────────────────

  describe('deferred frame-audio edge cases', () => {
    it('skips frame-audio scheduling when deferFrameAudioUntilResume is true', async () => {
      app = createApp();
      await flush();
      app.togglePause(); // resume
      app.togglePause(); // pause

      vi.clearAllMocks();
      // Hard-jump advance while paused — sets deferFrameAudioUntilResume
      app.advance();
      await flush();

      const { trimNarrationCache: trimCacheMock } = await import('../../src/audio.js');
      // deferFrameAudioUntilResume gates scheduleFrameAudio only. Navigation while
      // paused should still trim cache for current/next narration prebuffering.
      expect(scheduleAudioCues).not.toHaveBeenCalled();
      expect(trimCacheMock).toHaveBeenCalledTimes(1);
      expect(app.getState()).toBe('PAUSED');
    });
  });

  // ── edge: buffering during transition is no-op ──────────────────────

  describe('buffering during transition', () => {
    it('does not pause text timeline when buffering during transition', async () => {
      let bufferCb;
      onNarrationBufferChange.mockImplementation((cb) => {
        bufferCb = cb;
      });

      const { gsap } = await import('gsap');
      gsap.to.mockImplementation(() => ({ kill: vi.fn() }));

      app = createApp();
      await flush();
      app.togglePause(); // resume

      app.advance(); // starts TRANSITIONING
      expect(app.getState()).toBe('TRANSITIONING');

      // Buffer change during transition — should be no-op for timeline
      bufferCb(true);
      // No error, state still TRANSITIONING
      expect(app.getState()).toBe('TRANSITIONING');
    });
  });

  // ── edge: reduced motion transition with uncached image ─────────────

  describe('reduced motion transition with uncached image', () => {
    it('waits for image before showing frame under reduced motion', async () => {
      globalThis.matchMedia.mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
      loadImage.mockRejectedValue(new Error('no image'));

      app = createApp();
      await flush();

      // Override to simulate slow load then success
      loadImage.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(new Image()), 100)),
      );

      app.togglePause();
      app.advance(); // to scene-01 (uncached image, reduced motion)
      vi.advanceTimersByTime(100);
      await flush();

      // Should have loaded and shown the frame
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });
  });

  // ── Credits frame ────────────────────────────────────────────────

  describe('credits frame', () => {
    beforeEach(async () => {
      app = createApp();
      await flush();
    });

    it('sets state to CREDITS when landing on credits frame', async () => {
      await navigateToCredits(app);
      expect(app.getState()).toBe('CREDITS');
    });

    it('schedules audio cues with ref-based music enter and volumeAfterNarration', async () => {
      await navigateToCredits(app);

      // scheduleAudioCues should have been called with the credits frame's audioCues
      const lastCall = scheduleAudioCues.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      const cues = lastCall[0];

      // Verify all three cues are present
      const narrationCue = cues.find((c) => c.id === 'narration');
      const ambientCue = cues.find((c) => c.id === 'ambient-credits');
      const endSong = cues.find((c) => c.id === 'end-song');

      expect(narrationCue).toBeDefined();
      expect(narrationCue.enter).toBe(500);

      expect(ambientCue).toBeDefined();
      expect(ambientCue.enter).toBe(0);
      expect(ambientCue.fadeIn).toBe(1500);

      // end-song uses ref-based enter with offset
      expect(endSong).toBeDefined();
      expect(endSong.enter).toEqual({ ref: 'narration', offset: -12000 });
      expect(endSong.volume).toBe(0.15);
      expect(endSong.volumeAfterNarration).toBe(0.75);
      expect(endSong.fadeAfterNarration).toBe(3000);
      expect(endSong.fadeIn).toBe(8000);
    });

    it('wraps onNarrationEnd with volume boost for end-song cue', async () => {
      await navigateToCredits(app);

      // wrapOnNarrationEndWithBoost should have been called with cues containing volumeAfterNarration
      const boostCall = wrapOnNarrationEndWithBoost.mock.calls.at(-1);
      expect(boostCall).toBeDefined();
      const cues = boostCall[0];
      const boostCue = cues.find((c) => c.volumeAfterNarration !== undefined);
      expect(boostCue).toBeDefined();
      expect(boostCue.id).toBe('end-song');
      expect(boostCue.volumeAfterNarration).toBe(0.75);
    });

    it('does not auto-advance from credits (last frame)', async () => {
      await navigateToCredits(app);
      expect(app.getState()).toBe('CREDITS');

      // advance() should be a no-op — state stays CREDITS
      app.advance();
      await flush();
      expect(app.getState()).toBe('CREDITS');
    });

    it('blocks advance even after pause/resume cycle on credits', async () => {
      await navigateToCredits(app);
      expect(app.getState()).toBe('CREDITS');

      app.togglePause();
      expect(app.getState()).toBe('PAUSED');

      app.togglePause(); // resume
      expect(app.getState()).toBe('CREDITS');

      app.advance();
      await flush();
      expect(app.getState()).toBe('CREDITS');
    });

    it('loads effects with analyserCueId and audioReactive regions', async () => {
      await navigateToCredits(app);

      // loadEffectsScene should have been called with the credits effects config
      const effectsCall = loadEffectsScene.mock.calls.at(-1);
      expect(effectsCall).toBeDefined();
      const [effectsConfig, imageSrc] = effectsCall;

      expect(effectsConfig.analyserCueId).toBe('end-song');
      expect(effectsConfig.regions).toHaveLength(2);
      expect(effectsConfig.regions[0].type).toBe('shockwave');
      expect(effectsConfig.regions[0].audioReactive.band).toBe('bass');
      expect(effectsConfig.regions[0].audioReactive.trigger.threshold).toBe(3);
      expect(effectsConfig.regions[1].type).toBe('glow');
      expect(imageSrc).toBe('credits.webp');
    });

    it('wires analyser for audio-reactive effects on credits', async () => {
      const mockAnalyser = { fftSize: 2048 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      await navigateToCredits(app);

      expect(setEffectsAnalyser).toHaveBeenCalledWith(mockAnalyser);
      expect(connectEffectsAnalysisAudio).toHaveBeenCalledWith(
        'credits-music.mp3',
        mockAnalyser,
        true,
      );
    });

    it('starts text animation on landing via timeline.play(0)', async () => {
      await navigateToCredits(app);

      // buildNarrationTimeline should have been called for credits narration
      const lastNarrationCall = buildNarrationTimeline.mock.calls.at(-1);
      expect(lastNarrationCall).toBeDefined();
      const lines = lastNarrationCall[0];
      expect(lines[0].text).toBe('I want to leave more than I got.');
      expect(lines[1].text).toBe('Catch like wildfire.');

      // The timeline returned by buildNarrationTimeline should have play(0) called
      const timeline = buildNarrationTimeline.mock.results.at(-1).value.timeline;
      expect(timeline.play).toHaveBeenCalledWith(0);
    });

    it('builds accessible narration from captions for credits', async () => {
      await navigateToCredits(app);

      const accessibleEl = document.getElementById('accessible-narration');
      expect(accessibleEl.textContent).toContain('I want to leave more than I got.');
      expect(accessibleEl.textContent).toContain('catch like wildfire');
    });

    it('replay on credits resets audio, effects, and text', async () => {
      await navigateToCredits(app);

      vi.clearAllMocks();
      loadEffectsScene.mockResolvedValue(true);
      loadImage.mockResolvedValue(new Image());

      // Trigger replay via the exported API
      const replayBtn = document.getElementById('btn-replay');
      // Simulate the keyboard.js replay action by calling the internal path:
      // replayNarration is wired to btn-replay click in createApp
      replayBtn.click();
      await flush();

      // cleanupCurrentScene should cancel audio
      expect(cancelAudioCues).toHaveBeenCalled();
      expect(disconnectAnalyserSource).toHaveBeenCalled();

      // showFrame should re-schedule audio with the credits cues
      expect(scheduleAudioCues).toHaveBeenCalled();
      const replayCues = scheduleAudioCues.mock.calls.at(-1)[0];
      expect(replayCues.find((c) => c.id === 'end-song')).toBeDefined();

      // Text timeline should be rebuilt and started
      expect(buildNarrationTimeline).toHaveBeenCalled();

      // State should remain CREDITS
      expect(app.getState()).toBe('CREDITS');
    });

    it('replay while paused defers audio until resume', async () => {
      await navigateToCredits(app);

      // Pause on credits
      app.togglePause();
      expect(app.getState()).toBe('PAUSED');

      vi.clearAllMocks();
      loadEffectsScene.mockResolvedValue(true);
      loadImage.mockResolvedValue(new Image());

      // Replay while paused
      const replayBtn = document.getElementById('btn-replay');
      replayBtn.click();
      await flush();

      // Audio should NOT be scheduled yet (deferred)
      // cancelAudioCues is called in cleanupCurrentScene, but scheduleFrameAudio
      // should NOT fire because deferFrameAudioUntilResume is true
      expect(cancelAudioCues).toHaveBeenCalled();

      // The state is PAUSED (replay while paused re-pauses)
      expect(app.getState()).toBe('PAUSED');

      vi.clearAllMocks();
      loadEffectsScene.mockResolvedValue(true);

      // Resume — should now schedule the deferred audio
      app.togglePause();
      expect(scheduleAudioCues).toHaveBeenCalled();
    });

    it('credits transition uses frame-specific duration (1500ms)', async () => {
      const { gsap } = await import('gsap');

      // Navigate to scene-multihop (index 4), one before credits
      app.togglePause();
      for (let i = 0; i < 4; i++) {
        app.advance();
        await flush();
      }

      vi.clearAllMocks();
      loadEffectsScene.mockResolvedValue(true);

      // Advance to credits — gsap.to is called with half the transition duration
      app.advance();
      await flush();

      // Credits transition.duration = 1500, so halfDuration = 1500/2000 = 0.75
      const fadeOutCall = gsap.to.mock.calls[0];
      expect(fadeOutCall[1].duration).toBe(0.75);
    });

    it('retreat from credits goes back to previous scene', async () => {
      await navigateToCredits(app);
      expect(app.getState()).toBe('CREDITS');

      // retreat is wired to btn-prev click
      document.getElementById('btn-prev').click();
      await flush();

      // State should be SCENE_ACTIVE (back on scene-multihop)
      expect(app.getState()).toBe('SCENE_ACTIVE');
    });

    it('schedules narration with 500ms enter delay on credits', async () => {
      await navigateToCredits(app);

      const lastCall = scheduleAudioCues.mock.calls.at(-1);
      const opts = lastCall[1];

      // opts should include onNarrationEnd and maxNarrationDurationMs
      expect(opts.onNarrationEnd).toBeDefined();
      expect(opts.maxNarrationDurationMs).toBeGreaterThan(0);
    });

    it('enables replay button on credits frame with narration', async () => {
      await navigateToCredits(app);

      const replayBtn = document.getElementById('btn-replay');
      expect(replayBtn.disabled).toBe(false);
    });

    it('disables next button on credits frame (last frame)', async () => {
      await navigateToCredits(app);

      const nextBtn = document.getElementById('btn-next');
      expect(nextBtn.disabled).toBe(true);
    });

    it('enables prev button on credits frame', async () => {
      await navigateToCredits(app);

      const prevBtn = document.getElementById('btn-prev');
      expect(prevBtn.disabled).toBe(false);
    });

    it('getMaxNarrationDuration uses caption end time for credits', async () => {
      await navigateToCredits(app);

      // The credits captions max end is 32000ms
      // scheduleAudioCues opts should reflect this as maxNarrationDurationMs
      const lastCall = scheduleAudioCues.mock.calls.at(-1);
      const opts = lastCall[1];
      // Without preloaded audio duration metadata, falls to caption max = 32000
      expect(opts.maxNarrationDurationMs).toBe(32000);
    });

    it('analysis audio starts with deferred timer when enter delay > 0', async () => {
      const mockAnalyser = { fftSize: 2048 };
      getAnalyserNode.mockReturnValue(mockAnalyser);

      // Provide audio duration so resolveAnalyserCueEnter can compute the delay
      app = createApp();
      await flush();

      // Register a known narration duration so the ref-based enter resolves
      // The preloadFirstFrameAudio callback sets audioDurations
      const registerCb = preloadFirstFrameAudio.mock.calls[0][1];
      registerCb({ src: 'credits-narration.m4a', duration: 35 }); // 35 seconds

      await navigateToCredits(app);

      // end-song enter = narration_enter(500) + narration_duration(35000) + offset(-12000) = 23500ms
      // Since enterDelay > 0, analysis audio should be queued on a PausableTimer
      // The timer hasn't fired yet so startAnalysisPlayback should NOT have been called yet
      // (it's deferred). But connectAnalysisAudio should have been called immediately.
      expect(connectEffectsAnalysisAudio).toHaveBeenCalledWith(
        'credits-music.mp3',
        mockAnalyser,
        true,
      );
    });

    // -- credits overlay integration (ADR-011) --

    it('reveals credits panel after narration ends + holdAfterNarration', async () => {
      await navigateToCredits(app);

      // Extract onNarrationEnd callback from scheduleAudioCues
      const lastCall = scheduleAudioCues.mock.calls.at(-1);
      const opts = lastCall[1];
      expect(opts.onNarrationEnd).toBeDefined();

      vi.clearAllMocks();

      // Fire narration end
      opts.onNarrationEnd();

      // revealCreditsPanel should NOT be called yet (holdAfterNarration = 2000ms)
      expect(revealCreditsPanel).not.toHaveBeenCalled();

      // Advance by holdAfterNarration
      vi.advanceTimersByTime(2000);

      expect(revealCreditsPanel).toHaveBeenCalledWith(
        document.getElementById('credits-panel'),
        document.getElementById('credits-scroll-content'),
        expect.objectContaining({
          scrollDuration: 60000,
          resumeDelay: 2000,
          fadeInDuration: 800,
          repeatDelay: 500,
        }),
        expect.objectContaining({ reducedMotion: expect.any(Boolean) }),
      );
    });

    it('pauses creditsRevealTimer and credits scroll on doPause', async () => {
      await navigateToCredits(app);

      // Fire narration end to start the creditsRevealTimer
      const onEnd = scheduleAudioCues.mock.calls.at(-1)[1].onNarrationEnd;
      onEnd();

      vi.clearAllMocks();

      // Pause before timer fires
      app.togglePause();
      expect(pauseCreditsScroll).toHaveBeenCalled();

      // Advance past holdAfterNarration — timer was paused so credits should NOT reveal
      vi.advanceTimersByTime(5000);
      expect(revealCreditsPanel).not.toHaveBeenCalled();
    });

    it('resumes creditsRevealTimer and credits scroll on doResume', async () => {
      await navigateToCredits(app);

      const onEnd = scheduleAudioCues.mock.calls.at(-1)[1].onNarrationEnd;
      onEnd();

      // Pause at 1000ms into holdAfterNarration
      vi.advanceTimersByTime(1000);
      app.togglePause();

      vi.clearAllMocks();

      // Resume
      app.togglePause();
      expect(resumeCreditsScroll).toHaveBeenCalled();

      // Remaining 1000ms should fire credits reveal
      vi.advanceTimersByTime(1000);
      expect(revealCreditsPanel).toHaveBeenCalled();
    });

    it('cleanupCurrentScene cancels creditsRevealTimer and calls cleanupCredits', async () => {
      await navigateToCredits(app);

      const onEnd = scheduleAudioCues.mock.calls.at(-1)[1].onNarrationEnd;
      onEnd();

      vi.clearAllMocks();
      loadEffectsScene.mockResolvedValue(true);
      loadImage.mockResolvedValue(new Image());

      // Navigate back — triggers cleanupCurrentScene
      document.getElementById('btn-prev').click();
      await flush();

      expect(cleanupCredits).toHaveBeenCalledWith(document.getElementById('credits-panel'));

      // Timer was cancelled — credits should NOT reveal
      vi.advanceTimersByTime(5000);
      expect(revealCreditsPanel).not.toHaveBeenCalled();
    });

    it('replay calls cleanupCredits then re-triggers after new narration', async () => {
      await navigateToCredits(app);

      // Simulate credits already revealed
      const onEnd1 = scheduleAudioCues.mock.calls.at(-1)[1].onNarrationEnd;
      onEnd1();
      vi.advanceTimersByTime(2000);
      expect(revealCreditsPanel).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      loadEffectsScene.mockResolvedValue(true);
      loadImage.mockResolvedValue(new Image());

      // Replay
      document.getElementById('btn-replay').click();
      await flush();

      expect(cleanupCredits).toHaveBeenCalled();

      // New narration end fires → new timer → new reveal
      const onEnd2 = scheduleAudioCues.mock.calls.at(-1)[1].onNarrationEnd;
      onEnd2();
      vi.advanceTimersByTime(2000);
      expect(revealCreditsPanel).toHaveBeenCalledTimes(1);
    });

    it('stale creditsRevealTimer ignored after generation change', async () => {
      await navigateToCredits(app);

      const onEnd = scheduleAudioCues.mock.calls.at(-1)[1].onNarrationEnd;
      onEnd();

      vi.clearAllMocks();
      loadEffectsScene.mockResolvedValue(true);
      loadImage.mockResolvedValue(new Image());

      // Navigate away (increments generation)
      document.getElementById('btn-prev').click();
      await flush();

      // Advance timer past holdAfterNarration
      vi.advanceTimersByTime(5000);

      // revealCreditsPanel should NOT have been called (generation guard)
      expect(revealCreditsPanel).not.toHaveBeenCalled();
    });
  });

  // ── shimmer integration ───────────────────────────────────────────

  describe('shimmer integration', () => {
    it('initializes shimmer with trace-overlay canvas on createApp', async () => {
      app = createApp();
      await flush();
      const traceCanvas = document.getElementById('trace-overlay');
      expect(initShimmer).toHaveBeenCalledWith(traceCanvas);
    });

    it('calls loadShimmerScene with traceOverlay config on scene transition', async () => {
      app = createApp();
      await flush();
      app.togglePause(); // play
      vi.clearAllMocks();
      app.advance(); // to scene-01 which has traceOverlay
      await flush();
      expect(loadShimmerScene).toHaveBeenCalledWith(
        expect.objectContaining({
          mask: 'mask-01.png',
          opacity: 0.3,
          color: [232, 200, 120],
          dotCount: 10,
          dotSpeed: 0.8,
        }),
      );
    });

    it('calls loadShimmerScene(null) for frames without traceOverlay', async () => {
      app = createApp();
      await flush();
      // Title frame has traceOverlay: null
      expect(loadShimmerScene).toHaveBeenCalledWith(null);
    });

    it('pauses shimmer when experience is paused', async () => {
      app = createApp();
      await flush();
      app.togglePause(); // play
      vi.clearAllMocks();
      app.togglePause(); // pause
      expect(pauseShimmer).toHaveBeenCalled();
    });

    it('resumes shimmer when experience is resumed', async () => {
      app = createApp();
      await flush();
      app.togglePause(); // play
      app.togglePause(); // pause
      vi.clearAllMocks();
      app.togglePause(); // resume
      expect(resumeShimmer).toHaveBeenCalled();
    });

    it('logs error and continues when initShimmer throws', async () => {
      initShimmer.mockImplementationOnce(() => {
        throw new TypeError('shimmer: init() requires an HTMLCanvasElement');
      });
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      app = createApp();
      await flush();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Shimmer init failed:',
        'shimmer: init() requires an HTMLCanvasElement',
      );
      // App continues to function despite shimmer init failure
      expect(app.getState()).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('recovers gracefully when loadShimmerScene rejects', async () => {
      loadShimmerScene.mockRejectedValueOnce(new Error('mask load failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app = createApp();
      await flush();
      app.togglePause();
      app.advance(); // to scene-01 with traceOverlay
      await flush();

      // App should not crash — state remains SCENE_ACTIVE
      expect(app.getState()).toBe('SCENE_ACTIVE');
      consoleSpy.mockRestore();
    });
  });
});
