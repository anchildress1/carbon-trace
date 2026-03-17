import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initSceneCanvas,
  drawImage,
  clearScene,
  destroySceneCanvas,
  getSceneContext,
  loadImage,
  getImageCache,
} from '../../src/canvas.js';

function createMockCanvas() {
  const mockCtx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    resetTransform: vi.fn(),
    scale: vi.fn(),
  };

  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx);

  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    width: 1920,
    height: 1080,
    top: 0,
    left: 0,
    right: 1920,
    bottom: 1080,
    x: 0,
    y: 0,
    toJSON: () => {},
  });

  return { canvas, mockCtx };
}

describe('canvas.js', () => {
  let originalImage;

  beforeEach(() => {
    destroySceneCanvas();
    getImageCache().clear();

    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }));

    originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      constructor() {
        this.naturalWidth = 3840;
        this.naturalHeight = 2160;
      }

      set src(val) {
        this._src = val;
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
    destroySceneCanvas();
    getImageCache().clear();
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  describe('initSceneCanvas', () => {
    it('returns a 2d context', () => {
      const { canvas, mockCtx } = createMockCanvas();
      const ctx = initSceneCanvas(canvas);
      expect(ctx).toBe(mockCtx);
    });

    it('sets canvas dimensions based on bounding rect and DPR', () => {
      const { canvas } = createMockCanvas();
      const dpr = globalThis.devicePixelRatio || 1;
      initSceneCanvas(canvas);
      expect(canvas.width).toBe(1920 * dpr);
      expect(canvas.height).toBe(1080 * dpr);
    });

    it('creates a ResizeObserver', () => {
      const { canvas } = createMockCanvas();
      initSceneCanvas(canvas);
      expect(globalThis.ResizeObserver).toHaveBeenCalled();
    });

    it('throws for non-canvas element', () => {
      expect(() => initSceneCanvas(document.createElement('div'))).toThrow();
    });

    it('throws for null', () => {
      expect(() => initSceneCanvas(null)).toThrow();
    });
  });

  describe('drawImage', () => {
    it('draws image with cover-fit to canvas', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      const img = { naturalWidth: 3840, naturalHeight: 2160 };
      drawImage(img);

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.drawImage).toHaveBeenCalled();
    });

    it('clears canvas when passed null', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      drawImage(null);

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.drawImage).not.toHaveBeenCalled();
    });

    it('redraws on resize', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      const img = { naturalWidth: 3840, naturalHeight: 2160 };
      drawImage(img);
      mockCtx.drawImage.mockClear();

      // Trigger ResizeObserver callback
      const observerCb = globalThis.ResizeObserver.mock.calls[0][0];
      observerCb();

      expect(mockCtx.drawImage).toHaveBeenCalled();
    });
  });

  describe('clearScene', () => {
    it('clears the canvas and nulls currentImg', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      const img = { naturalWidth: 3840, naturalHeight: 2160 };
      drawImage(img);
      mockCtx.clearRect.mockClear();

      clearScene();

      expect(mockCtx.clearRect).toHaveBeenCalled();
    });
  });

  describe('destroySceneCanvas', () => {
    it('disconnects ResizeObserver', () => {
      const { canvas } = createMockCanvas();
      initSceneCanvas(canvas);
      const instance = globalThis.ResizeObserver.mock.results[0].value;
      destroySceneCanvas();
      expect(instance.disconnect).toHaveBeenCalled();
    });

    it('nulls the context', () => {
      const { canvas } = createMockCanvas();
      initSceneCanvas(canvas);
      destroySceneCanvas();
      expect(getSceneContext()).toBeNull();
    });

    it('is safe to call twice', () => {
      const { canvas } = createMockCanvas();
      initSceneCanvas(canvas);
      destroySceneCanvas();
      expect(() => destroySceneCanvas()).not.toThrow();
    });
  });

  describe('getSceneContext', () => {
    it('returns null before init', () => {
      expect(getSceneContext()).toBeNull();
    });

    it('returns ctx after init', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);
      expect(getSceneContext()).toBe(mockCtx);
    });
  });

  describe('loadImage', () => {
    it('resolves with an Image object', async () => {
      vi.useFakeTimers();
      const p = loadImage('test.webp');
      vi.advanceTimersByTime(1);
      const img = await p;
      expect(img).not.toBeNull();
      vi.useRealTimers();
    });

    it('caches the promise', () => {
      const p1 = loadImage('test.webp');
      const p2 = loadImage('test.webp');
      expect(p1).toBe(p2);
    });

    it('resolves with null on error', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = loadImage('bad://fail.webp');
      vi.advanceTimersByTime(1);
      const img = await p;
      expect(img).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('cover-fit', () => {
    it('handles wider image than canvas (crops sides)', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      // Very wide image
      const img = { naturalWidth: 5000, naturalHeight: 1000 };
      drawImage(img);

      const call = mockCtx.drawImage.mock.calls[0];
      // Source should be cropped (sx > 0)
      expect(call[1]).toBeGreaterThan(0); // sx
      expect(call[2]).toBe(0); // sy
    });

    it('handles taller image than canvas (crops top/bottom)', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      // Very tall image
      const img = { naturalWidth: 1000, naturalHeight: 5000 };
      drawImage(img);

      const call = mockCtx.drawImage.mock.calls[0];
      expect(call[1]).toBe(0); // sx
      expect(call[2]).toBeGreaterThan(0); // sy
    });
  });
});
