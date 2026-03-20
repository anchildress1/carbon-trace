import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let lastHowlOptions = null;

const mockNode = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  buffered: { length: 0, end: vi.fn() },
  currentTime: 0,
  duration: 60,
  play: vi.fn().mockResolvedValue(undefined),
  src: '',
};

function createMockHowlInstance() {
  const volume = vi.fn((value) => {
    if (value === undefined) return 0.15;
    return undefined;
  });

  return {
    play: vi.fn(),
    stop: vi.fn(),
    fade: vi.fn(),
    mute: vi.fn(),
    pause: vi.fn(),
    unload: vi.fn(),
    volume,
    once: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    _sounds: [{ _node: mockNode }],
  };
}

vi.mock('howler', () => ({
  Howl: vi.fn(function (opts) {
    lastHowlOptions = opts;
    Object.assign(this, createMockHowlInstance());
  }),
}));

vi.mock('../../src/pausable-timer.js', () => {
  class MockPausableTimer {
    #callback;
    #delay;
    #paused = false;
    #cancelled = false;
    #fired = false;
    #timerId = null;
    #start = null;
    #remaining = null;

    constructor(callback, delay) {
      this.#callback = callback;
      this.#delay = delay;
      this.#start = Date.now();
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
      const elapsed = Date.now() - this.#start;
      this.#remaining = Math.max(0, this.#delay - elapsed);
      if (this.#timerId) {
        clearTimeout(this.#timerId);
        this.#timerId = null;
      }
    }

    resume() {
      if (!this.#paused || this.#cancelled || this.#fired) return;
      this.#paused = false;
      this.#delay = this.#remaining;
      this.#start = Date.now();
      this.#timerId = setTimeout(() => {
        if (this.#cancelled) return;
        this.#fired = true;
        this.#timerId = null;
        this.#callback();
      }, this.#remaining);
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

import {
  scheduleAudioCues,
  cancelAudioCues,
  pauseAudioCues,
  resumeAudioCues,
  cueAudioCues,
  cancelCue,
  restartNarrationCue,
  reCueCue,
  getNarrationCue,
  setMuted,
  onNarrationBufferChange,
  isNarrationBuffering,
  preloadNarrationAhead,
  clearNarrationCache,
} from '../../src/audio.js';
import { Howl } from 'howler';

function makeCue(overrides = {}) {
  return {
    id: 'narration',
    type: 'narration',
    src: 'test.m4a',
    enter: 0,
    volume: 1.0,
    loop: false,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides,
  };
}

describe('audio.js — unified cue API (ADR-005)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockNode.addEventListener.mockClear();
    mockNode.removeEventListener.mockClear();
    mockNode.play.mockResolvedValue(undefined);
    cancelAudioCues();
    clearNarrationCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scheduleAudioCues', () => {
    it('creates and plays a narration cue immediately when enter is 0', () => {
      const cue = makeCue();
      scheduleAudioCues([cue]);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({ src: ['test.m4a'], volume: 1.0 }),
      );
      const howl = Howl.mock.results[0].value;
      expect(howl.play).toHaveBeenCalled();
    });

    it('delays cue start when enter > 0', () => {
      const cue = makeCue({ enter: 500 });
      scheduleAudioCues([cue]);

      expect(Howl).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({ src: ['test.m4a'] }),
      );
    });

    it('handles null cues gracefully', () => {
      expect(() => scheduleAudioCues(null)).not.toThrow();
      expect(() => scheduleAudioCues([])).not.toThrow();
    });

    it('wires onNarrationEnd for narration cues', () => {
      const onEnd = vi.fn();
      const cue = makeCue();
      scheduleAudioCues([cue], { onNarrationEnd: onEnd });

      const howl = Howl.mock.results[0].value;
      // once('end', safeEnd) should be wired
      expect(howl.once).toHaveBeenCalledWith('end', expect.any(Function));
    });

    it('applies fadeIn when specified', () => {
      const cue = makeCue({ type: 'sfx', id: 'sfx-1', fadeIn: 1000 });
      scheduleAudioCues([cue]);

      const howl = Howl.mock.results[0].value;
      expect(howl.fade).toHaveBeenCalledWith(0, 1.0, 1000);
    });

    it('uses crossfadeAmbientCue for ambient type', () => {
      const cue = makeCue({ type: 'ambient', id: 'ambient-1', enter: 0 });
      scheduleAudioCues([cue]);

      // crossfadeAmbientCue creates a Howl with volume: 0
      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({ volume: 0 }),
      );
    });
  });

  describe('anchor resolution', () => {
    it('resolves numeric enter as-is', () => {
      const cue = makeCue({ enter: 300 });
      scheduleAudioCues([cue]);

      expect(Howl).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(Howl).toHaveBeenCalled();
    });

    it('resolves anchor-based enter using narration duration', () => {
      const narrationCue = makeCue({ enter: 500 });
      const songCue = makeCue({
        id: 'end-song',
        type: 'ambient',
        src: 'song.mp3',
        enter: { ref: 'narration', offset: -5000 },
      });

      // maxNarrationDurationMs=30000: resolvedEnter = 500 + 30000 + (-5000) = 25500
      scheduleAudioCues([narrationCue, songCue], {
        maxNarrationDurationMs: 30000,
      });

      // Narration fires at 500ms, song at 25500ms
      vi.advanceTimersByTime(500);
      expect(Howl).toHaveBeenCalledTimes(1); // narration only

      vi.advanceTimersByTime(25000);
      expect(Howl).toHaveBeenCalledTimes(2); // song too
    });

    it('resolves anchor-based enter using audioDurations map', () => {
      const ambientCue = makeCue({ type: 'ambient', id: 'bg', src: 'bg.mp3' });
      const sfxCue = makeCue({
        id: 'sfx',
        type: 'sfx',
        src: 'sfx.mp3',
        enter: { ref: 'bg', offset: 1000 },
      });

      const audioDurations = new Map([['bg.mp3', 30]]); // 30 seconds -> 30000 ms
      scheduleAudioCues([ambientCue, sfxCue], { audioDurations });
      
      // Ambient fires immediately (0)
      expect(Howl).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(31000);
      expect(Howl).toHaveBeenCalledTimes(2); // sfx fires at 30000 + 1000
    });

    it('falls back to enter: 0 when anchor ref is unknown', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cue = makeCue({
        id: 'mystery',
        type: 'sfx',
        enter: { ref: 'nonexistent', offset: 0 },
      });

      scheduleAudioCues([cue]);
      // resolvedEnter = 0, so Howl created immediately
      expect(Howl).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Anchor ref "nonexistent" duration unknown'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('cancelAudioCues', () => {
    it('unloads all Howls and clears the map', () => {
      scheduleAudioCues([makeCue()]);
      const howl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      cancelAudioCues();

      expect(howl.unload).toHaveBeenCalled();
      expect(getNarrationCue()).toBeNull();
    });

    it('cancels pending timers', () => {
      scheduleAudioCues([makeCue({ enter: 5000 })]);

      cancelAudioCues();
      vi.advanceTimersByTime(10000);

      expect(Howl).not.toHaveBeenCalled();
    });

    it('handles empty state gracefully', () => {
      expect(() => cancelAudioCues()).not.toThrow();
    });
  });

  describe('pauseAudioCues / resumeAudioCues', () => {
    it('pauses playing Howls', () => {
      scheduleAudioCues([makeCue()]);
      const howl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      pauseAudioCues();
      expect(howl.pause).toHaveBeenCalled();
    });

    it('resumes playing Howls', () => {
      scheduleAudioCues([makeCue()]);
      const howl = Howl.mock.results[0].value;
      pauseAudioCues();
      vi.clearAllMocks();

      resumeAudioCues();
      expect(howl.play).toHaveBeenCalled();
    });

    it('does not pause cues in scheduled state', () => {
      scheduleAudioCues([makeCue({ enter: 5000 })]);
      // No Howl created yet (still scheduled)

      pauseAudioCues();
      // Timer pause is handled by PausableTimer mock — no Howl to pause
      expect(Howl).not.toHaveBeenCalled();
    });
  });

  describe('crossfade ambient', () => {
    it('defers old ambient unload until new confirms play', () => {
      // Setup old ambient
      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      // Schedule new ambient
      const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'new.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[0].value;

      // Old ambient NOT unloaded yet
      expect(oldHowl.unload).not.toHaveBeenCalled();

      // Trigger new ambient's play event
      const playHandler = newHowl.once.mock.calls.find(([e]) => e === 'play');
      playHandler[1]();

      // Now old should fade out and get unloaded after duration
      expect(oldHowl.fade).toHaveBeenCalledWith(0.15, 0, 800);
      vi.advanceTimersByTime(900);
      expect(oldHowl.unload).toHaveBeenCalled();
    });

    it('restores old ambient at original volume on load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'bad.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[0].value;

      // Trigger load error
      const errorHandler = newHowl.on.mock.calls.find(([e]) => e === 'loaderror');
      errorHandler[1](1, 'network');

      // Old ambient restored to original volume (0.15 from mockHowlInstance.volume())
      expect(oldHowl.fade).toHaveBeenCalledWith(0.15, 0.15, 200);
      warnSpy.mockRestore();
    });

    it('restores old ambient at original volume on play error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'bad.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[0].value;

      // Trigger play error
      const errorHandler = newHowl.on.mock.calls.find(([e]) => e === 'playerror');
      errorHandler[1](1, 'blocked');

      expect(oldHowl.fade).toHaveBeenCalledWith(0.15, 0.15, 200);
      warnSpy.mockRestore();
    });

    it('handles crossfade with no previous ambient', () => {
      const cue = makeCue({ type: 'ambient', id: 'ambient-1' });
      expect(() => scheduleAudioCues([cue])).not.toThrow();
    });

    it('uses the current ambient as the next crossfade source after cleanup', () => {
      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;

      const newCue = makeCue({ type: 'ambient', id: 'ambient-2', src: 'new.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[1].value;
      const newPlayHandler = newHowl.once.mock.calls.find(([e]) => e === 'play');
      newPlayHandler[1]();
      vi.advanceTimersByTime(900);

      vi.clearAllMocks();

      const finalCue = makeCue({ type: 'ambient', id: 'ambient-3', src: 'final.mp3' });
      scheduleAudioCues([finalCue]);
      const finalHowl = Howl.mock.results[0].value;
      const finalPlayHandler = finalHowl.once.mock.calls.find(([e]) => e === 'play');
      finalPlayHandler[1]();

      expect(newHowl.fade).toHaveBeenCalledWith(0.15, 0, 800);
      expect(oldHowl.fade).not.toHaveBeenCalled();
    });
  });

  describe('narration safety and buffer exhaustion', () => {
    it('calls onNarrationEnd when narration ends naturally', () => {
      const onEnd = vi.fn();
      scheduleAudioCues([makeCue()], { onNarrationEnd: onEnd });

      const howl = Howl.mock.results[0].value;
      const endHandler = howl.once.mock.calls.find(([e]) => e === 'end');
      endHandler[1]();

      expect(onEnd).toHaveBeenCalledOnce();
    });

    it('calls onNarrationEnd only once even with multiple triggers', () => {
      const onEnd = vi.fn();
      scheduleAudioCues([makeCue()], { onNarrationEnd: onEnd });

      const howl = Howl.mock.results[0].value;
      const endHandler = howl.once.mock.calls.find(([e]) => e === 'end');
      const errorHandler = howl.on.mock.calls.find(([e]) => e === 'playerror');

      endHandler[1]();
      errorHandler[1]();

      expect(onEnd).toHaveBeenCalledOnce();
    });

    it('fires safety timeout when narration runs too long', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onEnd = vi.fn();
      scheduleAudioCues([makeCue()], {
        onNarrationEnd: onEnd,
        maxNarrationDurationMs: 3000,
      });

      vi.advanceTimersByTime(8000); // 3000 + 5000 safety margin
      expect(onEnd).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Narration safety timeout'),
      );
      warnSpy.mockRestore();
    });

    it('pauses safety timeout when pauseAudioCues is called', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onEnd = vi.fn();
      scheduleAudioCues([makeCue()], {
        onNarrationEnd: onEnd,
        maxNarrationDurationMs: 3000,
      });

      // Safety timeout is at 8000ms. Advance 4000ms, then pause.
      vi.advanceTimersByTime(4000);
      pauseAudioCues();
      
      // Since it is paused, advancing 10000ms should do nothing.
      vi.advanceTimersByTime(10000);
      expect(onEnd).not.toHaveBeenCalled();

      // Resume, advance the remaining 4000ms to trigger the timeout.
      resumeAudioCues();
      vi.advanceTimersByTime(4000);
      expect(onEnd).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });

    it('calls onNarrationEnd on load error', () => {
      const onEnd = vi.fn();
      scheduleAudioCues([makeCue()], { onNarrationEnd: onEnd });

      const howl = Howl.mock.results[0].value;
      const errorHandler = howl.on.mock.calls.find(([e]) => e === 'loaderror');
      errorHandler[1]();

      expect(onEnd).toHaveBeenCalledOnce();
    });
  });

  describe('cueAudioCues', () => {
    it('loads but does not play cues', () => {
      cueAudioCues([makeCue()]);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({ preload: true }),
      );
      const howl = Howl.mock.results[0].value;
      expect(howl.play).not.toHaveBeenCalled();
    });

    it('handles null cues', () => {
      expect(() => cueAudioCues(null)).not.toThrow();
      expect(() => cueAudioCues([])).not.toThrow();
    });

    it('uses narration cache when available', () => {
      preloadNarrationAhead('test.m4a');
      const cachedHowl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      cueAudioCues([makeCue()]);

      // Should reuse cached howl, no new Howl created
      expect(Howl).not.toHaveBeenCalled();
      expect(getNarrationCue()).toBe(cachedHowl);
    });
  });

  describe('cancelCue / reCueCue', () => {
    it('cancels a specific cue without affecting others', () => {
      const cue1 = makeCue({ id: 'narration' });
      const cue2 = makeCue({ id: 'ambient-1', type: 'ambient', src: 'bg.mp3' });
      scheduleAudioCues([cue1, cue2]);

      const narrationHowl = Howl.mock.results[0].value;
      cancelCue('narration');

      expect(narrationHowl.unload).toHaveBeenCalled();
      // ambient still exists
      expect(getNarrationCue()).toBeNull();
    });

    it('reCueCue replaces a cue with a loaded-but-not-playing Howl', () => {
      scheduleAudioCues([makeCue()]);
      const oldHowl = Howl.mock.results[0].value;

      vi.clearAllMocks();
      const newCue = makeCue({ src: 'new.m4a' });
      const result = reCueCue('narration', newCue);

      // Old howl unloaded (via cancelCue)
      expect(oldHowl.unload).toHaveBeenCalled();
      // New howl created with preload but not played
      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({ src: ['new.m4a'], preload: true }),
      );
      expect(result).toBeDefined();
    });

    it('cancelCue is safe on nonexistent id', () => {
      expect(() => cancelCue('nonexistent')).not.toThrow();
    });
  });

  describe('restartNarrationCue', () => {
    it('reuses existing Howl — stop + play instead of unload + new', () => {
      scheduleAudioCues([makeCue()]);
      const howl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      const onEnd = vi.fn();
      const result = restartNarrationCue(makeCue(), {
        onNarrationEnd: onEnd,
        maxNarrationDurationMs: 5000,
      });

      expect(result).toBe(true);
      expect(howl.stop).toHaveBeenCalled();
      expect(howl.play).toHaveBeenCalled();
      // No new Howl created — same instance reused
      expect(Howl).not.toHaveBeenCalled();
      expect(howl.unload).not.toHaveBeenCalled();
    });

    it('removes old event handlers before re-wiring', () => {
      scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn(), maxNarrationDurationMs: 5000 });
      const howl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      restartNarrationCue(makeCue(), {
        onNarrationEnd: vi.fn(),
        maxNarrationDurationMs: 5000,
      });

      // Old handlers cleared
      expect(howl.off).toHaveBeenCalledWith('end');
      expect(howl.off).toHaveBeenCalledWith('loaderror');
      expect(howl.off).toHaveBeenCalledWith('playerror');
      // New handler wired
      expect(howl.once).toHaveBeenCalledWith('end', expect.any(Function));
    });

    it('returns false when no narration entry exists', () => {
      const result = restartNarrationCue(makeCue(), { onNarrationEnd: vi.fn() });
      expect(result).toBe(false);
    });

    it('cancels pending safety timer before restarting', () => {
      scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn(), maxNarrationDurationMs: 10000 });
      const howl = getNarrationCue();
      vi.clearAllMocks();

      restartNarrationCue(makeCue(), {
        onNarrationEnd: vi.fn(),
        maxNarrationDurationMs: 10000,
      });

      // Old handlers cleared and new safety handler wired via wireNarrationEnd
      expect(howl.stop).toHaveBeenCalled();
      expect(howl.once).toHaveBeenCalledWith('end', expect.any(Function));
    });
  });

  describe('getNarrationCue', () => {
    it('returns narration Howl when scheduled', () => {
      scheduleAudioCues([makeCue()]);
      const howl = Howl.mock.results[0].value;

      expect(getNarrationCue()).toBe(howl);
    });

    it('returns null when no narration is active', () => {
      expect(getNarrationCue()).toBeNull();
    });
  });

  describe('setMuted', () => {
    it('mutes all active cue Howls', () => {
      scheduleAudioCues([makeCue()]);
      const howl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      setMuted(true);
      expect(howl.mute).toHaveBeenCalledWith(true);

      setMuted(false);
      expect(howl.mute).toHaveBeenCalledWith(false);
    });
  });

  describe('preload cache', () => {
    it('preloadNarrationAhead creates a Howl with preload', () => {
      preloadNarrationAhead('ahead.m4a');

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['ahead.m4a'],
          preload: true,
        }),
      );
    });

    it('preloadNarrationAhead is idempotent', () => {
      preloadNarrationAhead('ahead.m4a');
      preloadNarrationAhead('ahead.m4a');

      expect(Howl).toHaveBeenCalledTimes(1);
    });

    it('clearNarrationCache unloads all cached Howls', () => {
      preloadNarrationAhead('a.m4a');
      preloadNarrationAhead('b.m4a');
      const howl1 = Howl.mock.results[0].value;
      const howl2 = Howl.mock.results[1].value;

      clearNarrationCache();
      expect(howl1.unload).toHaveBeenCalled();
      expect(howl2.unload).toHaveBeenCalled();
    });

    it('scheduleAudioCues uses cached narration Howl', () => {
      preloadNarrationAhead('test.m4a');
      const cachedHowl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      scheduleAudioCues([makeCue()]);

      // Should reuse cached, no new Howl
      expect(Howl).not.toHaveBeenCalled();
      expect(cachedHowl.play).toHaveBeenCalled();
    });

    it('removes cache entry on load error', () => {
      preloadNarrationAhead('bad.m4a');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Trigger the loaderror callback
      lastHowlOptions.onloaderror(1, 'error');
      vi.advanceTimersByTime(0); // flush microtask for unload

      vi.clearAllMocks();
      // Scheduling should create a new Howl since cache was cleared
      scheduleAudioCues([makeCue({ src: 'bad.m4a' })]);
      expect(Howl).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('buffer monitoring', () => {
    it('onNarrationBufferChange registers callback', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      expect(isNarrationBuffering()).toBe(false);
    });

    it('triggers buffer change on waiting event', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      scheduleAudioCues([makeCue()]);

      // Find the waiting listener
      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      if (waitingCall) {
        waitingCall[1]();
        expect(cb).toHaveBeenCalledWith(true);
        expect(isNarrationBuffering()).toBe(true);
      }
    });

    it('clears buffer state on playing event', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      scheduleAudioCues([makeCue()]);

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      const playingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'playing',
      );

      if (waitingCall && playingCall) {
        waitingCall[1]();
        cb.mockClear();
        playingCall[1]();
        expect(cb).toHaveBeenCalledWith(false);
        expect(isNarrationBuffering()).toBe(false);
      }
    });

    it('buffer exhaustion triggers onExhaustion callback', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onEnd = vi.fn();
      onNarrationBufferChange(vi.fn());

      scheduleAudioCues([makeCue()], {
        onNarrationEnd: onEnd,
        maxNarrationDurationMs: 60000,
      });

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      if (waitingCall) {
        mockNode.buffered.length = 1;
        mockNode.buffered.end.mockReturnValue(5);
        waitingCall[1]();

        // Exhaust retries: 4 checks × 3 recovery attempts = stalled
        mockNode.buffered.end.mockReturnValue(5); // no progress
        for (let i = 0; i < 12; i++) {
          vi.advanceTimersByTime(4000);
        }

        expect(onEnd).toHaveBeenCalled();
      }

      warnSpy.mockRestore();
    });

    it('does not force play on buffer recovery if paused globally', () => {
      scheduleAudioCues([makeCue({ src: 'test.m4a' })]);

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      if (waitingCall) {
        waitingCall[1]();
        
        // Pause the experience!
        pauseAudioCues();

        // Simulate buffer recovery
        mockNode.buffered.length = 1;
        mockNode.buffered.end.mockReturnValue(5);
        mockNode.currentTime = 0;
        mockNode.duration = 60;
        
        // Advance timer to trigger progress check
        vi.advanceTimersByTime(4000);
        
        // play() should NOT have been called by the buffer recovery loop
        expect(mockNode.play).not.toHaveBeenCalled();
      }
    });
  });
});
