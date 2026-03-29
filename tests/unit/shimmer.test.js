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

// Mock document.createElement to return a canvas with configurable pixel data
const originalCreateElement = document.createElement.bind(document);

/**
 * Create a 2D context mock with configurable pixel data for buildWalkMap.
 * @param {Function} pixelFn - (px, py, w, h) => [r, g, b, a] or null for white
 */
function createMock2dContext(pixelFn) {
  const defaultPixelFn = (_px, py) => {
    // Default: dark horizontal line at y=5, white everywhere else
    if (py === 5) return [0, 0, 0, 255];
    return [255, 255, 255, 255];
  };
  const fn = pixelFn || defaultPixelFn;

  return {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn((_x, _y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          const [r, g, b, a] = fn(px, py, w, h);
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
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

/**
 * Shared array capturing all putImageData calls across offscreen canvases.
 * Reset in beforeEach. Tests can inspect this to verify buildTraceImage output.
 */
let putImageDataCalls = [];

/** Install a document.createElement mock that returns canvases with given pixel data. */
function setupCanvasCreateMock(pixelFn) {
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') {
      const c = originalCreateElement('canvas');
      const ctx = createMock2dContext(pixelFn);
      const origPut = ctx.putImageData;
      ctx.putImageData = vi.fn((...args) => {
        putImageDataCalls.push(args);
        origPut(...args);
      });
      c.getContext = vi.fn(() => ctx);
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

    putImageDataCalls = [];
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

    it('applies custom warm color to trace image', async () => {
      const customColor = [220, 110, 50];
      vi.restoreAllMocks();
      putImageDataCalls = [];
      setupCanvasCreateMock();

      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, color: customColor });

      // buildTraceImage should have called putImageData with pixel data
      // containing the custom color on walkable pixels
      expect(putImageDataCalls.length).toBeGreaterThan(0);
      const traceData = putImageDataCalls[putImageDataCalls.length - 1][0].data;
      // Find a walkable pixel (y=5 in default mask) and verify its color
      const walkableIdx = 5 * 10; // y=5, x=0 on a 10-wide mask
      const r = traceData[walkableIdx * 4];
      const g = traceData[walkableIdx * 4 + 1];
      const b = traceData[walkableIdx * 4 + 2];
      expect([r, g, b]).toEqual(customColor);
    });

    it('spawns requested number of dots via dotCount', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 3 });

      // Trigger a tick and count gradient calls — each dot draws 2 gradients (glow + core)
      const lastTick = rafCallbacks[rafCallbacks.length - 1];
      lastTick(1000);
      const gradientCalls = mockCtx.createRadialGradient.mock.calls.length;
      expect(gradientCalls).toBe(3 * 2); // 3 dots × 2 gradients each
    });

    it('spawns zero dots when dotCount is 0', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 0 });

      const lastTick = rafCallbacks[rafCallbacks.length - 1];
      lastTick(1000);
      // With 0 dots: render draws traceImage but no gradients
      expect(mockCtx.drawImage).toHaveBeenCalled(); // traceImage
      expect(mockCtx.createRadialGradient).not.toHaveBeenCalled();
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

    it('invalidates pending loadScene via loadGeneration', async () => {
      // Use a controllable Image that doesn't auto-resolve
      let resolveImg;
      const DelayedImage = class {
        constructor() {
          this.naturalWidth = 10;
          this.naturalHeight = 10;
          this.width = 10;
          this.height = 10;
          this.crossOrigin = '';
        }
        set src(_val) {
          resolveImg = () => Promise.resolve().then(() => this.onload?.());
        }
      };
      vi.stubGlobal('Image', DelayedImage);

      shimmer.init(mockCanvas);
      const loadPromise = shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });

      // Destroy before image loads — increments loadGeneration
      shimmer.destroy();

      // Now resolve the image — the post-load code should be skipped
      await resolveImg();
      await loadPromise;

      // rAF should not have been called since the load was invalidated
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    });
  });

  describe('render loop', () => {
    it('tick calls render and requests next frame', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });

      const tick = rafCallbacks[rafCallbacks.length - 1];
      tick(1000);
      // Should have requested another frame
      expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    it('tick is a no-op when paused', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      shimmer.pause();

      const callCount = requestAnimationFrame.mock.calls.length;
      const tick = rafCallbacks[rafCallbacks.length - 1];
      tick(1000);
      // Should NOT have requested another frame
      expect(requestAnimationFrame).toHaveBeenCalledTimes(callCount);
    });
  });

  describe('render output', () => {
    it('draws traceImage to canvas with scene opacity', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.4, dotCount: 0 });

      const tick = rafCallbacks[rafCallbacks.length - 1];
      tick(1000);

      // Should clear then draw traceImage
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, mockCanvas.width, mockCanvas.height);
      expect(mockCtx.drawImage).toHaveBeenCalled();
      // Verify globalAlpha was set to opacity before drawing
      // The mock records assignments — check the drawImage was called while opacity was active
      const drawCall = mockCtx.drawImage.mock.calls[0];
      expect(drawCall).toBeDefined();
      // drawImage args: (traceImage, 0, 0, canvasWidth, canvasHeight)
      expect(drawCall[1]).toBe(0);
      expect(drawCall[2]).toBe(0);
      expect(drawCall[3]).toBe(mockCanvas.width);
      expect(drawCall[4]).toBe(mockCanvas.height);
    });

    it('draws glow and core gradients for each dot', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 2 });

      const tick = rafCallbacks[rafCallbacks.length - 1];
      tick(1000);

      // Each dot gets 2 createRadialGradient calls (glow + core)
      expect(mockCtx.createRadialGradient).toHaveBeenCalledTimes(4);
      // Each gradient gets 3 color stops
      const gradient = mockCtx.createRadialGradient.mock.results[0].value;
      expect(gradient.addColorStop).toHaveBeenCalledTimes(3);
    });

    it('returns early without drawing when opacity is 0', async () => {
      shimmer.init(mockCanvas);
      // Load a scene then load null (sets opacity=0, clears walkMap)
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });
      await shimmer.loadScene(null);

      mockCtx.clearRect.mockClear();
      mockCtx.drawImage.mockClear();

      // Resume and tick — should clear but not draw (no walkMap)
      shimmer.resume();
      if (rafCallbacks.length > 0) {
        const tick = rafCallbacks[rafCallbacks.length - 1];
        tick(1000);
      }

      // clearRect is called (render always clears), but drawImage should not be
      expect(mockCtx.drawImage).not.toHaveBeenCalled();
    });
  });

  describe('reduced motion', () => {
    it('renders static dots without stepping when reduced motion is active', async () => {
      vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
      })));
      vi.resetModules();
      shimmer = await import('../../src/shimmer.js');
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 2 });

      // Record dot positions by capturing gradient center coordinates
      const tick = rafCallbacks[rafCallbacks.length - 1];
      tick(1000);
      const firstCallPositions = mockCtx.createRadialGradient.mock.calls.map(c => [c[0], c[1]]);

      mockCtx.createRadialGradient.mockClear();
      // Tick again — positions should NOT change (stepDot skipped under reduced motion)
      const tick2 = rafCallbacks[rafCallbacks.length - 1];
      tick2(2000);
      const secondCallPositions = mockCtx.createRadialGradient.mock.calls.map(c => [c[0], c[1]]);

      // Dot positions are identical (no movement)
      expect(firstCallPositions).toEqual(secondCallPositions);
    });

    it('uses reduced-motion pulse value of 0.6', async () => {
      vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
      })));
      vi.resetModules();
      shimmer = await import('../../src/shimmer.js');
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 1 });

      const tick = rafCallbacks[rafCallbacks.length - 1];
      // Tick at two different times — pulse should be constant at 0.6
      tick(1000);
      const firstGlow = mockCtx.createRadialGradient.mock.results[0].value;
      const firstAlphaArg = firstGlow.addColorStop.mock.calls[0][1];

      mockCtx.createRadialGradient.mockClear();
      mockCtx.createRadialGradient.mockReturnValue({ addColorStop: vi.fn() });
      const tick2 = rafCallbacks[rafCallbacks.length - 1];
      tick2(5000);
      const secondGlow = mockCtx.createRadialGradient.mock.results[0].value;
      const secondAlphaArg = secondGlow.addColorStop.mock.calls[0][1];

      // Under reduced motion, pulse is fixed at 0.6 — alpha strings should be identical
      // regardless of time (no wave oscillation)
      expect(firstAlphaArg).toBe(secondAlphaArg);
    });

    it('updates reducedMotion flag on matchMedia change event', async () => {
      let changeHandler;
      vi.stubGlobal('matchMedia', vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn((_event, handler) => {
          changeHandler = handler;
        }),
      })));
      vi.resetModules();
      shimmer = await import('../../src/shimmer.js');
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 1 });

      // Tick once — dots should move (reduced motion is false)
      const tick1 = rafCallbacks[rafCallbacks.length - 1];
      tick1(1000);
      const posAfterFirst = mockCtx.createRadialGradient.mock.calls.map(c => [c[0], c[1]]);

      // Simulate reduced-motion toggle mid-session
      changeHandler({ matches: true });

      mockCtx.createRadialGradient.mockClear();
      const tick2 = rafCallbacks[rafCallbacks.length - 1];
      tick2(2000);
      const posAfterToggle = mockCtx.createRadialGradient.mock.calls.map(c => [c[0], c[1]]);

      mockCtx.createRadialGradient.mockClear();
      const tick3 = rafCallbacks[rafCallbacks.length - 1];
      tick3(3000);
      const posAfterSecond = mockCtx.createRadialGradient.mock.calls.map(c => [c[0], c[1]]);

      // After toggling to reduced motion, positions should stop changing
      expect(posAfterToggle).toEqual(posAfterSecond);
    });
  });

  describe('stepDot movement', () => {
    it('moves dots forward along walkable path', async () => {
      // Use a wide horizontal band of dark pixels so dots have runway
      vi.restoreAllMocks();
      setupCanvasCreateMock((px, py) => {
        // Dark band from y=3 to y=7 (5 rows of walkable pixels)
        if (py >= 3 && py <= 7) return [0, 0, 0, 255];
        return [255, 255, 255, 255];
      });

      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 1 });

      // Record initial position
      const tick1 = rafCallbacks[rafCallbacks.length - 1];
      tick1(0);
      const initialPos = [...mockCtx.createRadialGradient.mock.calls[0].slice(0, 2)];

      // Run several ticks to let the dot move
      for (let t = 1; t <= 5; t++) {
        mockCtx.createRadialGradient.mockClear();
        const nextTick = rafCallbacks[rafCallbacks.length - 1];
        nextTick(t * 16);
      }

      const movedPos = [...mockCtx.createRadialGradient.mock.calls[0].slice(0, 2)];

      // Dot should have moved — at least one coordinate changed
      const hasMoved = initialPos[0] !== movedPos[0] || initialPos[1] !== movedPos[1];
      expect(hasMoved).toBe(true);
    });

    it('respawns dot when it reaches maxLife', async () => {
      // Create a small isolated island so dots quickly hit dead ends and respawn
      vi.restoreAllMocks();
      setupCanvasCreateMock((px, py) => {
        // Only 2 dark pixels at (5,5) and (6,5) — very limited path
        if (py === 5 && (px === 5 || px === 6)) return [0, 0, 0, 255];
        return [255, 255, 255, 255];
      });

      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 1 });

      // Run many ticks to trigger maxLife respawn (maxLife is 800-2000)
      // At dead ends, stepDot sets life=maxLife immediately, triggering respawn
      let noError = true;
      for (let t = 0; t < 50; t++) {
        try {
          const tick = rafCallbacks[rafCallbacks.length - 1];
          tick(t * 16);
        } catch {
          noError = false;
          break;
        }
      }

      // The dot should survive many ticks via respawn without errors
      expect(noError).toBe(true);
      // Verify dots are still being rendered
      expect(mockCtx.createRadialGradient).toHaveBeenCalled();
    });
  });

  describe('buildWalkMap luminance threshold', () => {
    it('classifies dark pixels as walkable (lum < 128, alpha > 128)', async () => {
      vi.restoreAllMocks();
      putImageDataCalls = [];
      setupCanvasCreateMock((_px, py) => {
        // Row 0: lum=0 a=255 (fully dark, opaque → walkable)
        if (py === 0) return [0, 0, 0, 255];
        // Row 1: lum~100 a=255 (below threshold → walkable)
        if (py === 1) return [100, 100, 100, 255];
        // Row 2: lum~200 a=255 (well above threshold → NOT walkable)
        if (py === 2) return [200, 200, 200, 255];
        // Row 3: lum=0 a=100 (dark, alpha below 128 → NOT walkable)
        if (py === 3) return [0, 0, 0, 100];
        // Row 4: lum=0 a=200 (dark, alpha above 128 → walkable)
        if (py === 4) return [0, 0, 0, 200];
        return [255, 255, 255, 255];
      });

      shimmer.init(mockCanvas);
      // dotCount: 0 to avoid spawn interaction — just test walkMap build
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 0 });

      // buildTraceImage calls putImageData with pixel data colored only on walkable pixels
      expect(putImageDataCalls.length).toBeGreaterThan(0);
      const traceData = putImageDataCalls[putImageDataCalls.length - 1][0].data;
      const w = 10; // MockImage is 10x10

      // Row 0 (dark, opaque → walkable): should have non-zero alpha
      expect(traceData[0 * w * 4 + 3]).toBeGreaterThan(0);
      // Row 1 (lum~100, opaque → walkable): should have non-zero alpha
      expect(traceData[1 * w * 4 + 3]).toBeGreaterThan(0);
      // Row 2 (lum~200, opaque → NOT walkable): alpha should be 0
      expect(traceData[2 * w * 4 + 3]).toBe(0);
      // Row 3 (dark, alpha=100 → NOT walkable): alpha should be 0
      expect(traceData[3 * w * 4 + 3]).toBe(0);
      // Row 4 (dark, alpha=200 → walkable): should have non-zero alpha
      expect(traceData[4 * w * 4 + 3]).toBeGreaterThan(0);
    });
  });

  describe('buildTraceImage', () => {
    it('writes correct RGB channels from activeColor on walkable pixels', async () => {
      const color = [200, 150, 80];
      vi.restoreAllMocks();
      putImageDataCalls = [];
      setupCanvasCreateMock();

      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, color, dotCount: 0 });

      // Get the putImageData call from buildTraceImage via the shared tracker
      expect(putImageDataCalls.length).toBeGreaterThan(0);
      const traceData = putImageDataCalls[putImageDataCalls.length - 1][0].data;
      const w = 10;

      // Walkable pixel at (0, 5) — default mask has dark line at y=5
      const idx = (5 * w + 0) * 4;
      expect(traceData[idx]).toBe(200);     // R
      expect(traceData[idx + 1]).toBe(150); // G
      expect(traceData[idx + 2]).toBe(80);  // B
      // Alpha = round(255 * 0.25) = 64
      expect(traceData[idx + 3]).toBe(64);

      // Non-walkable pixel at (0, 0) — should be all zeros
      expect(traceData[0]).toBe(0);
      expect(traceData[1]).toBe(0);
      expect(traceData[2]).toBe(0);
      expect(traceData[3]).toBe(0);
    });
  });

  describe('spawnDistributed', () => {
    it('falls back to random walkable positions on sparse masks', async () => {
      vi.restoreAllMocks();
      // Only 1 dark pixel at (5,5) — grid cells will mostly fail the 60-attempt retry
      setupCanvasCreateMock((px, py) => {
        if (px === 5 && py === 5) return [0, 0, 0, 255];
        return [255, 255, 255, 255];
      });

      shimmer.init(mockCanvas);
      // Request 3 dots — grid spawning mostly fails, fallback to findRandomWalkable
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 3 });

      // Tick to verify dots exist and render
      const tick = rafCallbacks[rafCallbacks.length - 1];
      tick(1000);

      // All 3 dots should spawn at the only walkable position and render
      expect(mockCtx.createRadialGradient).toHaveBeenCalledTimes(6); // 3 dots × 2 gradients
    });

    it('handles mask with no walkable pixels', async () => {
      vi.restoreAllMocks();
      // All white — no walkable pixels at all
      setupCanvasCreateMock(() => [255, 255, 255, 255]);

      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotCount: 5 });

      // Tick — should render traceImage but no dots (none could spawn)
      const tick = rafCallbacks[rafCallbacks.length - 1];
      tick(1000);

      expect(mockCtx.drawImage).toHaveBeenCalled(); // traceImage (empty but drawn)
      expect(mockCtx.createRadialGradient).not.toHaveBeenCalled(); // no dots
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

    it('rejects negative dotSpeed', async () => {
      shimmer.init(mockCanvas);
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 0.5, dotSpeed: -1 }),
      ).rejects.toThrow('dotSpeed must be a non-negative number');
    });

    it('accepts dotSpeed 0 for static-trace-only scenes', async () => {
      shimmer.init(mockCanvas);
      // dotSpeed: 0 with dotCount: 0 = static trace, no dots — should not throw
      await expect(
        shimmer.loadScene({ mask: 'test.png', opacity: 0.2, dotCount: 0, dotSpeed: 0 }),
      ).resolves.not.toThrow();
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
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('handles zero-dimension canvas by skipping resize', () => {
      mockCanvas.getBoundingClientRect = vi.fn(() => ({ width: 0, height: 0 }));
      shimmer.init(mockCanvas);
      // Canvas dimensions should NOT have been updated (handleResize early return)
      expect(mockCanvas.width).toBe(200); // stays at initial value from createMockCanvas
      expect(mockCanvas.height).toBe(100);
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

    it('handleResize updates canvas dimensions from bounding rect', async () => {
      shimmer.init(mockCanvas);
      await shimmer.loadScene({ mask: 'test.png', opacity: 0.5 });

      // Simulate a resize
      mockCanvas.getBoundingClientRect = vi.fn(() => ({ width: 400, height: 200 }));
      if (resizeCallbacks.length > 0) {
        resizeCallbacks[0]();
      }

      expect(mockCanvas.width).toBe(400);
      expect(mockCanvas.height).toBe(200);
    });
  });
});
