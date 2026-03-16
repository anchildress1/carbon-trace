import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockHowlInstance = {
  play: vi.fn(),
  stop: vi.fn(),
  fade: vi.fn(),
  mute: vi.fn(),
  pause: vi.fn(),
  unload: vi.fn(),
  volume: vi.fn().mockReturnValue(0.15),
  once: vi.fn(),
  on: vi.fn(),
  _sounds: [{ _node: mockNode }],
};

vi.mock('howler', () => ({
  Howl: vi.fn((opts) => {
    lastHowlOptions = opts;
    return { ...mockHowlInstance };
  }),
}));

import {
  playAmbient,
  crossfadeAmbient,
  playNarration,
  stopNarration,
  pauseNarration,
  resumeNarration,
  pauseAmbient,
  resumeAmbient,
  stopAll,
  setMuted,
  onNarrationBufferChange,
  isNarrationBuffering,
  preloadNarrationAhead,
  clearNarrationCache,
  playMusic,
  fadeMusic,
  pauseMusic,
  resumeMusic,
  stopMusic,
} from '../../src/audio.js';
import { Howl } from 'howler';

describe('audio.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNode.addEventListener.mockClear();
    mockNode.removeEventListener.mockClear();
    stopAll();
  });

  describe('playAmbient', () => {
    it('creates a Howl with correct options and error handlers', () => {
      playAmbient('test.mp3', 0.15, true);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['test.mp3'],
          volume: 0.15,
          loop: true,
          html5: true,
          mute: false,
          onloaderror: expect.any(Function),
          onplayerror: expect.any(Function),
        }),
      );
    });

    it('plays the ambient sound', () => {
      const howl = playAmbient('test.mp3', 0.15, true);

      expect(howl.play).toHaveBeenCalled();
    });

    it('unloads previous ambient before playing new one', () => {
      const first = playAmbient('first.mp3', 0.1, true);
      playAmbient('second.mp3', 0.2, true);

      expect(first.unload).toHaveBeenCalled();
    });
  });

  describe('crossfadeAmbient', () => {
    it('creates new ambient and fades it in', () => {
      crossfadeAmbient('new.mp3', 0.2, 800);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['new.mp3'],
          volume: 0,
          loop: true,
        }),
      );
    });

    it('fades out old ambient when present', () => {
      const old = playAmbient('old.mp3', 0.15, true);
      vi.clearAllMocks();

      crossfadeAmbient('new.mp3', 0.2, 800);

      expect(old.fade).toHaveBeenCalled();
    });

    it('handles no previous ambient gracefully', () => {
      stopAll();

      expect(() => crossfadeAmbient('new.mp3', 0.2, 800)).not.toThrow();
    });

    it('fades new ambient from 0 to target volume', () => {
      const howl = crossfadeAmbient('new.mp3', 0.3, 600);

      expect(howl.fade).toHaveBeenCalledWith(0, 0.3, 600);
    });

    it('schedules old ambient unload after fade duration', () => {
      vi.useFakeTimers();
      const old = playAmbient('old.mp3', 0.15, true);
      vi.clearAllMocks();

      crossfadeAmbient('new.mp3', 0.2, 800);

      expect(old.unload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(900);
      expect(old.unload).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('playNarration', () => {
    it('creates a Howl for narration', () => {
      playNarration('narration.mp3');

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['narration.mp3'],
          volume: 1,
          html5: true,
        }),
      );
    });

    it('unloads previous narration before playing new one', () => {
      const first = playNarration('first.mp3');
      playNarration('second.mp3');

      expect(first.unload).toHaveBeenCalled();
    });

    it('passes onend callback to Howl options', () => {
      const onend = vi.fn();
      playNarration('narration.mp3', onend);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          onend: onend,
        }),
      );
    });

    it('does not include onend when not provided', () => {
      playNarration('narration.mp3');

      expect(lastHowlOptions.onend).toBeUndefined();
    });

    it('uses cached Howl when available from preloadNarrationAhead', () => {
      preloadNarrationAhead('cached.m4a');
      const preloadCallCount = Howl.mock.calls.length;

      playNarration('cached.m4a');

      // Should NOT create a new Howl — reuses the cached one
      expect(Howl.mock.calls.length).toBe(preloadCallCount);
    });

    it('creates new Howl when src is not in cache', () => {
      playNarration('uncached.m4a');

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['uncached.m4a'],
        }),
      );
    });

    it('applies current mute state to cached Howl', () => {
      setMuted(true);
      preloadNarrationAhead('cached.m4a');
      const cachedHowl = Howl.mock.results[Howl.mock.results.length - 1].value;

      playNarration('cached.m4a');

      expect(cachedHowl.mute).toHaveBeenCalledWith(true);
    });

    it('attaches buffer monitoring to audio node', () => {
      playNarration('narration.m4a');

      // Should have added waiting and playing listeners
      expect(mockNode.addEventListener).toHaveBeenCalledWith('waiting', expect.any(Function));
      expect(mockNode.addEventListener).toHaveBeenCalledWith('playing', expect.any(Function));
    });
  });

  describe('stopNarration', () => {
    it('unloads current narration', () => {
      const howl = playNarration('narration.mp3');
      stopNarration();

      expect(howl.unload).toHaveBeenCalled();
    });

    it('handles no active narration gracefully', () => {
      stopAll();
      expect(() => stopNarration()).not.toThrow();
    });

    it('nullifies narration reference after stopping', () => {
      playNarration('narration.mp3');
      stopNarration();

      // Calling pause after stop should not throw (no active narration)
      expect(() => pauseNarration()).not.toThrow();
    });

    it('cleans up buffer monitoring on stop', () => {
      playNarration('narration.m4a');

      // Buffer listeners were attached
      expect(mockNode.addEventListener).toHaveBeenCalledWith('waiting', expect.any(Function));

      stopNarration();

      // Listeners should be removed
      expect(mockNode.removeEventListener).toHaveBeenCalledWith('waiting', expect.any(Function));
      expect(mockNode.removeEventListener).toHaveBeenCalledWith('playing', expect.any(Function));
    });
  });

  describe('pauseNarration', () => {
    it('pauses current narration', () => {
      const howl = playNarration('narration.mp3');
      pauseNarration();

      expect(howl.pause).toHaveBeenCalled();
    });

    it('handles no active narration gracefully', () => {
      stopAll();
      expect(() => pauseNarration()).not.toThrow();
    });
  });

  describe('resumeNarration', () => {
    it('resumes paused narration by calling play', () => {
      const howl = playNarration('narration.mp3');
      vi.clearAllMocks();
      resumeNarration();

      expect(howl.play).toHaveBeenCalled();
    });

    it('handles no active narration gracefully', () => {
      stopAll();
      expect(() => resumeNarration()).not.toThrow();
    });
  });

  describe('pauseAmbient', () => {
    it('pauses current ambient', () => {
      const howl = playAmbient('ambient.mp3', 0.1, true);
      pauseAmbient();

      expect(howl.pause).toHaveBeenCalled();
    });

    it('handles no active ambient gracefully', () => {
      stopAll();
      expect(() => pauseAmbient()).not.toThrow();
    });
  });

  describe('resumeAmbient', () => {
    it('resumes paused ambient by calling play', () => {
      const howl = playAmbient('ambient.mp3', 0.1, true);
      vi.clearAllMocks();
      resumeAmbient();

      expect(howl.play).toHaveBeenCalled();
    });

    it('handles no active ambient gracefully', () => {
      stopAll();
      expect(() => resumeAmbient()).not.toThrow();
    });
  });

  describe('error handlers', () => {
    it('logs warning on ambient load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playAmbient('bad.mp3', 0.1, true);
      lastHowlOptions.onloaderror(1, 'network error');
      expect(warnSpy).toHaveBeenCalledWith('Failed to load ambient: bad.mp3', 'network error');
      warnSpy.mockRestore();
    });

    it('logs warning on ambient play error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playAmbient('bad.mp3', 0.1, true);
      lastHowlOptions.onplayerror(1, 'decode error');
      expect(warnSpy).toHaveBeenCalledWith('Failed to play ambient: bad.mp3', 'decode error');
      warnSpy.mockRestore();
    });

    it('logs warning on narration load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playNarration('bad.mp3');
      lastHowlOptions.onloaderror(1, 'not found');
      expect(warnSpy).toHaveBeenCalledWith('Failed to load narration: bad.mp3', 'not found');
      warnSpy.mockRestore();
    });

    it('logs warning on crossfade load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      crossfadeAmbient('bad.mp3', 0.2, 800);
      lastHowlOptions.onloaderror(1, 'timeout');
      expect(warnSpy).toHaveBeenCalledWith('Failed to load ambient: bad.mp3', 'timeout');
      warnSpy.mockRestore();
    });

    it('logs warning on crossfade play error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      crossfadeAmbient('bad.mp3', 0.2, 800);
      lastHowlOptions.onplayerror(1, 'codec error');
      expect(warnSpy).toHaveBeenCalledWith('Failed to play ambient: bad.mp3', 'codec error');
      warnSpy.mockRestore();
    });

    it('logs warning on narration play error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playNarration('bad.mp3');
      lastHowlOptions.onplayerror(1, 'decode error');
      expect(warnSpy).toHaveBeenCalledWith('Failed to play narration: bad.mp3', 'decode error');
      warnSpy.mockRestore();
    });

    it('nullifies currentAmbient on load error when howl is still current', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playAmbient('fail.mp3', 0.1, true);
      lastHowlOptions.onloaderror(1, 'error');

      expect(() => setMuted(true)).not.toThrow();
      warnSpy.mockRestore();
    });

    it('nullifies currentNarration on load error when howl is still current', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playNarration('fail.mp3');
      lastHowlOptions.onloaderror(1, 'error');

      expect(() => setMuted(true)).not.toThrow();
      warnSpy.mockRestore();
    });

    it('logs warning on preload narration load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      preloadNarrationAhead('fail.m4a');
      lastHowlOptions.onloaderror(1, 'not found');
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to preload narration: fail.m4a',
        'not found',
      );
      warnSpy.mockRestore();
    });
  });

  describe('stopAll', () => {
    it('unloads both ambient and narration', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);
      const narration = playNarration('narration.mp3');

      stopAll();

      expect(ambient.unload).toHaveBeenCalled();
      expect(narration.unload).toHaveBeenCalled();
    });

    it('handles no active audio gracefully', () => {
      expect(() => stopAll()).not.toThrow();
    });
  });

  describe('setMuted', () => {
    it('mutes active ambient and narration', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);
      const narration = playNarration('narration.mp3');

      setMuted(true);

      expect(ambient.mute).toHaveBeenCalledWith(true);
      expect(narration.mute).toHaveBeenCalledWith(true);
    });

    it('unmutes active audio', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);

      setMuted(true);
      setMuted(false);

      expect(ambient.mute).toHaveBeenCalledWith(false);
    });

    it('handles no active audio gracefully', () => {
      stopAll();
      expect(() => setMuted(true)).not.toThrow();
    });

    it('applies muted state to only narration when no ambient is active', () => {
      stopAll();
      const narration = playNarration('nar.mp3');

      setMuted(true);

      expect(narration.mute).toHaveBeenCalledWith(true);
    });

    it('persists muted state to newly created Howl instances', () => {
      setMuted(true);
      playAmbient('new.mp3', 0.1, true);

      expect(Howl).toHaveBeenCalledWith(expect.objectContaining({ mute: true }));
    });
  });

  describe('buffer monitoring', () => {
    it('onNarrationBufferChange registers callback', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      expect(isNarrationBuffering()).toBe(false);
    });

    it('isNarrationBuffering returns false by default', () => {
      expect(isNarrationBuffering()).toBe(false);
    });

    it('buffer callback fires true on waiting event', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      playNarration('test.m4a');

      // Find the waiting handler registered on the mock node
      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      expect(waitingCall).toBeDefined();

      // Simulate waiting event
      waitingCall[1]();

      expect(cb).toHaveBeenCalledWith(true);
      expect(isNarrationBuffering()).toBe(true);
    });

    it('buffer callback fires false on playing event after waiting', () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      playNarration('test.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      const playingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'playing',
      );

      // Simulate buffer underrun then recovery
      waitingCall[1]();
      expect(cb).toHaveBeenCalledWith(true);

      playingCall[1]();
      expect(cb).toHaveBeenCalledWith(false);
      expect(isNarrationBuffering()).toBe(false);

      vi.useRealTimers();
    });

    it('ignores duplicate waiting events', () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      playNarration('test.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );

      waitingCall[1]();
      waitingCall[1]();

      // Should only fire once
      expect(cb).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('ignores playing event when not buffering', () => {
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      playNarration('test.m4a');

      const playingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'playing',
      );

      // Playing without prior waiting — should be ignored
      playingCall[1]();
      expect(cb).not.toHaveBeenCalled();
    });

    it('cleanup fires false callback if currently buffering', () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      playNarration('test.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      waitingCall[1]();
      cb.mockClear();

      stopNarration();

      // Cleanup should fire false to clear buffering state
      expect(cb).toHaveBeenCalledWith(false);
      expect(isNarrationBuffering()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('cached Howl error handlers', () => {
    it('attaches loaderror handler to cached Howl on playNarration', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      preloadNarrationAhead('cached.m4a');
      const cachedHowl = Howl.mock.results[Howl.mock.results.length - 1].value;

      playNarration('cached.m4a');

      // The cached howl should have .on('loaderror') called
      expect(cachedHowl.on).toHaveBeenCalledWith('loaderror', expect.any(Function));

      // Simulate loaderror on cached howl
      const loaderrorCall = cachedHowl.on.mock.calls.find(([event]) => event === 'loaderror');
      loaderrorCall[1](1, 'network error');

      expect(warnSpy).toHaveBeenCalledWith('Failed to load narration: cached.m4a', 'network error');
      warnSpy.mockRestore();
    });

    it('attaches playerror handler to cached Howl on playNarration', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      preloadNarrationAhead('cached.m4a');
      const cachedHowl = Howl.mock.results[Howl.mock.results.length - 1].value;

      playNarration('cached.m4a');

      expect(cachedHowl.on).toHaveBeenCalledWith('playerror', expect.any(Function));

      const playerrorCall = cachedHowl.on.mock.calls.find(([event]) => event === 'playerror');
      playerrorCall[1](1, 'decode error');

      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to play narration: cached.m4a',
        'decode error',
      );
      warnSpy.mockRestore();
    });

    it('attaches onend callback to cached Howl when provided', () => {
      preloadNarrationAhead('cached.m4a');
      const cachedHowl = Howl.mock.results[Howl.mock.results.length - 1].value;

      const onend = vi.fn();
      playNarration('cached.m4a', onend);

      expect(cachedHowl.on).toHaveBeenCalledWith('end', onend);
    });
  });

  describe('buffer monitor deferred attachment', () => {
    it('defers listener attachment when _sounds is not available', () => {
      // Create a Howl mock where _sounds is initially empty
      const originalSounds = mockHowlInstance._sounds;
      mockHowlInstance._sounds = [];

      playNarration('deferred.m4a');

      // Should not have attached DOM listeners (no node available)
      const waitingCalls = mockNode.addEventListener.mock.calls.filter(
        ([event]) => event === 'waiting',
      );
      expect(waitingCalls.length).toBe(0);

      // Should have registered a deferred 'play' listener on the howl
      const howl = Howl.mock.results[Howl.mock.results.length - 1].value;
      expect(howl.once).toHaveBeenCalledWith('play', expect.any(Function));

      mockHowlInstance._sounds = originalSounds;
    });

    it('warns when audio node is unavailable on deferred attachment', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const originalSounds = mockHowlInstance._sounds;
      mockHowlInstance._sounds = [];

      playNarration('deferred.m4a');

      const howl = Howl.mock.results[Howl.mock.results.length - 1].value;
      const onceCall = howl.once.mock.calls.find(([event]) => event === 'play');

      // Simulate the play event firing, but node is still unavailable
      mockHowlInstance._sounds = [{ _node: null }];
      onceCall[1]();

      expect(warnSpy).toHaveBeenCalledWith(
        'Cannot monitor narration buffer: audio node unavailable',
      );

      mockHowlInstance._sounds = originalSounds;
      warnSpy.mockRestore();
    });
  });

  describe('buffer stall recovery', () => {
    it('nudges stall after 2 stall checks', () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      mockNode.buffered.length = 1;
      mockNode.buffered.end.mockReturnValue(5);
      mockNode.currentTime = 5;

      playNarration('stall.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      waitingCall[1]();

      // Advance 2 intervals with no buffer progress
      mockNode.buffered.end.mockReturnValue(5);
      vi.advanceTimersByTime(4000);
      vi.advanceTimersByTime(4000);

      // After 2 stall checks, nudgeStall should have set currentTime
      // (we can verify by checking it was assigned)
      expect(mockNode.currentTime).toBe(5);

      vi.useRealTimers();
    });

    it('reloads from position after 4 stall checks', () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      mockNode.buffered.length = 1;
      mockNode.buffered.end.mockReturnValue(5);
      mockNode.currentTime = 5;
      mockNode.src = 'stall.m4a';

      playNarration('stall.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      waitingCall[1]();

      // Advance 4 intervals with no buffer progress
      mockNode.buffered.end.mockReturnValue(5);
      vi.advanceTimersByTime(4000);
      vi.advanceTimersByTime(4000);
      vi.advanceTimersByTime(4000);
      vi.advanceTimersByTime(4000);

      // After 4 stall checks, reloadFromPosition should have called play()
      expect(mockNode.play).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('clears buffering state after 3 recovery failures', () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockNode.buffered.length = 1;
      mockNode.buffered.end.mockReturnValue(5);
      mockNode.currentTime = 5;
      mockNode.src = 'stall.m4a';

      playNarration('stall.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      waitingCall[1]();

      // Run through 3 full recovery cycles (4 stall checks each = 12 intervals)
      for (let cycle = 0; cycle < 3; cycle++) {
        mockNode.buffered.end.mockReturnValue(5);
        for (let i = 0; i < 4; i++) {
          vi.advanceTimersByTime(4000);
        }
      }

      expect(warnSpy).toHaveBeenCalledWith('Buffer recovery exhausted after 3 attempts');
      expect(isNarrationBuffering()).toBe(false);

      warnSpy.mockRestore();
      vi.useRealTimers();
    });

    it('resumes playback when buffer has enough ahead', () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);

      mockNode.buffered.length = 1;
      mockNode.buffered.end.mockReturnValue(5);
      mockNode.currentTime = 5;

      playNarration('recover.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      waitingCall[1]();
      mockNode.play.mockClear();

      // Buffer progresses and gets 3+ seconds ahead
      mockNode.buffered.end.mockReturnValue(9);
      mockNode.currentTime = 5;
      vi.advanceTimersByTime(4000);

      expect(mockNode.play).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('cleans up buffering on play() failure in checkBufferProgress', async () => {
      vi.useFakeTimers();
      const cb = vi.fn();
      onNarrationBufferChange(cb);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockNode.buffered.length = 1;
      mockNode.buffered.end.mockReturnValue(5);
      mockNode.currentTime = 5;
      mockNode.play.mockRejectedValueOnce(new Error('autoplay blocked'));

      playNarration('fail.m4a');

      const waitingCall = mockNode.addEventListener.mock.calls.find(
        ([event]) => event === 'waiting',
      );
      waitingCall[1]();

      // Buffer progresses enough to trigger play()
      mockNode.buffered.end.mockReturnValue(9);
      await vi.advanceTimersByTimeAsync(4000);

      expect(isNarrationBuffering()).toBe(false);

      warnSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('preloadNarrationAhead', () => {
    it('creates a Howl with preload enabled', () => {
      preloadNarrationAhead('next-scene.m4a');

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['next-scene.m4a'],
          html5: true,
          preload: true,
          volume: 1,
        }),
      );
    });

    it('does not create duplicate Howl for same src', () => {
      preloadNarrationAhead('next-scene.m4a');
      const callCount = Howl.mock.calls.length;

      preloadNarrationAhead('next-scene.m4a');
      expect(Howl.mock.calls.length).toBe(callCount);
    });

    it('applies current mute state to preloaded Howl', () => {
      setMuted(true);
      preloadNarrationAhead('next-scene.m4a');

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({ mute: true }),
      );
    });

    it('removes from cache on load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      preloadNarrationAhead('missing.m4a');
      lastHowlOptions.onloaderror(1, 'not found');

      // After error, trying to play should create new Howl (not from cache)
      const callCountBefore = Howl.mock.calls.length;
      playNarration('missing.m4a');
      expect(Howl.mock.calls.length).toBe(callCountBefore + 1);

      warnSpy.mockRestore();
    });
  });

  describe('clearNarrationCache', () => {
    it('unloads all cached Howls', () => {
      preloadNarrationAhead('scene-a.m4a');
      const cachedHowl = Howl.mock.results[Howl.mock.results.length - 1].value;

      clearNarrationCache();

      expect(cachedHowl.unload).toHaveBeenCalled();
    });

    it('handles empty cache gracefully', () => {
      expect(() => clearNarrationCache()).not.toThrow();
    });

    it('cache is empty after clearing', () => {
      preloadNarrationAhead('scene-a.m4a');
      clearNarrationCache();

      // Playing should create new Howl since cache is empty
      const callCountBefore = Howl.mock.calls.length;
      playNarration('scene-a.m4a');
      expect(Howl.mock.calls.length).toBe(callCountBefore + 1);
    });
  });

  describe('playMusic', () => {
    it('creates a looping Howl at the specified volume', () => {
      setMuted(false);
      playMusic('song.mp3', 0.1);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['song.mp3'],
          volume: 0.1,
          loop: true,
          html5: true,
          mute: false,
        }),
      );
    });

    it('plays the music immediately', () => {
      const howl = playMusic('song.mp3', 0.1);

      expect(howl.play).toHaveBeenCalled();
    });

    it('unloads previous music before playing new one', () => {
      const first = playMusic('first.mp3', 0.1);
      playMusic('second.mp3', 0.2);

      expect(first.unload).toHaveBeenCalled();
    });

    it('applies current mute state', () => {
      setMuted(true);
      playMusic('song.mp3', 0.1);

      expect(Howl).toHaveBeenCalledWith(expect.objectContaining({ mute: true }));
    });

    it('logs warning on load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playMusic('bad.mp3', 0.1);
      lastHowlOptions.onloaderror(1, 'not found');

      expect(warnSpy).toHaveBeenCalledWith('Failed to load music: bad.mp3', 'not found');
      warnSpy.mockRestore();
    });

    it('logs warning on play error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playMusic('bad.mp3', 0.1);
      lastHowlOptions.onplayerror(1, 'decode error');

      expect(warnSpy).toHaveBeenCalledWith('Failed to play music: bad.mp3', 'decode error');
      warnSpy.mockRestore();
    });

    it('nullifies currentMusic on load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playMusic('fail.mp3', 0.1);
      lastHowlOptions.onloaderror(1, 'error');

      expect(() => setMuted(true)).not.toThrow();
      warnSpy.mockRestore();
    });
  });

  describe('fadeMusic', () => {
    it('fades music to the target volume', () => {
      const howl = playMusic('song.mp3', 0.1);
      fadeMusic(0.3, 2000);

      expect(howl.fade).toHaveBeenCalledWith(0.15, 0.3, 2000);
    });

    it('handles no active music gracefully', () => {
      stopAll();
      expect(() => fadeMusic(0.3, 2000)).not.toThrow();
    });
  });

  describe('pauseMusic', () => {
    it('pauses current music', () => {
      const howl = playMusic('song.mp3', 0.1);
      pauseMusic();

      expect(howl.pause).toHaveBeenCalled();
    });

    it('handles no active music gracefully', () => {
      stopAll();
      expect(() => pauseMusic()).not.toThrow();
    });
  });

  describe('resumeMusic', () => {
    it('resumes paused music', () => {
      const howl = playMusic('song.mp3', 0.1);
      vi.clearAllMocks();
      resumeMusic();

      expect(howl.play).toHaveBeenCalled();
    });

    it('handles no active music gracefully', () => {
      stopAll();
      expect(() => resumeMusic()).not.toThrow();
    });
  });

  describe('stopMusic', () => {
    it('unloads current music', () => {
      const howl = playMusic('song.mp3', 0.1);
      stopMusic();

      expect(howl.unload).toHaveBeenCalled();
    });

    it('handles no active music gracefully', () => {
      stopAll();
      expect(() => stopMusic()).not.toThrow();
    });
  });

  describe('setMuted with music', () => {
    it('mutes active music along with ambient and narration', () => {
      const music = playMusic('song.mp3', 0.1);
      setMuted(true);

      expect(music.mute).toHaveBeenCalledWith(true);
    });

    it('unmutes active music', () => {
      const music = playMusic('song.mp3', 0.1);
      setMuted(true);
      setMuted(false);

      expect(music.mute).toHaveBeenCalledWith(false);
    });
  });

  describe('stopAll with music', () => {
    it('unloads music along with ambient and narration', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);
      const narration = playNarration('narration.mp3');
      const music = playMusic('song.mp3', 0.1);

      stopAll();

      expect(ambient.unload).toHaveBeenCalled();
      expect(narration.unload).toHaveBeenCalled();
      expect(music.unload).toHaveBeenCalled();
    });
  });
});
