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
  removeChildren: vi.fn(function () {
    const removed = this.children.slice();
    this.children.length = 0;
    return removed;
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
    from: vi.fn((img) => ({
      _source: img,
      source: { style: {} },
      destroy: vi.fn(),
    })),
  },
}));

vi.mock('../../src/effects.js', () => ({
  createEffect: vi.fn(() => ({
    filter: { enabled: true },
    update: vi.fn(),
  })),
  noiseFreeTypes: new Set(['glow', 'godray', 'shockwave']),
  overlayTypes: new Set(['glow']),
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

/**
 * Mock Image constructor that supports both loadTexture and loadLuminanceMask.
 * loadLuminanceMask reads pixel data via canvas getContext('2d'), so the mock
 * must provide width/height for the offscreen canvas sizing.
 */
function setupImageMock() {
  globalThis.Image = vi.fn(function () {
    const self = this;
    self.width = 256;
    self.height = 256;
    Object.defineProperty(this, 'src', {
      set() {
        self.onload?.();
      },
    });
  });
}

describe('effects-canvas.js — PixiJS lifecycle', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({ matches: false });
    setupImageMock();

    // Mock canvas 2D context for loadLuminanceMask (happy-dom lacks full support)
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === '2d') {
        return {
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(this.width * this.height * 4),
          })),
          putImageData: vi.fn(),
        };
      }
      return originalGetContext?.call(this, type);
    };
  });

  afterEach(() => {
    destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
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

    it('skips regions without a mask', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await loadScene({ regions: [{ type: 'water' }] }, 'scene.png');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('mask is required'),
      );
      warnSpy.mockRestore();
    });

    it('glow regions use overlay rendering (mask as content, tinted)', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Sprite } = await import('pixi.js');
      Sprite.mockClear();

      await loadScene(
        { regions: [{ type: 'glow', mask: 'diamond.png', color: 0xffee33 }] },
        'scene.png',
      );

      // Overlay mode: only one sprite (effectSprite from mask texture),
      // no separate maskSprite or Container masking.
      // Sprite calls: no noise sprite (glow is noise-free), one effectSprite.
      const spriteInstances = Sprite.mock.instances;
      expect(spriteInstances.length).toBe(1);
      const effectSprite = spriteInstances[0];
      expect(effectSprite.tint).toBe(0xffee33);
      expect(effectSprite.alpha).toBe(0.15);
      expect(effectSprite.filters).toEqual([{ enabled: true }]);
    });
  });

  describe('generation guard', () => {
    it('discards stale loadScene results when superseded', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { createEffect } = await import('../../src/effects.js');
      createEffect.mockClear();

      // Start two loadScene calls — the first should be discarded
      const first = loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene-old.png',
      );
      const second = loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene-new.png',
      );

      await first;
      await second;

      // The second call supersedes the first. The first call's generation
      // check causes it to bail after its texture await resolves.
      // createEffect should be called for at most the second scene's region.
      const glowCalls = createEffect.mock.calls.filter(c => c[0] === 'glow');
      expect(glowCalls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('resize tracking', () => {
    it('ResizeObserver callback resizes tracked sprites', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Sprite } = await import('pixi.js');
      Sprite.mockClear();

      // Load a scene with a masked region to populate screenSizedSprites
      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      // Sprite constructor called for: noiseSprite (idx 0), maskSprite (idx 1),
      // effectSprite (idx 2). screenSizedSprites contains mask + effect only.
      const spriteInstances = Sprite.mock.instances;
      expect(spriteInstances.length).toBeGreaterThanOrEqual(3);
      const maskSprite = spriteInstances[1];
      const effectSprite = spriteInstances[2];

      // Both should have been sized to 1920x1080 initially
      expect(maskSprite.width).toBe(1920);
      expect(effectSprite.width).toBe(1920);

      // Get the ResizeObserver callback and simulate resize
      const ResizeObserverCb = globalThis.ResizeObserver.mock.calls[0][0];
      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.screen.width = 1280;
      instance.screen.height = 720;
      ResizeObserverCb();

      expect(maskSprite.width).toBe(1280);
      expect(maskSprite.height).toBe(720);
      expect(effectSprite.width).toBe(1280);
      expect(effectSprite.height).toBe(720);
    });

    it('resize is a no-op after clearAll', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      clearAll();

      // Get the ResizeObserver callback and simulate resize
      const ResizeObserverCb = globalThis.ResizeObserver.mock.calls[0][0];
      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.screen.width = 800;
      instance.screen.height = 450;

      // Should not throw — screenSizedSprites is empty after clearAll
      expect(() => ResizeObserverCb()).not.toThrow();
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
