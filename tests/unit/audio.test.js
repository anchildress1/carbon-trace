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

function createMockHowlInstance(initialVolume = 1) {
  let currentVolume = initialVolume;
  const volume = vi.fn((value) => {
    if (value === undefined) return currentVolume;
    currentVolume = value;
    return currentVolume;
  });

  const fade = vi.fn((_from, to) => {
    currentVolume = to;
  });

  return {
    play: vi.fn(),
    stop: vi.fn(),
    fade,
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

const { mockHowlerCtx } = vi.hoisted(() => {
  const mockHowlerCtx = {
    createAnalyser: vi.fn(() => ({
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 1024,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn(),
      context: { sampleRate: 44100 },
    })),
    createMediaElementSource: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    destination: {},
    sampleRate: 44100,
  };

  return { mockHowlerCtx };
});

vi.mock('howler', () => ({
  Howl: vi.fn(function (opts) {
    lastHowlOptions = opts;
    Object.assign(this, createMockHowlInstance(opts?.volume ?? 1));
  }),
  Howler: { ctx: mockHowlerCtx },
}));

import {
  scheduleAudioCues,
  cancelAudioCues,
  pauseAudioCues,
  resumeAudioCues,
  setMuted,
  onNarrationBufferChange,
  preloadNarrationAhead,
  trimNarrationCache,
  wrapOnNarrationEndWithBoost,
  getAnalyserNode,
  disconnectAnalyserSource,
} from '../../src/audio.js';
import { Howl, Howler } from 'howler';

function makeCue(overrides = {}) {
  return {
    id: 'narration',
    type: 'narration',
    src: 'test.m4a',
    enter: 0,
    volume: 1,
    loop: false,
    fadeIn: 0,
    ...overrides,
  };
}

describe('audio.js — unified cue API (ADR-005)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    lastHowlOptions = null;
    mockNode.addEventListener.mockClear();
    mockNode.removeEventListener.mockClear();
    mockNode.play.mockResolvedValue(undefined);
    mockNode.buffered.length = 0;
    mockNode.currentTime = 0;
    mockNode.duration = 60;
    mockNode.src = '';
    cancelAudioCues();
    trimNarrationCache([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scheduleAudioCues', () => {
    it('creates and plays a narration cue immediately when enter is 0', () => {
      const cue = makeCue();
      scheduleAudioCues([cue]);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({ src: ['test.m4a'], volume: 1 }),
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
      expect(howl.fade).toHaveBeenCalledWith(0, 1, 1000);
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
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cue = makeCue({
        id: 'mystery',
        type: 'sfx',
        enter: { ref: 'nonexistent', offset: 0 },
      });

      scheduleAudioCues([cue]);
      // resolvedEnter = 0, so Howl created immediately
      expect(Howl).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Anchor ref "nonexistent"'),
      );
      errorSpy.mockRestore();
    });

    it('resolves chained anchors across multiple iterations', () => {
      const cueA = makeCue({ id: 'a', type: 'ambient', src: 'a.mp3', enter: 100 });
      const cueB = makeCue({
        id: 'b',
        type: 'sfx',
        src: 'b.mp3',
        enter: { ref: 'a', offset: 200 },
      });
      const cueC = makeCue({
        id: 'c',
        type: 'sfx',
        src: 'c.mp3',
        enter: { ref: 'b', offset: 300 },
      });

      // a: 10s, b: 5s durations
      const audioDurations = new Map([['a.mp3', 10], ['b.mp3', 5]]);
      // resolvedEnter: a=100, b=100+10000+200=10300, c=10300+5000+300=15600
      scheduleAudioCues([cueC, cueB, cueA], { audioDurations });

      // cueA fires at 100ms
      vi.advanceTimersByTime(100);
      expect(Howl).toHaveBeenCalledTimes(1);

      // cueB fires at 10300ms
      vi.advanceTimersByTime(10200);
      expect(Howl).toHaveBeenCalledTimes(2);

      // cueC fires at 15600ms
      vi.advanceTimersByTime(5300);
      expect(Howl).toHaveBeenCalledTimes(3);
    });

    it('detects circular anchor references and falls back to enter: 0', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cueX = makeCue({
        id: 'x',
        type: 'sfx',
        src: 'x.mp3',
        enter: { ref: 'y', offset: 0 },
      });
      const cueY = makeCue({
        id: 'y',
        type: 'sfx',
        src: 'y.mp3',
        enter: { ref: 'x', offset: 0 },
      });

      const audioDurations = new Map([['x.mp3', 5], ['y.mp3', 5]]);
      scheduleAudioCues([cueX, cueY], { audioDurations });

      // Both fire immediately (resolvedEnter = 0 due to circular fallback)
      expect(Howl).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('unresolvable'),
      );
      errorSpy.mockRestore();
    });
  });

  describe('cancelAudioCues', () => {
    it('unloads all Howls and clears the map', () => {
      scheduleAudioCues([makeCue()]);
      const howl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      cancelAudioCues();

      expect(howl.unload).toHaveBeenCalled();
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

    it('preserves playing ambient when preserveAmbient is true', () => {
      const ambientCue = makeCue({ id: 'ambient-1', type: 'ambient', src: 'ambient.mp3' });
      const narrationCue = makeCue({ id: 'narration', type: 'narration', src: 'narration.m4a' });
      scheduleAudioCues([ambientCue, narrationCue]);

      const ambientHowl = Howl.mock.results[0].value;
      const narrationHowl = Howl.mock.results[1].value;
      vi.clearAllMocks();

      cancelAudioCues({ preserveAmbient: true });

      expect(ambientHowl.unload).not.toHaveBeenCalled();
      expect(narrationHowl.unload).toHaveBeenCalled();
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

    it('does not replay narration that already ended', () => {
      const onEnd = vi.fn();
      scheduleAudioCues([makeCue()], { onNarrationEnd: onEnd });
      const howl = Howl.mock.results[0].value;

      // Simulate narration ending naturally
      const endHandler = howl.once.mock.calls.find(([e]) => e === 'end')[1];
      endHandler();

      vi.clearAllMocks();

      // Pause then resume — narration should NOT restart
      pauseAudioCues();
      resumeAudioCues();
      expect(howl.play).not.toHaveBeenCalled();
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
    it('starts old ambient fade-out immediately on new ambient schedule', () => {
      // Setup old ambient
      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;
      const oldVolume = oldHowl.volume();
      vi.clearAllMocks();

      // Schedule new ambient — fade-out starts immediately, no play-event gate
      const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'new.mp3' });
      scheduleAudioCues([newCue]);

      // Old ambient fade starts at schedule time, not deferred to play event
      expect(oldHowl.fade).toHaveBeenCalledWith(oldVolume, 0, 800);
      // Unload deferred until fade duration elapses
      expect(oldHowl.unload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(900);
      expect(oldHowl.unload).toHaveBeenCalled();
    });

    it('restores old ambient at original volume on load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;
      const oldVolume = oldHowl.volume();
      vi.clearAllMocks();

      const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'bad.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[0].value;

      // Trigger load error
      const errorHandler = newHowl.once.mock.calls.find(([e]) => e === 'loaderror');
      errorHandler[1](1, 'network');

      // Old ambient restored to its pre-crossfade volume.
      expect(oldHowl.fade).toHaveBeenCalledWith(0, oldVolume, 200);
      warnSpy.mockRestore();
    });

    it('restores old ambient at original volume on play error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;
      const oldVolume = oldHowl.volume();
      vi.clearAllMocks();

      const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'bad.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[0].value;

      // Trigger play error
      const errorHandler = newHowl.once.mock.calls.find(([e]) => e === 'playerror');
      errorHandler[1](1, 'blocked');

      expect(oldHowl.fade).toHaveBeenCalledWith(0, oldVolume, 200);
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

      // Scheduling ambient-2 immediately fades out ambient-1
      const newCue = makeCue({ type: 'ambient', id: 'ambient-2', src: 'new.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[1].value;
      vi.advanceTimersByTime(900); // complete ambient-1 unload
      const newVolume = newHowl.volume();

      vi.clearAllMocks();

      // Scheduling ambient-3 immediately fades out ambient-2 (now the active ambient)
      const finalCue = makeCue({ type: 'ambient', id: 'ambient-3', src: 'final.mp3' });
      scheduleAudioCues([finalCue]);

      expect(newHowl.fade).toHaveBeenCalledWith(newVolume, 0, 800);
      expect(oldHowl.fade).not.toHaveBeenCalled(); // already unloaded, not the active ambient
    });

    it('pauses and resumes fading-out ambient during global pause', () => {
      const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
      scheduleAudioCues([oldCue]);
      const oldHowl = Howl.mock.results[0].value;
      vi.clearAllMocks();

      // Scheduling new ambient immediately starts fading out old — no play-event needed
      const newCue = makeCue({ type: 'ambient', id: 'ambient-2', src: 'new.mp3' });
      scheduleAudioCues([newCue]);
      const newHowl = Howl.mock.results[0].value;

      vi.clearAllMocks();
      pauseAudioCues();
      expect(oldHowl.pause).toHaveBeenCalled();
      expect(newHowl.pause).toHaveBeenCalled();

      resumeAudioCues();
      expect(oldHowl.play).toHaveBeenCalled();
      expect(newHowl.play).toHaveBeenCalled();

      vi.advanceTimersByTime(900);
      expect(oldHowl.unload).toHaveBeenCalled();
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
      const errorHandler = howl.once.mock.calls.find(([e]) => e === 'playerror');

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
      const errorHandler = howl.once.mock.calls.find(([e]) => e === 'loaderror');
      errorHandler[1]();

      expect(onEnd).toHaveBeenCalledOnce();
    });

    it('boosts cue volume to volumeAfterNarration when narration ends', () => {
      const onEnd = vi.fn();
      const narration = makeCue();
      const song = makeCue({
        id: 'end-song',
        type: 'ambient',
        src: 'song.mp3',
        volume: 0.12,
        volumeAfterNarration: 0.75,
        fadeAfterNarration: 4000,
        enter: 0,
        loop: true,
        fadeIn: 8000,
      });
      const allCues = [narration, song];
      const wrappedOnEnd = wrapOnNarrationEndWithBoost(allCues, onEnd);
      scheduleAudioCues(allCues, { onNarrationEnd: wrappedOnEnd });

      // Trigger narration end
      const narrationHowl = Howl.mock.results[0].value;
      const songHowl = Howl.mock.results[1].value;
      const songVolumeBefore = songHowl.volume();
      const endHandler = narrationHowl.once.mock.calls.find(([e]) => e === 'end');
      endHandler[1]();

      // The song howl should have been faded to 0.75 over 4000ms
      expect(songHowl.fade).toHaveBeenCalledWith(
        songVolumeBefore,
        0.75,
        4000,
      );
      expect(onEnd).toHaveBeenCalledOnce();
    });
  });

  describe('wrapOnNarrationEndWithBoost', () => {
    it('returns original callback when no boost cues exist', () => {
      const cb = vi.fn();
      const result = wrapOnNarrationEndWithBoost([makeCue()], cb);
      expect(result).toBe(cb);
    });

    it('returns original callback when cues is null', () => {
      const cb = vi.fn();
      expect(wrapOnNarrationEndWithBoost(null, cb)).toBe(cb);
    });

    it('returns original callback when cues is empty', () => {
      const cb = vi.fn();
      expect(wrapOnNarrationEndWithBoost([], cb)).toBe(cb);
    });

    it('wraps callback to fade boost cues and call original', () => {
      const cb = vi.fn();
      const song = makeCue({
        id: 'end-song',
        type: 'ambient',
        src: 'song.mp3',
        volume: 0.15,
        volumeAfterNarration: 0.75,
        fadeAfterNarration: 3000,
        enter: 0,
        loop: true,
        fadeIn: 8000,
      });

      // Schedule the ambient cue so it's in activeCues
      scheduleAudioCues([song]);
      const songHowl = Howl.mock.results[0].value;
      const songVolumeBefore = songHowl.volume();

      const wrapped = wrapOnNarrationEndWithBoost([song], cb);
      wrapped();

      expect(songHowl.fade).toHaveBeenCalledWith(songVolumeBefore, 0.75, 3000);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('uses default 3000ms fade when fadeAfterNarration is not set', () => {
      const cb = vi.fn();
      const song = makeCue({
        id: 'end-song',
        type: 'ambient',
        src: 'song.mp3',
        volume: 0.15,
        volumeAfterNarration: 0.75,
        enter: 0,
        loop: true,
        fadeIn: 8000,
      });

      scheduleAudioCues([song]);
      const songHowl = Howl.mock.results[0].value;
      const songVolumeBefore = songHowl.volume();

      const wrapped = wrapOnNarrationEndWithBoost([song], cb);
      wrapped();

      expect(songHowl.fade).toHaveBeenCalledWith(songVolumeBefore, 0.75, 3000);
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

    it('trimNarrationCache keeps only requested src entries', () => {
      preloadNarrationAhead('keep.m4a');
      preloadNarrationAhead('drop.m4a');
      const keepHowl = Howl.mock.results[0].value;
      const dropHowl = Howl.mock.results[1].value;

      trimNarrationCache(['keep.m4a']);

      expect(keepHowl.unload).not.toHaveBeenCalled();
      expect(dropHowl.unload).toHaveBeenCalled();
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

    });

    it('triggers buffer change on waiting event', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      expect(waitingCall).toBeDefined();
      waitingCall[1]();
      expect(cb).toHaveBeenCalledWith(true);
    });

    it('clears buffer state on playing event', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      const playingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'playing',
      );
      expect(waitingCall).toBeDefined();
      expect(playingCall).toBeDefined();

      waitingCall[1]();
      cb.mockClear();
      playingCall[1]();
      expect(cb).toHaveBeenCalledWith(false);
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
      expect(waitingCall).toBeDefined();

      mockNode.buffered.length = 1;
      mockNode.buffered.end.mockReturnValue(5);
      waitingCall[1]();

      // Exhaust retries: 4 checks × 3 recovery attempts = stalled
      mockNode.buffered.end.mockReturnValue(5); // no progress
      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(4000);
      }

      expect(onEnd).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('does not force play on buffer recovery if paused globally', () => {
      scheduleAudioCues([makeCue({ src: 'test.m4a' })], { onNarrationEnd: vi.fn() });

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      expect(waitingCall).toBeDefined();

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
    });
  });
});

describe('audio.js — buffer recovery paths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    lastHowlOptions = null;
    mockNode.addEventListener.mockClear();
    mockNode.removeEventListener.mockClear();
    mockNode.play.mockResolvedValue(undefined);
    mockNode.buffered.length = 0;
    mockNode.currentTime = 0;
    mockNode.duration = 60;
    mockNode.src = '';
    cancelAudioCues();
    trimNarrationCache([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resumes play when buffer recovers sufficiently while not paused', () => {
    onNarrationBufferChange(vi.fn());
    scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

    const waitingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'waiting',
    );
    expect(waitingCall).toBeDefined();

    // Trigger waiting → starts buffer monitoring
    waitingCall[1]();

    // Simulate buffer progress: ahead >= 3
    mockNode.buffered.length = 1;
    mockNode.buffered.end.mockReturnValue(8); // currentTime=0, ahead=8 ≥ 3
    mockNode.currentTime = 0;
    mockNode.duration = 60;

    vi.advanceTimersByTime(4000); // trigger checkBufferProgress

    // Buffer recovered sufficiently, play should be called
    expect(mockNode.play).toHaveBeenCalled();
  });

  it('resumes play when near end of audio even with small buffer', () => {
    onNarrationBufferChange(vi.fn());
    scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

    const waitingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'waiting',
    );
    waitingCall[1]();

    // Near end: duration - currentTime < 3
    mockNode.buffered.length = 1;
    mockNode.buffered.end.mockReturnValue(58);
    mockNode.currentTime = 58;
    mockNode.duration = 60;

    vi.advanceTimersByTime(4000);

    expect(mockNode.play).toHaveBeenCalled();
  });

  it('does not call play on buffer recovery when paused globally', () => {
    onNarrationBufferChange(vi.fn());
    scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

    const waitingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'waiting',
    );
    waitingCall[1]();

    pauseAudioCues(); // sets isAudioPaused = true
    mockNode.play.mockClear();

    mockNode.buffered.length = 1;
    mockNode.buffered.end.mockReturnValue(8);
    mockNode.currentTime = 0;
    mockNode.duration = 60;

    vi.advanceTimersByTime(4000);

    expect(mockNode.play).not.toHaveBeenCalled();
  });

  it('stops checking when narrationBuffering is false', () => {
    onNarrationBufferChange(vi.fn());
    scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

    const waitingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'waiting',
    );
    waitingCall[1]();

    // Clear buffering via playing event
    const playingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'playing',
    );
    playingCall[1](); // clears narrationBuffering

    mockNode.buffered.end.mockClear();
    vi.advanceTimersByTime(4000);

    // checkBufferProgress should have exited early
    expect(mockNode.buffered.end).not.toHaveBeenCalled();
  });

  it('nudges stall after 2 checks without progress', () => {
    let currentTimeValue = 4;
    const currentTimeSetter = vi.fn((v) => { currentTimeValue = v; });
    const originalDescriptor = Object.getOwnPropertyDescriptor(mockNode, 'currentTime');
    Object.defineProperty(mockNode, 'currentTime', {
      get: () => currentTimeValue,
      set: currentTimeSetter,
      configurable: true,
      enumerable: true,
    });

    onNarrationBufferChange(vi.fn());
    scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

    const waitingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'waiting',
    );

    mockNode.buffered.length = 1;
    mockNode.buffered.end.mockReturnValue(5);
    waitingCall[1]();

    // Stall check 1: no progress
    vi.advanceTimersByTime(4000);
    // Stall check 2: still no progress → nudge (currentTime = currentTime)
    vi.advanceTimersByTime(4000);

    expect(currentTimeSetter).toHaveBeenCalledWith(4);

    Object.defineProperty(mockNode, 'currentTime', originalDescriptor);
  });

  it('reloads from position after 4 stalled checks', () => {
    onNarrationBufferChange(vi.fn());
    scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

    const waitingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'waiting',
    );

    mockNode.buffered.length = 1;
    mockNode.buffered.end.mockReturnValue(5);
    mockNode.currentTime = 4;
    mockNode.src = 'test.m4a';
    waitingCall[1]();

    // 4 checks with no progress → reloadFromPosition
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(4000);
    }

    // reloadFromPosition calls node.play() to restart after reset
    expect(mockNode.play).toHaveBeenCalled();
  });

  it('buffer recovery play failure cleans up monitoring', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onNarrationBufferChange(vi.fn());
    scheduleAudioCues([makeCue()], { onNarrationEnd: vi.fn() });

    const waitingCall = mockNode.addEventListener.mock.calls.find(
      ([event]) => event === 'waiting',
    );
    waitingCall[1]();

    // Make play() reject
    mockNode.play.mockRejectedValueOnce(new Error('play blocked'));

    mockNode.buffered.length = 1;
    mockNode.buffered.end.mockReturnValue(8);
    mockNode.currentTime = 0;
    mockNode.duration = 60;

    vi.advanceTimersByTime(4000);
    await Promise.resolve(); // flush microtask so .catch() handler runs

    expect(warnSpy).toHaveBeenCalledWith('Buffer recovery play() failed:', 'play blocked');
    expect(mockNode.removeEventListener).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('audio.js — monitorNarrationBuffer edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    lastHowlOptions = null;
    mockNode.addEventListener.mockClear();
    mockNode.removeEventListener.mockClear();
    mockNode.buffered.length = 0;
    mockNode.currentTime = 0;
    mockNode.duration = 60;
    mockNode.src = '';
    cancelAudioCues();
    trimNarrationCache([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns when narration node is unavailable', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Default mockNode has addEventListener, so monitorNarrationBuffer succeeds.
    // Override _sounds to have a node without addEventListener.
    const badNode = { addEventListener: 'not-a-function' };
    Howl.mockImplementationOnce(function (opts) {
      lastHowlOptions = opts;
      Object.assign(this, createMockHowlInstance());
      this._sounds = [{ _node: badNode }];
    });

    const cue = makeCue();
    scheduleAudioCues([cue], { onNarrationEnd: vi.fn() });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cannot monitor narration buffer'),
    );
    warnSpy.mockRestore();
  });

  it('defers listener attachment via howl.once play when _sounds not yet ready', () => {
    Howl.mockImplementationOnce(function (opts) {
      lastHowlOptions = opts;
      Object.assign(this, createMockHowlInstance());
      this._sounds = null; // not ready yet
    });

    const cue = makeCue();
    scheduleAudioCues([cue], { onNarrationEnd: vi.fn() });

    const howl = Howl.mock.results[0].value;
    // Should have called once('play', attachListeners) for deferred attachment
    const playCalls = howl.once.mock.calls.filter(([e]) => e === 'play');
    expect(playCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('audio.js — anchor duration unknown fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    lastHowlOptions = null;
    cancelAudioCues();
    trimNarrationCache([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('errors and falls back to 0 when ref duration is unknown', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const cueA = makeCue({ id: 'a', enter: 0 });
    const cueB = makeCue({
      id: 'b',
      type: 'sfx',
      src: 'b.mp3',
      enter: { ref: 'a', offset: 500 },
    });

    // No audioDurations → ref 'a' duration unknown → cueB falls back to enter: 0
    scheduleAudioCues([cueA, cueB]);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Anchor ref "a" duration unknown'),
    );
    // Both fire immediately (cueA at 0, cueB fell back to 0)
    expect(Howl).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

describe('audio.js — crossfade cleanup and ambient sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    lastHowlOptions = null;
    mockNode.addEventListener.mockClear();
    mockNode.removeEventListener.mockClear();
    mockNode.buffered.length = 0;
    mockNode.currentTime = 0;
    mockNode.duration = 60;
    mockNode.src = '';
    cancelAudioCues();
    trimNarrationCache([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('crossfadeCleanup forces unload of pending old ambient', () => {
    // Schedule old ambient
    const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
    scheduleAudioCues([oldCue]);
    const oldHowl = Howl.mock.results[0].value;
    vi.clearAllMocks();

    // Schedule new ambient (crossfade)
    const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'new.mp3' });
    scheduleAudioCues([newCue]);
    const newHowl = Howl.mock.results[0].value;

    // Old not yet unloaded (waiting for play + fade)
    expect(oldHowl.unload).not.toHaveBeenCalled();

    // Call _crossfadeCleanup on the new howl
    newHowl._crossfadeCleanup();

    // Old should now be unloaded
    expect(oldHowl.unload).toHaveBeenCalled();
  });

  it('crossfadeCleanup is idempotent (second call is no-op)', () => {
    const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
    scheduleAudioCues([oldCue]);
    const oldHowl = Howl.mock.results[0].value;
    vi.clearAllMocks();

    const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'new.mp3' });
    scheduleAudioCues([newCue]);
    const newHowl = Howl.mock.results[0].value;

    newHowl._crossfadeCleanup();
    newHowl._crossfadeCleanup(); // second call

    expect(oldHowl.unload).toHaveBeenCalledTimes(1);
  });

  it('fades out the currently active ambient when a new ambient is scheduled', () => {
    // Schedule two sequential ambients — ambient-2 becomes active after fading ambient-1
    const cue1 = makeCue({ type: 'ambient', id: 'ambient-1', src: 'bg1.mp3', enter: 0 });
    const cue2 = makeCue({ type: 'ambient', id: 'ambient-2', src: 'bg2.mp3', enter: 0 });
    scheduleAudioCues([cue1, cue2]);

    // Capture before clearing mocks — clearAllMocks wipes Howl.mock.results
    const ambient2Howl = Howl.mock.results.find(
      (r, i) => Howl.mock.calls[i]?.[0]?.src?.[0] === 'bg2.mp3',
    )?.value;
    const ambient2Volume = ambient2Howl.volume();
    vi.clearAllMocks();

    // Scheduling a new ambient immediately fades out ambient-2 (the current active one)
    const newCue1 = makeCue({ type: 'ambient', id: 'ambient-1', src: 'bg1-new.mp3', enter: 0 });
    scheduleAudioCues([newCue1]);

    expect(ambient2Howl.fade).toHaveBeenCalledWith(ambient2Volume, 0, 800);
    expect(ambient2Howl.unload).not.toHaveBeenCalled(); // unload deferred until fade completes
  });

  it('cancelAudioCues cancels narration and ambient entries', () => {
    const narCue = makeCue({ id: 'narration', type: 'narration', src: 'nar.m4a' });
    const ambCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'bg.mp3', enter: 0 });
    scheduleAudioCues([narCue, ambCue]);

    const narHowl = Howl.mock.results[0].value;
    const ambHowl = Howl.mock.results[1].value;
    vi.clearAllMocks();

    cancelAudioCues();

    expect(narHowl.unload).toHaveBeenCalled();
    expect(ambHowl.unload).toHaveBeenCalled();
  });

  it('cancelAudioCues drains crossfade cleanup on non-ambient entries', () => {
    // Schedule ambient, then replace to get _crossfadeCleanup
    const oldCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'old.mp3' });
    scheduleAudioCues([oldCue]);
    vi.clearAllMocks();

    const newCue = makeCue({ type: 'ambient', id: 'ambient-1', src: 'new.mp3' });
    scheduleAudioCues([newCue]);

    const newHowl = Howl.mock.results[0].value;
    cancelAudioCues();

    expect(newHowl.unload).toHaveBeenCalled();
  });

  it('existing non-ambient entry with same id is unloaded when replaced', () => {
    const cue1 = makeCue({ id: 'sfx-1', type: 'sfx', src: 'sfx1.mp3', enter: 0 });
    scheduleAudioCues([cue1]);
    const howl1 = Howl.mock.results[0].value;
    vi.clearAllMocks();

    // Replace with new cue of same id but different type
    const cue2 = makeCue({ id: 'sfx-1', type: 'sfx', src: 'sfx2.mp3', enter: 0 });
    scheduleAudioCues([cue2]);

    expect(howl1.unload).toHaveBeenCalled();
  });
});

describe('audio.js — audio-reactive analyser (ADR-008)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    lastHowlOptions = null;
    mockNode.addEventListener.mockClear();
    mockNode.removeEventListener.mockClear();
    mockNode.buffered.length = 0;
    mockNode.currentTime = 0;
    mockNode.duration = 60;
    mockNode.src = '';
    cancelAudioCues();
    disconnectAnalyserSource();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when Howler.ctx is null', () => {
    const originalCtx = Howler.ctx;
    Howler.ctx = null;
    expect(getAnalyserNode()).toBeNull();
    Howler.ctx = originalCtx;
  });

  it('creates AnalyserNode with correct config (no destination connect)', () => {
    const node = getAnalyserNode();
    expect(node).not.toBeNull();
    expect(node.fftSize).toBe(2048);
    expect(node.smoothingTimeConstant).toBe(0.4);
    expect(node.connect).not.toHaveBeenCalled();
    expect(mockHowlerCtx.createAnalyser).toHaveBeenCalledTimes(1);
  });

  it('returns the same instance on subsequent calls', () => {
    const first = getAnalyserNode();
    mockHowlerCtx.createAnalyser.mockClear();
    const second = getAnalyserNode();
    expect(first).toBe(second);
    // createAnalyser should not be called again for the singleton
    expect(mockHowlerCtx.createAnalyser).not.toHaveBeenCalled();
  });

  it('disconnectAnalyserSource clears analyser state', () => {
    getAnalyserNode();
    disconnectAnalyserSource();
    // Idempotent — second call should not throw
    expect(() => disconnectAnalyserSource()).not.toThrow();
  });
});
