import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initSceneCanvas,
  drawImage,
  clearScene,
  drawFallback,
  destroySceneCanvas,
  getSceneContext,
  loadImage,
  getImageCache,
} from '../../src/canvas.js';

function createMockCanvas(initialRect = { width: 1920, height: 1080 }) {
  const mockCtx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    resetTransform: vi.fn(),
    scale: vi.fn(),
  };

  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx);

  const rect = {
    width: initialRect.width,
    height: initialRect.height,
    top: 0,
    left: 0,
    right: initialRect.width,
    bottom: initialRect.height,
    x: 0,
    y: 0,
    toJSON: () => {},
  };
  const setRect = (width, height) => {
    rect.width = width;
    rect.height = height;
    rect.right = width;
    rect.bottom = height;
  };
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => ({ ...rect }));

  return { canvas, mockCtx, setRect };
}

describe('canvas.js', () => {
  let originalImage;
  let imageCtorCount;
  let resizeObserverInstances;

  beforeEach(() => {
    vi.useFakeTimers();
    destroySceneCanvas();
    getImageCache().clear();
    imageCtorCount = 0;
    resizeObserverInstances = [];

    globalThis.ResizeObserver = vi.fn(function (callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      resizeObserverInstances.push(this);
    });

    originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      constructor() {
        imageCtorCount++;
        this.naturalWidth = 3840;
        this.naturalHeight = 2160;
        this.width = 3840;
        this.height = 2160;
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
    vi.useRealTimers();
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
      const { canvas, mockCtx } = createMockCanvas();
      const dpr = globalThis.devicePixelRatio || 1;
      initSceneCanvas(canvas);
      expect(canvas.width).toBe(1920 * dpr);
      expect(canvas.height).toBe(1080 * dpr);
      expect(mockCtx.resetTransform).toHaveBeenCalledTimes(1);
      expect(mockCtx.scale).toHaveBeenCalledWith(dpr, dpr);
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

    it('throws when getContext returns null', () => {
      const canvas = document.createElement('canvas');
      vi.spyOn(canvas, 'getContext').mockReturnValue(null);

      expect(() => initSceneCanvas(canvas)).toThrow(
        'Failed to acquire 2D scene canvas context',
      );
    });

    it('destroys previous canvas before initializing new one', () => {
      const { canvas: first } = createMockCanvas();
      initSceneCanvas(first);
      const firstObserver = globalThis.ResizeObserver.mock.results[0].value;

      const { canvas: second } = createMockCanvas();
      initSceneCanvas(second);

      expect(firstObserver.disconnect).toHaveBeenCalled();
    });
  });

  describe('drawImage', () => {
    it('draws image with full cover-fit coordinates', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      const img = { naturalWidth: 5000, naturalHeight: 1000, width: 5000, height: 1000 };
      drawImage(img);

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.drawImage).toHaveBeenCalledTimes(1);
      const call = mockCtx.drawImage.mock.calls[0];
      expect(call).toHaveLength(9);
      expect(call[0]).toBe(img);
      expect(call[1]).toBeCloseTo((5000 - 1000 * (1920 / 1080)) / 2, 5);
      expect(call[2]).toBe(0);
      expect(call[3]).toBeCloseTo(1000 * (1920 / 1080), 5);
      expect(call[4]).toBe(1000);
      expect(call[5]).toBe(0);
      expect(call[6]).toBe(0);
      expect(call[7]).toBe(1920);
      expect(call[8]).toBe(1080);
    });

    it('clears canvas when passed null', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      drawImage(null);

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.drawImage).not.toHaveBeenCalled();
    });

    it('redraws on resize after re-sizing canvas dimensions', () => {
      const { canvas, mockCtx, setRect } = createMockCanvas();
      initSceneCanvas(canvas);
      const dpr = globalThis.devicePixelRatio || 1;

      const img = { naturalWidth: 3840, naturalHeight: 2160 };
      drawImage(img);
      expect(canvas.width).toBe(1920 * dpr);
      expect(canvas.height).toBe(1080 * dpr);

      mockCtx.drawImage.mockClear();
      mockCtx.resetTransform.mockClear();
      mockCtx.scale.mockClear();

      setRect(1600, 900);
      resizeObserverInstances[0].callback([{ target: canvas }]);

      expect(canvas.width).toBe(1600 * dpr);
      expect(canvas.height).toBe(900 * dpr);
      expect(mockCtx.resetTransform).toHaveBeenCalledTimes(1);
      expect(mockCtx.scale).toHaveBeenCalledWith(dpr, dpr);
      expect(mockCtx.drawImage).toHaveBeenCalledWith(
        img,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        0,
        0,
        1600,
        900,
      );
    });

    it('supports fallback img.width/img.height when natural size is unavailable', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      const img = { naturalWidth: 0, naturalHeight: 0, width: 1920, height: 1080 };
      drawImage(img);

      const call = mockCtx.drawImage.mock.calls[0];
      expect(call[1]).toBe(0);
      expect(call[2]).toBe(0);
      expect(call[3]).toBe(1920);
      expect(call[4]).toBe(1080);
    });
  });

  describe('clearScene', () => {
    it('does nothing when canvas is not initialized', () => {
      destroySceneCanvas();
      expect(() => clearScene()).not.toThrow();
    });

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

    it('is safe when resize observer callback runs after destroy', () => {
      const { canvas } = createMockCanvas();
      initSceneCanvas(canvas);
      const observerCb = resizeObserverInstances[0].callback;

      destroySceneCanvas();
      expect(() => observerCb([{ target: canvas }])).not.toThrow();
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
      const p = loadImage('test.webp');
      vi.advanceTimersByTime(1);
      const img = await p;
      expect(img).not.toBeNull();
    });

    it('caches the promise', () => {
      const p1 = loadImage('test.webp');
      const p2 = loadImage('test.webp');
      expect(p1).toBe(p2);
    });

    it('resolves with null on error and evicts from cache', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const p = loadImage('bad://fail.webp');
      vi.advanceTimersByTime(1);
      const img = await p;
      expect(img).toBeNull();
      // Failed load should be evicted so retry is possible
      expect(getImageCache().has('bad://fail.webp')).toBe(false);
    });

    it('deduplicates concurrent in-flight loads to one Image allocation', async () => {
      const p1 = loadImage('shared.webp');
      const p2 = loadImage('shared.webp');
      expect(p1).toBe(p2);
      expect(imageCtorCount).toBe(1);
      vi.advanceTimersByTime(1);
      await p1;
    });
  });

  describe('drawFallback', () => {
    it('fills canvas with dark glass color', () => {
      const { canvas, mockCtx } = createMockCanvas();
      mockCtx.fillRect = vi.fn();
      initSceneCanvas(canvas);

      drawFallback();

      expect(mockCtx.fillStyle).toBe('rgba(18, 18, 24, 0.92)');
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    });

    it('does nothing when canvas is not initialized', () => {
      destroySceneCanvas();
      expect(() => drawFallback()).not.toThrow();
    });
  });

  describe('cover-fit', () => {
    it('handles wider image than canvas (crops sides) with complete draw args', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      // Very wide image
      const img = { naturalWidth: 5000, naturalHeight: 1000, width: 5000, height: 1000 };
      drawImage(img);

      const call = mockCtx.drawImage.mock.calls[0];
      const expectedSw = 1000 * (1920 / 1080);
      expect(call[1]).toBeCloseTo((5000 - expectedSw) / 2, 5); // sx
      expect(call[2]).toBe(0); // sy
      expect(call[3]).toBeCloseTo(expectedSw, 5); // sw
      expect(call[4]).toBe(1000); // sh
      expect(call[5]).toBe(0); // dx
      expect(call[6]).toBe(0); // dy
      expect(call[7]).toBe(1920); // dw
      expect(call[8]).toBe(1080); // dh
    });

    it('handles image with same aspect ratio as canvas (no crop)', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      // 16:9 image on 16:9 canvas
      const img = { naturalWidth: 1920, naturalHeight: 1080, width: 1920, height: 1080 };
      drawImage(img);

      const call = mockCtx.drawImage.mock.calls[0];
      expect(call[1]).toBe(0); // sx
      expect(call[2]).toBe(0); // sy
      expect(call[3]).toBe(1920); // sw
      expect(call[4]).toBe(1080); // sh
      expect(call[7]).toBe(1920); // dw
      expect(call[8]).toBe(1080); // dh
    });

    it('handles image with zero dimensions gracefully', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      const img = { naturalWidth: 0, naturalHeight: 0 };
      drawImage(img);

      expect(mockCtx.drawImage).toHaveBeenCalled();
    });

    it('does nothing when canvas is not initialized', () => {
      destroySceneCanvas();
      expect(() => drawImage({ naturalWidth: 100, naturalHeight: 100 })).not.toThrow();
    });

    it('handles taller image than canvas (crops top/bottom) with complete draw args', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initSceneCanvas(canvas);

      // Very tall image
      const img = { naturalWidth: 1000, naturalHeight: 5000, width: 1000, height: 5000 };
      drawImage(img);

      const call = mockCtx.drawImage.mock.calls[0];
      expect(call[1]).toBe(0); // sx
      expect(call[2]).toBeCloseTo((5000 - 1000 / (1920 / 1080)) / 2, 5); // sy
      expect(call[3]).toBe(1000); // sw
      expect(call[4]).toBeCloseTo(1000 / (1920 / 1080), 5); // sh
      expect(call[7]).toBe(1920); // dw
      expect(call[8]).toBe(1080); // dh
    });

    it('handles 4:3 canvas dimensions', () => {
      const { canvas, mockCtx } = createMockCanvas({ width: 1024, height: 768 });
      initSceneCanvas(canvas);

      drawImage({ naturalWidth: 3840, naturalHeight: 2160, width: 3840, height: 2160 });

      const call = mockCtx.drawImage.mock.calls[0];
      expect(call[7]).toBe(1024);
      expect(call[8]).toBe(768);
    });

    it('handles ultrawide canvas dimensions', () => {
      const { canvas, mockCtx } = createMockCanvas({ width: 2560, height: 1080 });
      initSceneCanvas(canvas);

      drawImage({ naturalWidth: 1920, naturalHeight: 1080, width: 1920, height: 1080 });

      const call = mockCtx.drawImage.mock.calls[0];
      expect(call[7]).toBe(2560);
      expect(call[8]).toBe(1080);
    });
  });
});
