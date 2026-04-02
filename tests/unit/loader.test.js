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

    it('falls back to duration 0 when metadata duration is NaN', async () => {
      globalThis.Audio = class MockAudio {
        duration = Number.NaN;
        set preload(_v) {}
        set src(v) {
          this._src = v;
          setTimeout(() => this.onloadedmetadata?.(), 0);
        }
        get src() {
          return this._src;
        }
      };

      const p = preloadAudio('nan.m4a');
      vi.advanceTimersByTime(1);
      const result = await p;

      expect(result).toEqual({ src: 'nan.m4a', duration: 0 });
    });

    it('rejects on audio error', async () => {
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
      await expect(p).rejects.toThrow('Failed to preload audio: bad.m4a');
    });

    it('rejects on timeout', async () => {
      const p = preloadAudio('slow.m4a');

      vi.advanceTimersByTime(5000);

      await expect(p).rejects.toThrow('Audio preload timed out: slow.m4a');
    });

    it('cleans up handlers and src on timeout', async () => {
      let audioInstance;
      globalThis.Audio = class MockAudio {
        constructor() { audioInstance = this; }
        set preload(_v) {}
        set src(v) { this._src = v; }
        get src() { return this._src; }
      };

      const p = preloadAudio('stall.m4a');
      vi.advanceTimersByTime(5000);
      await expect(p).rejects.toThrow();

      expect(audioInstance.onloadedmetadata).toBeNull();
      expect(audioInstance.onerror).toBeNull();
      expect(audioInstance.src).toBe('');
    });

    it('cleans up handlers and src after successful metadata load', async () => {
      let audioInstance;
      globalThis.Audio = class MockAudio {
        constructor() {
          audioInstance = this;
          this.duration = 7.25;
        }
        set preload(_v) {}
        set src(v) {
          this._src = v;
          setTimeout(() => this.onloadedmetadata?.(), 0);
        }
        get src() {
          return this._src;
        }
      };

      const p = preloadAudio('clean.m4a');
      vi.advanceTimersByTime(1);
      await p;

      expect(audioInstance.onloadedmetadata).toBeNull();
      expect(audioInstance.onerror).toBeNull();
      expect(audioInstance.src).toBe('');
    });
  });

  describe('audioSrcsFromEntry', () => {
    it('extracts sources from audioCues array', () => {
      const entry = {
        audioCues: [
          { src: 'ambient.mp3' },
          { src: 'narration.m4a' },
          { src: 'music.mp3' },
        ],
      };
      expect(audioSrcsFromEntry(entry)).toEqual(['ambient.mp3', 'narration.m4a', 'music.mp3']);
    });

    it('filters out falsy sources', () => {
      const entry = {
        audioCues: [{ src: 'narration.m4a' }, { src: null }, { src: '' }],
      };
      expect(audioSrcsFromEntry(entry)).toEqual(['narration.m4a']);
    });

    it('returns empty array when audioCues is null', () => {
      expect(audioSrcsFromEntry({ audioCues: null })).toEqual([]);
    });

    it('returns empty array when audioCues is missing', () => {
      expect(audioSrcsFromEntry({})).toEqual([]);
    });

    it('returns empty array when audioCues is empty', () => {
      expect(audioSrcsFromEntry({ audioCues: [] })).toEqual([]);
    });
  });

  describe('preloadFirstFrameAudio', () => {
    let originalAudio;

    beforeEach(() => {
      originalAudio = globalThis.Audio;
    });

    afterEach(() => {
      globalThis.Audio = originalAudio;
    });

    it('does nothing when frames array is empty', () => {
      const onLoaded = vi.fn();
      preloadFirstFrameAudio([], onLoaded);
      vi.advanceTimersByTime(5000);
      expect(onLoaded).not.toHaveBeenCalled();
    });

    it('calls onLoaded for each audio source', async () => {
      globalThis.Audio = class MockAudio {
        set preload(_v) {}
        set src(v) {
          this._src = v;
          this.duration = v.includes('ambient') ? 4 : 6.5;
          setTimeout(() => this.onloadedmetadata?.(), 0);
        }
        get src() {
          return this._src;
        }
      };

      const onLoaded = vi.fn();
      const frames = [
        {
          audioCues: [
            { src: 'ambient.mp3' },
            { src: 'narration.m4a' },
          ],
        },
      ];

      preloadFirstFrameAudio(frames, onLoaded);

      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();

      expect(onLoaded).toHaveBeenCalledTimes(2);
      expect(onLoaded).toHaveBeenNthCalledWith(1, { src: 'ambient.mp3', duration: 4 });
      expect(onLoaded).toHaveBeenNthCalledWith(2, { src: 'narration.m4a', duration: 6.5 });
    });

    it('does nothing when first frame has no audio', () => {
      const onLoaded = vi.fn();
      const frames = [{ audioCues: null }];

      preloadFirstFrameAudio(frames, onLoaded);

      vi.advanceTimersByTime(5000);
      expect(onLoaded).not.toHaveBeenCalled();
    });
  });

  describe('preloadFirstFrameAudio — error handling', () => {
    it('logs warning and skips onLoaded when metadata never loads', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const origAudio = globalThis.Audio;
      globalThis.Audio = class MockAudio {
        set preload(_v) {}
        set src(_v) {}
        get src() { return ''; }
      };

      const onLoaded = vi.fn();
      const frames = [{ audioCues: [{ src: 'fail.m4a' }] }];

      preloadFirstFrameAudio(frames, onLoaded);

      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();

      expect(onLoaded).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('Audio preload timed out: fail.m4a');
      globalThis.Audio = origAudio;
    });
  });

  describe('preloadBackgroundAudio', () => {
    let originalAudio;

    beforeEach(() => {
      originalAudio = globalThis.Audio;
      globalThis.Audio = class MockAudio {
        duration = 5;
        set preload(_v) {}
        set src(v) {
          this._src = v;
          setTimeout(() => this.onloadedmetadata?.(), 0);
        }
        get src() { return this._src; }
      };
    });

    afterEach(() => {
      globalThis.Audio = originalAudio;
    });

    it('skips first frame audio sources to avoid duplicates', async () => {
      const onLoaded = vi.fn();
      const frames = [
        { audioCues: [{ src: 'shared.m4a' }] },
        { audioCues: [{ src: 'shared.m4a' }] },
      ];

      const p = preloadBackgroundAudio(frames, onLoaded);
      vi.advanceTimersByTime(1);
      await vi.runAllTimersAsync();
      await p;

      expect(onLoaded).not.toHaveBeenCalled();
    });

    it('preloads unique audio from later frames', async () => {
      const onLoaded = vi.fn();
      const frames = [
        { audioCues: [{ src: 'first.m4a' }] },
        { audioCues: [{ src: 'second.m4a' }] },
      ];

      const p = preloadBackgroundAudio(frames, onLoaded);
      vi.advanceTimersByTime(1);
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
      const frames = [{ audioCues: null }, { audioCues: null }];

      await preloadBackgroundAudio(frames, onLoaded);

      expect(onLoaded).not.toHaveBeenCalled();
    });
  });
});
