import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  preloadAudio,
  audioSrcsFromEntry,
  preloadFirstFrameAudio,
  preloadBackgroundAudio,
} from '../../src/loader.js';

describe('loader.js', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('preloadAudio', () => {
    let originalAudio;

    beforeEach(() => {
      originalAudio = globalThis.Audio;
    });

    afterEach(() => {
      globalThis.Audio = originalAudio;
    });

    it('resolves with { src, duration } when metadata loads successfully', async () => {
      globalThis.Audio = class MockAudio {
        duration = 12.5;
        set preload(_v) {}
        set src(v) {
          this._src = v;
          setTimeout(() => this.onloadedmetadata?.(), 0);
        }
        get src() { return this._src; }
      };

      const p = preloadAudio('test.m4a');
      vi.advanceTimersByTime(1);
      const result = await p;

      expect(result).toEqual({ src: 'test.m4a', duration: 12.5 });
    });

    it('resolves with { src: null, duration: 0 } on audio error', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      globalThis.Audio = class MockAudio {
        set preload(_v) {}
        set src(v) {
          this._src = v;
          setTimeout(() => this.onerror?.(), 0);
        }
        get src() { return this._src; }
      };

      const p = preloadAudio('bad.m4a');
      vi.advanceTimersByTime(1);
      const result = await p;

      expect(result).toEqual({ src: null, duration: 0 });
      expect(warnSpy).toHaveBeenCalledWith('Failed to preload audio: bad.m4a');
      warnSpy.mockRestore();
    });

    it('resolves with { src: null, duration: 0 } on timeout', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = preloadAudio('slow.m4a');

      vi.advanceTimersByTime(5000);

      const result = await p;
      expect(result).toEqual({ src: null, duration: 0 });
      warnSpy.mockRestore();
    });
  });

  describe('audioSrcsFromEntry', () => {
    it('extracts ambient, narration, and music sources', () => {
      const entry = {
        ambient: { src: 'ambient.mp3' },
        narration: { audio: 'narration.m4a' },
        music: { src: 'music.mp3' },
      };
      expect(audioSrcsFromEntry(entry)).toEqual(['ambient.mp3', 'narration.m4a', 'music.mp3']);
    });

    it('filters out null sources', () => {
      const entry = {
        ambient: null,
        narration: { audio: 'narration.m4a' },
        music: null,
      };
      expect(audioSrcsFromEntry(entry)).toEqual(['narration.m4a']);
    });

    it('returns empty array when all sources are null', () => {
      const entry = { ambient: null, narration: null, music: null };
      expect(audioSrcsFromEntry(entry)).toEqual([]);
    });

    it('handles missing keys gracefully', () => {
      expect(audioSrcsFromEntry({})).toEqual([]);
    });

    it('handles narration without audio key', () => {
      const entry = { narration: { lines: [] } };
      expect(audioSrcsFromEntry(entry)).toEqual([]);
    });
  });

  describe('preloadFirstFrameAudio', () => {
    it('does nothing when frames array is empty', () => {
      const onLoaded = vi.fn();
      preloadFirstFrameAudio([], onLoaded);
      vi.advanceTimersByTime(5000);
      expect(onLoaded).not.toHaveBeenCalled();
    });

    it('calls onLoaded for each audio source', async () => {
      const onLoaded = vi.fn();
      const frames = [
        {
          narration: { audio: 'narration.m4a' },
          ambient: { src: 'ambient.mp3' },
          music: null,
        },
      ];

      preloadFirstFrameAudio(frames, onLoaded);

      // Advance past the 5s timeout for both audio preloads
      vi.advanceTimersByTime(5000);

      // Allow microtask promises to flush
      await vi.runAllTimersAsync();

      expect(onLoaded).toHaveBeenCalledTimes(2);
    });

    it('does nothing when first frame has no audio', () => {
      const onLoaded = vi.fn();
      const frames = [{ narration: null, ambient: null, music: null }];

      preloadFirstFrameAudio(frames, onLoaded);

      vi.advanceTimersByTime(5000);
      expect(onLoaded).not.toHaveBeenCalled();
    });
  });

  describe('preloadFirstFrameAudio — error handling', () => {
    it('catches and warns when preloadAudio promise rejects', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const origAudio = globalThis.Audio;
      globalThis.Audio = class MockAudio {
        set preload(_v) {}
        set src(_v) {
          // Neither metadata nor error — will timeout
        }
        get src() { return ''; }
      };

      const onLoaded = vi.fn();
      const frames = [{ narration: { audio: 'fail.m4a' }, ambient: null, music: null }];

      preloadFirstFrameAudio(frames, onLoaded);

      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();

      expect(onLoaded).toHaveBeenCalledWith({ src: null, duration: 0 });
      globalThis.Audio = origAudio;
      warnSpy.mockRestore();
    });
  });

  describe('preloadBackgroundAudio', () => {
    it('skips first frame audio sources to avoid duplicates', async () => {
      const onLoaded = vi.fn();
      const frames = [
        { narration: { audio: 'shared.m4a' }, ambient: null, music: null },
        { narration: { audio: 'shared.m4a' }, ambient: null, music: null },
      ];

      const p = preloadBackgroundAudio(frames, onLoaded);
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();
      await p;

      // shared.m4a is in frame 0, so frame 1's identical src is skipped
      expect(onLoaded).not.toHaveBeenCalled();
    });

    it('preloads unique audio from later frames', async () => {
      const onLoaded = vi.fn();
      const frames = [
        { narration: { audio: 'first.m4a' }, ambient: null, music: null },
        { narration: { audio: 'second.m4a' }, ambient: null, music: null },
      ];

      const p = preloadBackgroundAudio(frames, onLoaded);
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();
      await p;

      expect(onLoaded).toHaveBeenCalledTimes(1);
    });

    it('handles empty frames array', async () => {
      const onLoaded = vi.fn();
      await preloadBackgroundAudio([], onLoaded);

      expect(onLoaded).not.toHaveBeenCalled();
    });

    it('handles frames with no audio', async () => {
      const onLoaded = vi.fn();
      const frames = [
        { narration: null, ambient: null, music: null },
        { narration: null, ambient: null, music: null },
      ];

      await preloadBackgroundAudio(frames, onLoaded);

      expect(onLoaded).not.toHaveBeenCalled();
    });
  });
});
