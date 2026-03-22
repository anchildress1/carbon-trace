import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock PixiJS
const mockTicker = {
  add: vi.fn(),
  stop: vi.fn(),
  start: vi.fn(),
  started: false,
};

const mockRenderer = {
  resize: vi.fn(),
};

const mockStage = {
  children: [],
  addChild: vi.fn(function (child) {
    this.children.push(child);
  }),
  removeChild: vi.fn(function (child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
  }),
};

const mockPixiApp = {
  ticker: mockTicker,
  renderer: mockRenderer,
  stage: mockStage,
  screen: { width: 1920, height: 1080 },
  init: vi.fn(),
  destroy: vi.fn(),
};

vi.mock('pixi.js', () => ({
  Application: vi.fn(function () {
    Object.assign(this, {
      ...mockPixiApp,
      stage: { ...mockStage, children: [] },
    });
    this.init = vi.fn();
    this.destroy = vi.fn();
    this.ticker = { ...mockTicker };
    this.renderer = { ...mockRenderer };
    this.screen = { width: 1920, height: 1080 };
  }),
  Container: vi.fn(function () {
    this.children = [];
    this.addChild = vi.fn(function (child) { this.children.push(child); });
    this.setMask = vi.fn();
    this.destroy = vi.fn();
    this.mask = null;
  }),
  Sprite: vi.fn(function (texture) {
    this.texture = texture;
    this.width = 0;
    this.height = 0;
    this.filters = [];
    this.mask = null;
    this.destroy = vi.fn();
    this.setMask = vi.fn();
    this.x = 0;
    this.y = 0;
    this.scale = { set: vi.fn() };
  }),
  Texture: {
    from: vi.fn((img) => ({ _source: img, source: { style: {} } })),
  },
}));

vi.mock('../../src/effects.js', () => ({
  createEffect: vi.fn(() => ({
    filter: { enabled: true },
    update: vi.fn(),
  })),
  noiseFreeTypes: new Set(['glow', 'shockwave']),
}));

import {
  init,
  loadScene,
  clearAll,
  pause,
  resume,
  destroy,
  isRunning,
} from '../../src/effects-canvas.js';

function createMockCanvas() {
  const canvas = document.createElement('canvas');
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
  Object.defineProperty(canvas, 'clientWidth', { value: 1920 });
  Object.defineProperty(canvas, 'clientHeight', { value: 1080 });

  // parentElement is read-only in happy-dom; attach canvas to a container
  const container = document.createElement('div');
  container.appendChild(canvas);

  return canvas;
}

describe('effects-canvas.js — PixiJS lifecycle', () => {
  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });

    // Mock Image for loadTexture — fire onload synchronously when src is set.
    // In loadTexture, the order is: new Image() → set onload → set src,
    // so onload is available by the time the setter fires.
    globalThis.Image = vi.fn(function () {
      const self = this;
      Object.defineProperty(this, 'src', {
        set() {
          self.onload?.();
        },
      });
    });
  });

  afterEach(() => {
    destroy();
    vi.restoreAllMocks();
  });

  describe('init', () => {
    it('throws when given a non-canvas element', async () => {
      const div = document.createElement('div');
      await expect(init(div)).rejects.toThrow('init requires a <canvas> element');
    });

    it('throws when given null', async () => {
      await expect(init(null)).rejects.toThrow('init requires a <canvas> element');
    });

    it('creates a PixiJS Application on the canvas', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Application } = await import('pixi.js');
      expect(Application).toHaveBeenCalled();
    });

    it('creates a ResizeObserver on the canvas', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      expect(globalThis.ResizeObserver).toHaveBeenCalled();
      const observerInstance = globalThis.ResizeObserver.mock.results[0].value;
      expect(observerInstance.observe).toHaveBeenCalledWith(canvas);
    });

    it('sets webglAvailable to false if Application.init throws', async () => {
      const { Application } = await import('pixi.js');
      Application.mockImplementationOnce(function () {
        this.init = vi.fn().mockRejectedValue(new Error('WebGL not supported'));
        this.ticker = mockTicker;
        this.destroy = vi.fn();
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const canvas = createMockCanvas();
      await init(canvas);

      expect(warnSpy).toHaveBeenCalledWith(
        'WebGL unavailable — effects disabled:',
        expect.any(String),
      );
      warnSpy.mockRestore();
    });
  });

  describe('pause / resume', () => {
    it('isRunning returns false before init', () => {
      expect(isRunning()).toBe(false);
    });

    it('pause does not throw before init', () => {
      expect(() => pause()).not.toThrow();
    });

    it('resume does not throw before init', () => {
      expect(() => resume()).not.toThrow();
    });

    it('resume does not start when prefers-reduced-motion is active', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      globalThis.matchMedia = vi.fn().mockReturnValue({ matches: true });
      resume();

      // Should not have called ticker.start
      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      expect(instance.ticker.start).not.toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('does not throw before init', () => {
      expect(() => clearAll()).not.toThrow();
    });

    it('stops the ticker', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      clearAll();

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      expect(instance.ticker.stop).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('is safe to call before init', () => {
      expect(() => destroy()).not.toThrow();
    });

    it('disconnects the ResizeObserver', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const observerInstance = globalThis.ResizeObserver.mock.results[0].value;
      destroy();

      expect(observerInstance.disconnect).toHaveBeenCalled();
    });

    it('is safe to call twice', async () => {
      const canvas = createMockCanvas();
      await init(canvas);
      destroy();
      expect(() => destroy()).not.toThrow();
    });
  });

  describe('loadScene', () => {
    it('does not throw when webgl is unavailable', async () => {
      const { Application } = await import('pixi.js');
      Application.mockImplementationOnce(function () {
        this.init = vi.fn().mockRejectedValue(new Error('fail'));
        this.ticker = mockTicker;
        this.destroy = vi.fn();
      });

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const canvas = createMockCanvas();
      await init(canvas);

      await expect(
        loadScene({ regions: [{ type: 'water', mask: 'test.png' }] }, 'scene.png'),
      ).resolves.not.toThrow();
    });

    it('returns immediately when not initialized', async () => {
      // loadScene on a destroyed/uninitialized module should be a no-op
      await expect(
        loadScene({ regions: [] }, 'scene.webp'),
      ).resolves.not.toThrow();
    });
  });

  describe('pause / resume with active effects', () => {
    it('pause stops the ticker after init', async () => {
      const canvas = createMockCanvas();
      await init(canvas);
      pause();

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      expect(instance.ticker.stop).toHaveBeenCalled();
    });

    it('resume does not start ticker when no active effects', async () => {
      const canvas = createMockCanvas();
      await init(canvas);
      resume();

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      expect(instance.ticker.start).not.toHaveBeenCalled();
    });
  });

  describe('context loss', () => {
    it('handles webglcontextlost event', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const event = new Event('webglcontextlost');
      event.preventDefault = vi.fn();
      canvas.dispatchEvent(event);

      expect(warnSpy).toHaveBeenCalledWith('WebGL context lost — effects paused');
      warnSpy.mockRestore();
    });

    it('handles webglcontextrestored event', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      canvas.dispatchEvent(new Event('webglcontextrestored'));

      expect(warnSpy).toHaveBeenCalledWith('WebGL context restored');
      warnSpy.mockRestore();
    });
  });

  describe('destroy with app', () => {
    it('calls app.destroy', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      destroy();

      expect(instance.destroy).toHaveBeenCalled();
    });

    it('removes context loss listeners', async () => {
      const canvas = createMockCanvas();
      const removeSpy = vi.spyOn(canvas, 'removeEventListener');
      await init(canvas);
      destroy();

      expect(removeSpy).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function));
    });
  });
});
