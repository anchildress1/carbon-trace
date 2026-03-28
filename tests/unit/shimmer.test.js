import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset module state between tests by re-importing
let shimmer;

function createMockCanvas() {
  const ctx = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    fillRect: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(40 * 40 * 4),
      width: 40,
      height: 40,
    })),
    createImageData: vi.fn((w, h) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    fillStyle: '',
    globalAlpha: 1,
  };
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 100;
  canvas.getContext = vi.fn(() => ctx);
  canvas.getBoundingClientRect = vi.fn(() => ({ width: 200, height: 100 }));
  return { canvas, ctx };
}

// Create a small mask image (10x10) with a horizontal line of dark pixels
function createMaskBlob() {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    const ctx = c.getContext('2d');
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 10, 10);
    // Dark horizontal line at y=5
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 5, 10, 1);
    c.toBlob((blob) => resolve(URL.createObjectURL(blob)));
  });
}

// Mock Image with controllable load
function mockImageClass() {
  const instances = [];
  class MockImage {
    constructor() {
      this.naturalWidth = 10;
      this.naturalHeight = 10;
      this.width = 10;
      this.height = 10;
      this.crossOrigin = '';
      instances.push(this);
    }
    set src(_val) {
      // Auto-trigger onload on next microtask
      Promise.resolve().then(() => {
        if (this.onload) this.onload();
      });
    }
  }
  return { MockImage, instances };
}

// Mock document.createElement to return a canvas with walkable pixel data
// when shimmer tries to build its walk map
const originalCreateElement = document.createElement.bind(document);

function createMock2dContext() {
  return {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn((x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          if (py === 5) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 255;
          } else {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
          }
        }
      }
      return { data, width: w, height: h };
    }),
    createImageData: vi.fn((w, h) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    fillStyle: '',
    globalAlpha: 1,
  };
}

function setupCanvasCreateMock() {
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') {
      const c = originalCreateElement('canvas');
      c.getContext = vi.fn(() => createMock2dContext());
      return c;
    }
    return originalCreateElement(tag);
  });
}

describe('shimmer.js', () => {
  let mockCanvas;
  let mockCtx;
  let rafCallbacks;
  let resizeCallbacks;
  const { MockImage } = mockImageClass();

  beforeEach(async () => {
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('devicePixelRatio', 1);

    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb) { resizeCallbacks.push(cb); }
      observe = vi.fn();
      disconnect = vi.fn();
    });

    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
    })));

    setupCanvasCreateMock();

    ({ canvas: mockCanvas, ctx: mockCtx } = createMockCanvas());

    // Fresh import each test
    shimmer = await import('../../src/shimmer.js');
  });

  afterEach(() => {
    shimmer.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe('init', () => {
    it('acquires context and sets up ResizeObserver', () => {
      shimmer.init(mockCanvas);
      expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
      expect(resizeCallbacks.length).toBeGreaterThan(0);
    });
  });

  describe('loadScene', () => {
    it('clears canvas when config is null', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene(null);
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });

    it('loads mask and starts rAF loop', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      expect(requestAnimationFrame).toHaveBeenCalled();
    });

    it('accepts custom warm color', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, color: [220, 110, 50] });
      expect(requestAnimationFrame).toHaveBeenCalled();
    });

    it('accepts custom dotCount', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 8 });
      expect(requestAnimationFrame).toHaveBeenCalled();
    });

    it('cancels previous rAF on new loadScene', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      await shimmer.loadScene({ mask: 'test2.png', opacity: 0.3 });
      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('does not start rAF when paused', async () => {
      shimmer.init(mockCanvas);
      shimmer.pause();
      vi.mocked(requestAnimationFrame).mockClear();
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    });
  });

  describe('pause / resume', () => {
    it('cancels rAF on pause', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      shimmer.pause();
      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('restarts rAF on resume after pause', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      shimmer.pause();
      vi.mocked(requestAnimationFrame).mockClear();
      shimmer.resume();
      expect(requestAnimationFrame).toHaveBeenCalled();
    });

    it('resume is a no-op when no data loaded', () => {
      shimmer.init(mockCanvas);
      shimmer.resume();
      // No rAF should be requested without walkMap data
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('cancels rAF and disconnects observer', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      shimmer.destroy();
      expect(cancelAnimationFrame).toHaveBeenCalled();
    });

    it('is safe to call multiple times', () => {
      shimmer.init(mockCanvas);
      shimmer.destroy();
      shimmer.destroy(); // should not throw
    });
  });

  describe('render loop', () => {
    it('tick calls render and requests next frame', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });

      // Execute one tick
      if (rafCallbacks.length > 0) {
        const tick = rafCallbacks[rafCallbacks.length - 1];
        tick(1000);
      }
      // Should have requested another frame
      expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    it('tick is a no-op when paused', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      shimmer.pause();

      const callCount = requestAnimationFrame.mock.calls.length;
      // Try to manually run a tick
      if (rafCallbacks.length > 0) {
        const tick = rafCallbacks[rafCallbacks.length - 1];
        tick(1000);
      }
      // Should NOT have requested another frame
      expect(requestAnimationFrame).toHaveBeenCalledTimes(callCount);
    });
  });

  describe('reduced motion', () => {
    it('respects prefers-reduced-motion', async () => {
      vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
      })));
      vi.resetModules();
      shimmer = await import('../../src/shimmer.js');
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });

      // Dots should exist but tick should not step them
      if (rafCallbacks.length > 0) {
        const tick = rafCallbacks[rafCallbacks.length - 1];
        tick(1000);
      }
      // Test passes if no error — reduced motion skips stepDot
    });
  });

  describe('config validation', () => {
    it('rejects config without opacity', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png' }),
      ).rejects.toThrow('opacity is required');
    });

    it('rejects config without mask', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ opacity: 0.5 }),
      ).rejects.toThrow('mask is required');
    });

    it('rejects opacity outside 0–1 range', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 1.5 }),
      ).rejects.toThrow('opacity must be a number 0–1');
    });

    it('rejects negative opacity', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: -0.1 }),
      ).rejects.toThrow('opacity must be a number 0–1');
    });

    it('rejects cool-toned color', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 0.5, color: [50, 100, 200] }),
      ).rejects.toThrow('warm-toned');
    });

    it('rejects white color', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 0.5, color: [255, 255, 255] }),
      ).rejects.toThrow('warm-toned');
    });

    it('rejects malformed color array', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 0.5, color: [255, 128] }),
      ).rejects.toThrow('color must be [r, g, b]');
    });

    it('rejects non-integer dotCount', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 2.5 }),
      ).rejects.toThrow('dotCount must be a non-negative integer');
    });

    it('rejects negative dotCount', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: -1 }),
      ).rejects.toThrow('dotCount must be a non-negative integer');
    });
  });

  describe('generation guard', () => {
    it('stale load is discarded when newer loadScene is called', async () => {
      // Use a controllable Image mock that doesn't auto-resolve
      let resolveFirst;
      let resolveSecond;
      let callCount = 0;

      const DelayedImage = class {
        constructor() {
          this.naturalWidth = 10;
          this.naturalHeight = 10;
          this.width = 10;
          this.height = 10;
          this.crossOrigin = '';
        }
        set src(_val) {
          callCount++;
          const current = callCount;
          if (current === 1) {
            resolveFirst = () => Promise.resolve().then(() => this.onload?.());
          } else {
            resolveSecond = () => Promise.resolve().then(() => this.onload?.());
          }
        }
      };
      vi.stubGlobal('Image', DelayedImage);

      shimmer.init(mockCanvas);

      // Start first load (will not auto-resolve)
      const first = shimmer.loadScene({ mask: 'first.png', opacity: 0.3 });
      // Start second load before first resolves
      const second = shimmer.loadScene({ mask: 'second.png', opacity: 0.7 });

      // Resolve first load — it should be discarded (stale generation)
      await resolveFirst();
      // Resolve second load — this should apply
      await resolveSecond();

      await Promise.allSettled([first, second]);

      // rAF should only have been called once (from the second load)
      // The first load's post-await code was skipped by the generation guard
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('handles zero-dimension canvas gracefully', () => {
      mockCanvas.getBoundingClientRect = vi.fn(() => ({ width: 0, height: 0 }));
      shimmer.init(mockCanvas);
    });

    it('handles mask load failure', async () => {
      const FailImage = class {
        constructor() {
          this.crossOrigin = '';
        }
        set src(_val) {
          Promise.resolve().then(() => {
            if (this.onerror) this.onerror(new Error('fail'));
          });
        }
      };
      vi.stubGlobal('Image', FailImage);

      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'bad.png', opacity: 0.5 }),
      ).rejects.toThrow('Failed to load mask');
    });
  });
});
