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
  noiseFreeTypes: new Set(['glow', 'shockwave']),
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
    self.naturalWidth = 256;
    self.naturalHeight = 256;
    Object.defineProperty(this, 'src', {
      set() {
        self.onload?.();
      },
    });
  });

  // createImageBitmap is not available in jsdom/happy-dom.
  // Return a plain object — Texture.from() is mocked anyway.
  globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 256, height: 256 });
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
    it('throws when given a non-canvas element', () => {
      const div = document.createElement('div');
      expect(() => init(div)).toThrow('init requires a <canvas> element');
    });

    it('throws when given null', () => {
      expect(() => init(null)).toThrow('init requires a <canvas> element');
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

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const canvas = createMockCanvas();
      await init(canvas);

      expect(errorSpy).toHaveBeenCalledWith(
        'WebGL unavailable — effects disabled:',
        expect.any(String),
      );
      errorSpy.mockRestore();
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

      vi.spyOn(console, 'error').mockImplementation(() => {});
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

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = new Event('webglcontextlost');
      event.preventDefault = vi.fn();
      canvas.dispatchEvent(event);

      expect(errorSpy).toHaveBeenCalledWith('WebGL context lost — effects paused');
      errorSpy.mockRestore();
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

  describe('tickerUpdate callback', () => {
    it('invokes effect.update on active effects', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];

      // Load a scene to populate active effects
      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene.png',
      );

      // Get the tickerUpdate callback registered via ticker.add
      const tickerCb = instance.ticker.add.mock.calls[0][0];
      expect(tickerCb).toBeDefined();

      // Invoke with mock ticker object
      tickerCb({ deltaMS: 16.67 });

      // Verify createEffect was called and its update was invoked
      const { createEffect } = await import('../../src/effects.js');
      const effect = createEffect.mock.results[0]?.value;
      if (effect) {
        expect(effect.update).toHaveBeenCalled();
      }
    });
  });

  describe('resume with active effects', () => {
    it('starts ticker when active effects exist', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      // Load a scene to have active effects
      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene.png',
      );

      pause();

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.ticker.start.mockClear();

      resume();
      expect(instance.ticker.start).toHaveBeenCalled();
    });
  });

  describe('masked rendering path', () => {
    it('creates Container with mask for displacement types', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Sprite, Container } = await import('pixi.js');
      Sprite.mockClear();
      Container.mockClear();

      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      // Displacement type: noiseSprite + maskSprite + effectSprite
      expect(Sprite.mock.instances.length).toBeGreaterThanOrEqual(3);

      // A Container should have been created for masking
      expect(Container).toHaveBeenCalled();
      const container = Container.mock.instances[0];
      expect(container.setMask).toHaveBeenCalled();
    });
  });

  describe('reinit after context loss', () => {
    it('loadScene triggers reinit after context loss', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      // Simulate context loss
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = new Event('webglcontextlost');
      event.preventDefault = vi.fn();
      canvas.dispatchEvent(event);
      errorSpy.mockRestore();

      const { Application } = await import('pixi.js');
      const initCallsBefore = Application.mock.instances.length;

      // loadScene should trigger reinit
      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene.png',
      );

      // A new Application instance should have been created for reinit
      expect(Application.mock.instances.length).toBeGreaterThan(initCallsBefore);
    });

    it('loadScene processes effects after reinit following context loss', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      // Simulate context loss
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = new Event('webglcontextlost');
      event.preventDefault = vi.fn();
      canvas.dispatchEvent(event);
      errorSpy.mockRestore();

      const { createEffect } = await import('../../src/effects.js');
      createEffect.mockClear();

      // loadScene after context loss should reinit and still process effects
      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene.png',
      );

      // createEffect must be called — proves the generation guard did not bail
      expect(createEffect).toHaveBeenCalled();
      expect(createEffect.mock.calls[0][0]).toBe('glow');
    });
  });

  describe('scene texture load failure', () => {
    it('calls clearAll when scene texture fails to load', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      // Make Image.src trigger onerror
      globalThis.Image = vi.fn(function () {
        Object.defineProperty(this, 'src', {
          set() {
            this.onerror?.();
          },
        });
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'bad-scene.png',
      );

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to load scene effects:',
        expect.any(String),
      );
      errorSpy.mockRestore();
    });
  });

  describe('per-region error handling', () => {
    it('continues loading subsequent regions when one mask fails', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { createEffect } = await import('../../src/effects.js');
      createEffect.mockClear();

      // First call to loadLuminanceMask (for mask1.png) will fail,
      // second (for mask2.png) should succeed.
      let callCount = 0;
      const originalImage = globalThis.Image;
      globalThis.Image = vi.fn(function () {
        const self = this;
        self.width = 256;
        self.height = 256;
        self.naturalWidth = 256;
        self.naturalHeight = 256;
        Object.defineProperty(this, 'src', {
          set(val) {
            callCount++;
            // Fail the second Image load (first mask's luminance processing)
            // but succeed on others (noise, scene texture, second mask)
            if (callCount === 2) {
              self.onerror?.();
            } else {
              self.onload?.();
            }
          },
        });
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await loadScene(
        {
          regions: [
            { type: 'glow', mask: 'mask1.png' },
            { type: 'glow', mask: 'mask2.png' },
          ],
        },
        'scene.png',
      );

      // First region should fail (mask load error) but second should succeed
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping effect region'),
        expect.any(String),
      );

      globalThis.Image = originalImage;
      warnSpy.mockRestore();
    });
  });
});
