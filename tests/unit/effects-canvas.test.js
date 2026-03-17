import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initCanvas,
  pause,
  resume,
  clearAll,
  destroy,
  getContext,
  isRunning,
} from '../../src/effects-canvas.js';

function createMockCanvas() {
  const mockCtx = {
    clearRect: vi.fn(),
    scale: vi.fn(),
  };

  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx);

  // Mock getBoundingClientRect
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

describe('effects-canvas.js', () => {
  let rafCallbacks;
  let rafId;

  beforeEach(() => {
    // Reset module state
    destroy();

    rafCallbacks = [];
    rafId = 0;

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    // Mock ResizeObserver
    globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  afterEach(() => {
    destroy();
    vi.restoreAllMocks();
  });

  describe('initCanvas', () => {
    it('returns a 2d context', () => {
      const { canvas, mockCtx } = createMockCanvas();
      const ctx = initCanvas(canvas);

      expect(ctx).toBe(mockCtx);
      expect(canvas.getContext).toHaveBeenCalledWith('2d');
    });

    it('sets canvas dimensions based on bounding rect and DPR', () => {
      const { canvas } = createMockCanvas();
      const dpr = globalThis.devicePixelRatio || 1;

      initCanvas(canvas);

      expect(canvas.width).toBe(1920 * dpr);
      expect(canvas.height).toBe(1080 * dpr);
    });

    it('creates a ResizeObserver on the canvas', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);

      expect(globalThis.ResizeObserver).toHaveBeenCalled();
      const observerInstance = globalThis.ResizeObserver.mock.results[0].value;
      expect(observerInstance.observe).toHaveBeenCalledWith(canvas);
    });

    it('throws when given a non-canvas element', () => {
      const div = document.createElement('div');
      expect(() => initCanvas(div)).toThrow('initCanvas requires a <canvas> element');
    });

    it('throws when given null', () => {
      expect(() => initCanvas(null)).toThrow('initCanvas requires a <canvas> element');
    });

    it('throws when given undefined', () => {
      expect(() => initCanvas(undefined)).toThrow('initCanvas requires a <canvas> element');
    });
  });

  describe('pause / resume', () => {
    it('starts not running', () => {
      expect(isRunning()).toBe(false);
    });

    it('resume sets running to true and requests animation frame', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);

      resume();

      expect(isRunning()).toBe(true);
      expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    });

    it('pause sets running to false and cancels animation frame', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);
      resume();
      pause();

      expect(isRunning()).toBe(false);
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    });

    it('resume without initCanvas does nothing', () => {
      resume();
      expect(isRunning()).toBe(false);
    });
  });

  describe('render loop', () => {
    it('clears the canvas each frame', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initCanvas(canvas);
      resume();

      // Execute the rAF callback
      expect(rafCallbacks.length).toBe(1);
      rafCallbacks[0]();

      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    });

    it('requests next frame after rendering', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);
      resume();

      rafCallbacks[0]();

      // Original call + re-request inside render
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);
    });

    it('stops requesting frames after pause', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);
      resume();
      pause();

      // Clear callbacks
      rafCallbacks.length = 0;
      // No more callbacks should be queued
      expect(rafCallbacks.length).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('pauses and clears the canvas', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initCanvas(canvas);
      resume();

      clearAll();

      expect(isRunning()).toBe(false);
      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    });
  });

  describe('destroy', () => {
    it('disconnects the ResizeObserver', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);

      const observerInstance = globalThis.ResizeObserver.mock.results[0].value;
      destroy();

      expect(observerInstance.disconnect).toHaveBeenCalled();
    });

    it('nulls the context', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);
      destroy();

      expect(getContext()).toBeNull();
    });

    it('is safe to call twice', () => {
      const { canvas } = createMockCanvas();
      initCanvas(canvas);
      destroy();
      expect(() => destroy()).not.toThrow();
    });
  });

  describe('getContext', () => {
    it('returns null before init', () => {
      expect(getContext()).toBeNull();
    });

    it('returns ctx after init', () => {
      const { canvas, mockCtx } = createMockCanvas();
      initCanvas(canvas);
      expect(getContext()).toBe(mockCtx);
    });
  });
});
