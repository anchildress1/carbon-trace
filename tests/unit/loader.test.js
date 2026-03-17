import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  preloadImage,
  preloadAudio,
  audioSrcsFromEntry,
  preloadFirstFrameAssets,
  preloadFirstFrameAudio,
  preloadBackgroundAssets,
} from '../../src/loader.js';

describe('loader.js', () => {
  let originalImage;

  beforeEach(() => {
    vi.useFakeTimers();

    // happy-dom's Image doesn't fire onload/onerror, so mock it
    originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      set src(val) {
        this._src = val;
        // Simulate async load
        if (val && !val.startsWith('bad://')) {
          setTimeout(() => this.onload?.(), 0);
        } else {
          setTimeout(() => this.onerror?.(), 0);
        }
      }

      get src() {
        return this._src;
      }
    };
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('preloadImage', () => {
    it('resolves when image loads', async () => {
      const p = preloadImage('test.webp');
      vi.advanceTimersByTime(1);
      await expect(p).resolves.not.toThrow();
    });

    it('resolves (does not reject) when image fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = preloadImage('bad://missing.webp');
      vi.advanceTimersByTime(1);
      await expect(p).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith('Failed to load image: bad://missing.webp');
      warnSpy.mockRestore();
    });
  });

  describe('preloadAudio', () => {
    let originalAudio;

    beforeEach(() => {
      originalAudio = globalThis.Audio;
    });

    afterEach(() => {
      globalThis.Audio = originalAudio;
    });

    it('resolves with src when metadata loads successfully', async () => {
      globalThis.Audio = class MockAudio {
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

      expect(result).toBe('test.m4a');
    });

    it('resolves with null on audio error', async () => {
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

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('Failed to preload audio: bad.m4a');
      warnSpy.mockRestore();
    });

    it('resolves with null on timeout', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = preloadAudio('slow.m4a');

      vi.advanceTimersByTime(5000);

      const result = await p;
      expect(result).toBeNull();
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

  describe('preloadFirstFrameAssets', () => {
    it('resolves immediately when first frame has no image', async () => {
      const frames = [{ id: 'title', narration: null }];
      await expect(preloadFirstFrameAssets(frames)).resolves.not.toThrow();
    });

    it('preloads first frame image when present', async () => {
      const frames = [{ id: 'scene-01', image: 'test.webp' }];
      const p = preloadFirstFrameAssets(frames);
      vi.advanceTimersByTime(1);
      await expect(p).resolves.not.toThrow();
    });

    it('resolves when frames array is empty', async () => {
      await expect(preloadFirstFrameAssets([])).resolves.not.toThrow();
    });
  });

  describe('preloadFirstFrameAudio', () => {
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

      expect(onLoaded).toHaveBeenCalledWith(null);
      globalThis.Audio = origAudio;
      warnSpy.mockRestore();
    });
  });

  describe('preloadBackgroundAssets', () => {
    it('skips first frame audio sources to avoid duplicates', async () => {
      const onLoaded = vi.fn();
      const frames = [
        { narration: { audio: 'shared.m4a' }, ambient: null, music: null },
        { narration: { audio: 'shared.m4a' }, ambient: null, music: null },
      ];

      const p = preloadBackgroundAssets(frames, onLoaded);
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

      const p = preloadBackgroundAssets(frames, onLoaded);
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();
      await p;

      expect(onLoaded).toHaveBeenCalledTimes(1);
    });

    it('handles empty frames array', async () => {
      const onLoaded = vi.fn();
      await preloadBackgroundAssets([], onLoaded);

      expect(onLoaded).not.toHaveBeenCalled();
    });

    it('handles frames with images but no audio', async () => {
      const onLoaded = vi.fn();
      const frames = [
        { image: 'first.webp', narration: null, ambient: null, music: null },
        { image: 'second.webp', narration: null, ambient: null, music: null },
      ];

      const p = preloadBackgroundAssets(frames, onLoaded);
      vi.advanceTimersByTime(1);
      await p;

      expect(onLoaded).not.toHaveBeenCalled();
    });
  });
});
