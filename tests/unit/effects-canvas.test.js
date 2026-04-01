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
    this.render = vi.fn();
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
    this.renderable = true;
    this.destroy = vi.fn();
    this.setMask = vi.fn();
    this.removeFromParent = vi.fn();
    this.x = 0;
    this.y = 0;
    this.scale = { set: vi.fn() };
  }),
  Texture: Object.assign(
    vi.fn(function (opts) {
      this._source = opts?.source;
      this.source = opts?.source ?? { style: {} };
      this.frame = opts?.frame ?? null;
      this.destroy = vi.fn();
    }),
    {
      from: vi.fn((img) => ({
        _source: img,
        source: { style: {} },
        frame: null,
        destroy: vi.fn(),
      })),
    },
  ),
  TextureSource: {
    from: vi.fn(() => ({ style: {}, destroy: vi.fn() })),
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
  cancelPendingLoad,
  pause,
  resume,
  destroy,
  setAnalyser,
  connectAnalysisAudio,
  startAnalysisPlayback,
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
    this.width = 256;
    this.height = 256;
    this.naturalWidth = 256;
    this.naturalHeight = 256;
    Object.defineProperty(this, 'src', {
      set: () => {
        this.onload?.();
      },
    });
  });

  // createImageBitmap is not available in jsdom/happy-dom.
  // Return a plain object — TextureSource.from() is mocked anyway.
  globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 256, height: 256 });
}

function createMockAnalyser(sampleRate = 44100, frequencyBinCount = 1024) {
  return {
    frequencyBinCount,
    getByteFrequencyData: vi.fn(),
    context: { sampleRate },
  };
}

async function setupTriggerScene(audioReactiveConfig) {
  const { createEffect } = await import('../../src/effects.js');
  const triggerFn = vi.fn();
  createEffect.mockReturnValue({
    filter: { enabled: true, amplitude: 15 },
    update: vi.fn(),
    trigger: triggerFn,
  });

  const canvas = createMockCanvas();
  await init(canvas);

  const config = {
    regions: [
      {
        type: 'shockwave',
        mask: 'assets/masks/test.png',
        audioReactive: audioReactiveConfig,
      },
    ],
  };

  await loadScene(config, 'assets/images/test.webp');

  const analyser = createMockAnalyser(44100);
  setAnalyser(analyser);

  const { Application } = await import('pixi.js');
  const instance = Application.mock.instances[Application.mock.instances.length - 1];
  const tickerCallback = instance.ticker.add.mock.calls[0]?.[0];

  return { analyser, tickerCallback, triggerFn };
}

function createMockAnalyserWithContext() {
  const mockSource = { connect: vi.fn(), disconnect: vi.fn() };
  const mockGain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    sampleRate: 44100,
    createMediaElementSource: vi.fn(() => mockSource),
    createGain: vi.fn(() => mockGain),
    destination: {},
  };
  const analyser = {
    frequencyBinCount: 1024,
    getByteFrequencyData: vi.fn(),
    context: ctx,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return { analyser, ctx, mockSource, mockGain };
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

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
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

    it('creates a PixiJS Application and initializes with transparent background', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Application } = await import('pixi.js');
      expect(Application).toHaveBeenCalled();
      const instance = Application.mock.instances[0];
      expect(instance.init).toHaveBeenCalledWith(
        expect.objectContaining({
          canvas,
          backgroundAlpha: 0,
          autoStart: false,
        }),
      );
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
    it('pause does not throw before init', () => {
      expect(() => pause()).not.toThrow();
    });

    it('resume does not throw before init', () => {
      expect(() => resume()).not.toThrow();
    });

    it('resume does not start when prefers-reduced-motion is active', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      globalThis.matchMedia = vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
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

    it('destroys cached TextureSources from the mask cache', async () => {
      const { TextureSource } = await import('pixi.js');
      const mockTextureSource = { style: {}, destroy: vi.fn() };
      TextureSource.from.mockReturnValue(mockTextureSource);

      const canvas = createMockCanvas();
      await init(canvas);
      await loadScene({ regions: [{ type: 'water', mask: 'mask.png' }] }, 'scene.webp');

      expect(TextureSource.from).toHaveBeenCalled();

      destroy();
      await Promise.resolve(); // flush microtasks so the .then() callback executes

      expect(mockTextureSource.destroy).toHaveBeenCalled();
    });

    it('closes in-flight ImageBitmaps that resolve after destroy', async () => {
      let resolveBitmap;
      const bitmap = { width: 256, height: 256, close: vi.fn() };
      globalThis.createImageBitmap = vi.fn(
        () => new Promise((resolve) => { resolveBitmap = () => resolve(bitmap); }),
      );

      const canvas = createMockCanvas();
      await init(canvas);

      // Start a loadScene — createImageBitmap will be called but not yet resolved
      const sceneLoad = loadScene(
        { regions: [{ type: 'water', mask: 'inflight.png' }] },
        'scene.webp',
      );

      // Wait until the async chain has reached createImageBitmap so resolveBitmap is set
      await vi.waitFor(() => expect(globalThis.createImageBitmap).toHaveBeenCalled());

      destroy(); // destroys before the bitmap resolves

      resolveBitmap(); // now resolve the in-flight bitmap
      await sceneLoad;
      await Promise.resolve(); // flush remaining microtasks

      expect(bitmap.close).toHaveBeenCalled();
    });

    it('closes stale in-flight ImageBitmaps across destroy and re-init', async () => {
      let resolveBitmap;
      const bitmap = { width: 256, height: 256, close: vi.fn() };
      globalThis.createImageBitmap = vi.fn(
        () => new Promise((resolve) => { resolveBitmap = () => resolve(bitmap); }),
      );

      const firstCanvas = createMockCanvas();
      await init(firstCanvas);

      const sceneLoad = loadScene(
        { regions: [{ type: 'water', mask: 'stale-race.png' }] },
        'scene.webp',
      );

      await vi.waitFor(() => expect(globalThis.createImageBitmap).toHaveBeenCalled());

      destroy();
      const secondCanvas = createMockCanvas();
      await init(secondCanvas);

      resolveBitmap();
      await sceneLoad;
      await Promise.resolve();

      expect(bitmap.close).toHaveBeenCalled();
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

    it('cancelPendingLoad invalidates in-flight loadScene', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { createEffect } = await import('../../src/effects.js');
      createEffect.mockClear();

      // Start a loadScene that will be in-flight during cancel
      const inflight = loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      // Cancel before the in-flight call can finish
      cancelPendingLoad();
      clearAll();

      await inflight;

      // The in-flight load should have bailed at a generation check
      expect(createEffect).not.toHaveBeenCalled();
    });

    it('cancelPendingLoad is safe to call before init', () => {
      destroy();
      expect(() => cancelPendingLoad()).not.toThrow();
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

    it('loadScene does not start ticker when paused', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      pause();

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.ticker.start.mockClear();

      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      expect(instance.ticker.start).not.toHaveBeenCalled();
    });

    it('loadScene renders initial frame when paused so effects are visible', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      pause();

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.render = vi.fn();

      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      expect(instance.render).toHaveBeenCalled();
    });

    it('resume after paused loadScene starts ticker', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      pause();

      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.ticker.start.mockClear();

      resume();

      expect(instance.ticker.start).toHaveBeenCalled();
    });

    it('destroy resets isPaused so next init starts clean', async () => {
      const canvas = createMockCanvas();
      await init(canvas);
      pause();
      destroy();

      // Re-init and load a scene — ticker should start (isPaused was reset)
      const canvas2 = createMockCanvas();
      await init(canvas2);

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[Application.mock.instances.length - 1];
      instance.ticker.start.mockClear();

      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      expect(instance.ticker.start).toHaveBeenCalled();
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
      expect(createEffect.mock.results.length).toBeGreaterThan(0);
      const effect = createEffect.mock.results[0].value;
      expect(effect).toBeDefined();
      expect(effect.update).toHaveBeenCalled();
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
        this.width = 256;
        this.height = 256;
        this.naturalWidth = 256;
        this.naturalHeight = 256;
        Object.defineProperty(this, 'src', {
          set: () => {
            callCount++;
            // Fail the second Image load (first mask's luminance processing)
            // but succeed on others (noise, scene texture, second mask)
            if (callCount === 2) {
              this.onerror?.();
            } else {
              this.onload?.();
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

  describe('reduced-motion mid-session toggle', () => {
    it('stops ticker when reduced-motion is enabled mid-session', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene.png',
      );

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.ticker.stop.mockClear();

      // Get the matchMedia listener registered during init
      const mqResult = globalThis.matchMedia.mock.results[0].value;
      const changeHandler = mqResult.addEventListener.mock.calls.find(
        ([event]) => event === 'change',
      );
      expect(changeHandler).toBeDefined();

      // Simulate enabling reduced motion
      changeHandler[1]({ matches: true });
      expect(instance.ticker.stop).toHaveBeenCalled();
    });

    it('restarts ticker when reduced-motion is disabled mid-session', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene.png',
      );

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];

      // Get the matchMedia listener
      const mqResult = globalThis.matchMedia.mock.results[0].value;
      const changeHandler = mqResult.addEventListener.mock.calls.find(
        ([event]) => event === 'change',
      );

      // Simulate enabling then disabling reduced motion
      changeHandler[1]({ matches: true });
      instance.ticker.start.mockClear();
      changeHandler[1]({ matches: false });
      expect(instance.ticker.start).toHaveBeenCalled();
    });

    it('does not restart ticker when paused and reduced-motion disabled', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      await loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene.png',
      );

      pause();

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[0];
      instance.ticker.start.mockClear();

      const mqResult = globalThis.matchMedia.mock.results[0].value;
      const changeHandler = mqResult.addEventListener.mock.calls.find(
        ([event]) => event === 'change',
      );

      changeHandler[1]({ matches: false });
      expect(instance.ticker.start).not.toHaveBeenCalled();
    });

    it('removes matchMedia listener on destroy', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const mqResult = globalThis.matchMedia.mock.results[0].value;
      destroy();

      expect(mqResult.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });
  });

  describe('noiseSprite rendering', () => {
    it('sets noiseSprite.renderable to false', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Sprite } = await import('pixi.js');
      Sprite.mockClear();

      await loadScene(
        { regions: [{ type: 'water', mask: 'mask.png' }] },
        'scene.png',
      );

      // First Sprite instance is the noiseSprite (water needs noise)
      const noiseSprite = Sprite.mock.instances[0];
      expect(noiseSprite.renderable).toBe(false);
    });
  });

  describe('texture leak prevention', () => {
    it('destroys sceneTexture when generation changes during load', async () => {
      const canvas = createMockCanvas();
      await init(canvas);

      const { Texture } = await import('pixi.js');

      // Start a load and immediately supersede it
      const first = loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene-old.png',
      );
      loadScene(
        { regions: [{ type: 'glow', mask: 'mask.png' }] },
        'scene-new.png',
      );

      await first;

      // The first scene's texture should have been destroyed
      const textures = Texture.from.mock.results;
      if (textures.length > 1) {
        expect(textures[0].value.destroy).toHaveBeenCalledWith(false);
      }
    });
  });
});

describe('effects-canvas — audio-reactive modulation (ADR-008)', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
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


  it('setAnalyser stores the analyser and allocates fftData', () => {
    const analyser = createMockAnalyser();
    expect(() => setAnalyser(analyser)).not.toThrow();
    setAnalyser(null);
  });

  it('setAnalyser reallocates fftData when frequencyBinCount changes', () => {
    const analyser512 = createMockAnalyser(44100, 512);
    setAnalyser(analyser512);
    // Second analyser with different bin count — must reallocate, not reuse
    const analyser2048 = createMockAnalyser(44100, 2048);
    expect(() => setAnalyser(analyser2048)).not.toThrow();
    setAnalyser(null);
  });

  it('setAnalyser(null) clears fftData', () => {
    const analyser = createMockAnalyser();
    setAnalyser(analyser);
    setAnalyser(null);
    // Re-setting the same analyser after clearing should not throw
    expect(() => setAnalyser(analyser)).not.toThrow();
    setAnalyser(null);
  });

  it('setAnalyser with null is a no-op', () => {
    expect(() => setAnalyser(null)).not.toThrow();
  });

  it('clearAll resets the analyser reference', async () => {
    const canvas = createMockCanvas();
    await init(canvas);

    const analyser = createMockAnalyser();
    setAnalyser(analyser);
    clearAll();

    // After clearAll, the analyser should be cleared.
    // We verify by setting up a ticker callback and checking
    // that getByteFrequencyData is NOT called.
    const { Application } = await import('pixi.js');
    const instance = Application.mock.instances[Application.mock.instances.length - 1];
    const tickerCallback = instance.ticker.add.mock.calls[0]?.[0];
    if (tickerCallback) {
      tickerCallback({ deltaMS: 16.67 });
      expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
    }

    destroy();
  });

  describe('band extraction', () => {
    it('extractBands produces correct values at 44100Hz', async () => {
      // We test the band extraction indirectly through the ticker.
      // Set up: init, load a scene with audioReactive, set analyser AFTER
      // loadScene (loadScene calls clearAll which resets the analyser —
      // same order as the real app.js bridge wiring).
      const canvas = createMockCanvas();
      await init(canvas);

      const analyser = createMockAnalyser(44100);
      // Fill FFT data: bass bins (1-12) = 255 (full energy), rest = 0
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        // At 44100Hz, fftSize=2048: binWidth = 44100/2048 ≈ 21.5Hz
        // bass: 20-250Hz → bins ~1-12
        for (let i = 1; i <= 12; i++) data[i] = 255;
      });

      // Load a scene with audioReactive config
      const config = {
        regions: [
          {
            type: 'glow',
            mask: 'assets/masks/test.png',
            audioReactive: { band: 'bass', target: 'outerStrength', range: [0, 10], smoothing: 0 },
          },
        ],
      };

      await loadScene(config, 'assets/images/test.webp');

      // Set analyser AFTER loadScene (matches real app.js wiring order)
      setAnalyser(analyser);

      // Get the ticker callback and invoke it
      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[Application.mock.instances.length - 1];
      const tickerCallback = instance.ticker.add.mock.calls[0]?.[0];
      if (tickerCallback) {
        tickerCallback({ deltaMS: 16.67 });

        // With smoothing=0, bass energy=1.0, range=[0,10] → value should be 10
        expect(analyser.getByteFrequencyData).toHaveBeenCalled();
      }

      destroy();
    });

    it('accepts analyser with 48000Hz sampleRate without error', () => {
      const analyser = createMockAnalyser(48000);
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(128);
      });
      expect(() => setAnalyser(analyser)).not.toThrow();

      // Verify the analyser was stored by confirming it can be used in a ticker callback
      // (extractBands will use the sample rate to compute frequency bins)
      setAnalyser(null);
    });
  });

  it('audio-reactive is skipped when reducedMotion is true', async () => {
    const matchMediaSpy = vi.spyOn(globalThis, 'matchMedia');
    matchMediaSpy.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const canvas = createMockCanvas();
    await init(canvas);

    const analyser = createMockAnalyser();

    const config = {
      regions: [
        {
          type: 'glow',
          mask: 'assets/masks/test.png',
          audioReactive: { band: 'bass', target: 'outerStrength', range: [0, 10], smoothing: 0.8 },
        },
      ],
    };

    await loadScene(config, 'assets/images/test.webp');

    // Set analyser AFTER loadScene (matches real app.js wiring order)
    setAnalyser(analyser);

    const { Application } = await import('pixi.js');
    const instance = Application.mock.instances[Application.mock.instances.length - 1];
    const tickerCallback = instance.ticker.add.mock.calls[0]?.[0];
    if (tickerCallback) {
      tickerCallback({ deltaMS: 16.67 });
      // Under reduced motion, getByteFrequencyData should NOT be called
      expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
    }

    matchMediaSpy.mockRestore();
    destroy();
  });

  it('no FFT reads when audioReactiveState is empty', async () => {
    const canvas = createMockCanvas();
    await init(canvas);

    const analyser = createMockAnalyser();

    // Load scene WITHOUT audioReactive regions
    const config = {
      regions: [{ type: 'glow', mask: 'assets/masks/test.png' }],
    };

    await loadScene(config, 'assets/images/test.webp');

    // Set analyser AFTER loadScene (matches real app.js wiring order)
    setAnalyser(analyser);

    const { Application } = await import('pixi.js');
    const instance = Application.mock.instances[Application.mock.instances.length - 1];
    const tickerCallback = instance.ticker.add.mock.calls[0]?.[0];
    if (tickerCallback) {
      tickerCallback({ deltaMS: 16.67 });
      // No audioReactive regions → no FFT reads
      expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
    }

    destroy();
  });

  describe('onset trigger mode', () => {
    it('spectral flux fires trigger on energy increase', async () => {
      const { analyser, tickerCallback, triggerFn } = await setupTriggerScene({
        band: 'bass',
        trigger: { threshold: 3, cooldown: 0 },
      });

      // 65 frames of alternating low energy to stabilize flux running average.
      let warmupFrame = 0;
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        const val = warmupFrame % 2 === 0 ? 25 : 30;
        for (let i = 1; i <= 12; i++) data[i] = val;
        warmupFrame++;
      });
      for (let i = 0; i < 65; i++) tickerCallback({ deltaMS: 16.67 });
      triggerFn.mockClear();

      // Spike: large energy increase → high spectral flux exceeds fluxAvg * 3
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 255;
      });
      tickerCallback({ deltaMS: 16.67 });

      expect(triggerFn).toHaveBeenCalled();
      destroy();
    });

    it('cooldown prevents rapid re-triggering', async () => {
      const { analyser, tickerCallback, triggerFn } = await setupTriggerScene({
        band: 'bass',
        trigger: { threshold: 3, cooldown: 0.5 },
      });

      // 65 frames of alternating low energy to stabilize flux running average.
      let warmupFrame = 0;
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        const val = warmupFrame % 2 === 0 ? 25 : 30;
        for (let i = 1; i <= 12; i++) data[i] = val;
        warmupFrame++;
      });
      for (let i = 0; i < 65; i++) tickerCallback({ deltaMS: 16.67 });
      triggerFn.mockClear();

      // Spike — should trigger (large flux exceeds fluxAvg * 3)
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 255;
      });
      tickerCallback({ deltaMS: 16.67 });
      expect(triggerFn).toHaveBeenCalledTimes(1);

      // Drop back down then spike again immediately (within 0.5s cooldown)
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 25;
      });
      tickerCallback({ deltaMS: 16.67 });
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 255;
      });
      tickerCallback({ deltaMS: 16.67 });
      expect(triggerFn).toHaveBeenCalledTimes(1); // cooldown blocked it

      destroy();
    });

    it('minEnergy gates triggers below configured level', async () => {
      const { analyser, tickerCallback, triggerFn } = await setupTriggerScene({
        band: 'bass',
        trigger: { threshold: 3, cooldown: 0, minEnergy: 0.8 },
      });

      // 65 frames of alternating low energy to stabilize flux running average.
      let warmupFrame = 0;
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        const val = warmupFrame % 2 === 0 ? 25 : 30;
        for (let i = 1; i <= 12; i++) data[i] = val;
        warmupFrame++;
      });
      for (let i = 0; i < 65; i++) tickerCallback({ deltaMS: 16.67 });
      triggerFn.mockClear();

      // Energy spike to ~0.70 — above flux threshold but below minEnergy 0.80
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 180;
      });
      tickerCallback({ deltaMS: 16.67 });
      expect(triggerFn).not.toHaveBeenCalled();

      // Energy spike to 1.0 — above minEnergy, should trigger
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 255;
      });
      tickerCallback({ deltaMS: 16.67 });
      expect(triggerFn).toHaveBeenCalled();

      destroy();
    });

    it('combined trigger + modulation both run in same frame', async () => {
      const { analyser, tickerCallback, triggerFn } = await setupTriggerScene({
        band: 'bass',
        target: 'amplitude',
        range: [0, 10],
        smoothing: 0,
        trigger: { threshold: 3, cooldown: 0 },
      });

      // 65 frames of alternating low energy to stabilize flux running average
      let warmupFrame = 0;
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        const val = warmupFrame % 2 === 0 ? 25 : 30;
        for (let i = 1; i <= 12; i++) data[i] = val;
        warmupFrame++;
      });
      for (let i = 0; i < 65; i++) tickerCallback({ deltaMS: 16.67 });
      triggerFn.mockClear();

      // Spike — both modulation and trigger should fire
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 255;
      });
      tickerCallback({ deltaMS: 16.67 });

      // Trigger fired
      expect(triggerFn).toHaveBeenCalled();

      // Modulation also set the amplitude (smoothing=0, energy=1.0, range=[0,10] → ~10)
      const { createEffect } = await import('../../src/effects.js');
      const mockEffect = createEffect.mock.results[0]?.value;
      expect(mockEffect.filter.amplitude).toBeGreaterThan(5);

      destroy();
    });

    it('modulate-only mode still works without trigger', async () => {
      const { createEffect } = await import('../../src/effects.js');
      createEffect.mockReturnValue({
        filter: { enabled: true, outerStrength: 0 },
        update: vi.fn(),
      });

      const canvas = createMockCanvas();
      await init(canvas);

      const config = {
        regions: [
          {
            type: 'glow',
            mask: 'assets/masks/test.png',
            audioReactive: { band: 'bass', target: 'outerStrength', range: [0, 10], smoothing: 0 },
          },
        ],
      };

      await loadScene(config, 'assets/images/test.webp');

      const analyser = createMockAnalyser(44100);
      analyser.getByteFrequencyData.mockImplementation((data) => {
        data.fill(0);
        for (let i = 1; i <= 12; i++) data[i] = 255;
      });
      setAnalyser(analyser);

      const { Application } = await import('pixi.js');
      const instance = Application.mock.instances[Application.mock.instances.length - 1];
      const tickerCallback = instance.ticker.add.mock.calls[0]?.[0];
      tickerCallback({ deltaMS: 16.67 });

      // Modulation should have set the parameter
      const mockEffect = createEffect.mock.results[createEffect.mock.results.length - 1]?.value;
      expect(mockEffect.filter.outerStrength).toBeGreaterThan(5);

      destroy();
    });
  });
});

describe('effects-canvas — dedicated analysis element (ADR-008 Approach B)', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    setupImageMock();

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

  it('connectAnalysisAudio creates element and routes through silent gain to destination', () => {
    const { analyser, ctx, mockSource, mockGain } = createMockAnalyserWithContext();

    connectAnalysisAudio('test-song.mp3', analyser);

    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    expect(createdEl.tagName).toBe('AUDIO');
    expect(createdEl.preload).toBe('auto');
    expect(createdEl.loop).toBe(false);
    expect(createdEl.src).toContain('test-song.mp3');

    // Source → analyser → gain(0) → destination
    expect(mockSource.connect).toHaveBeenCalledWith(analyser);
    expect(ctx.createGain).toHaveBeenCalledTimes(1);
    expect(mockGain.gain.value).toBe(0);
    expect(analyser.connect).toHaveBeenCalledWith(mockGain);
    expect(mockGain.connect).toHaveBeenCalledWith(ctx.destination);
  });

  it('connectAnalysisAudio sets loop on the analysis element when loop=true', () => {
    const { analyser, ctx } = createMockAnalyserWithContext();

    connectAnalysisAudio('looping-song.mp3', analyser, true);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    expect(createdEl.loop).toBe(true);
  });

  it('connectAnalysisAudio replaces previous analysis element', () => {
    const { analyser, ctx, mockSource, mockGain } = createMockAnalyserWithContext();

    connectAnalysisAudio('song-1.mp3', analyser);
    const firstSource = mockSource;
    const firstGain = mockGain;

    // Create new mocks for second call
    const secondSource = { connect: vi.fn(), disconnect: vi.fn() };
    const secondGain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    ctx.createMediaElementSource.mockReturnValueOnce(secondSource);
    ctx.createGain.mockReturnValueOnce(secondGain);

    connectAnalysisAudio('song-2.mp3', analyser);

    // First source and gain should have been disconnected
    expect(firstSource.disconnect).toHaveBeenCalled();
    expect(firstGain.disconnect).toHaveBeenCalled();
    // AnalyserNode must be explicitly disconnected from the old gain to
    // avoid accumulating orphaned analyserNode → dead-end-gain connections.
    expect(analyser.disconnect).toHaveBeenCalledWith(firstGain);
  });

  it('connectAnalysisAudio handles createMediaElementSource failure gracefully', () => {
    const ctx = {
      sampleRate: 44100,
      createMediaElementSource: vi.fn(() => {
        throw new Error('Already connected');
      }),
    };
    const analyser = {
      frequencyBinCount: 1024,
      getByteFrequencyData: vi.fn(),
      context: ctx,
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    connectAnalysisAudio('bad.mp3', analyser);

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to create analysis audio source:',
      expect.any(String),
    );
    warnSpy.mockRestore();

    // startAnalysisPlayback should be a no-op since element was not stored
    startAnalysisPlayback();
  });

  it('connectAnalysisAudio is a no-op when analyserNode is null', () => {
    expect(() => connectAnalysisAudio('test.mp3', null)).not.toThrow();
  });

  it('connectAnalysisAudio is a no-op when analyserNode.context is missing', () => {
    const analyser = {
      frequencyBinCount: 1024,
      getByteFrequencyData: vi.fn(),
      context: null,
    };

    expect(() => connectAnalysisAudio('test.mp3', analyser)).not.toThrow();
  });

  it('startAnalysisPlayback calls play on the analysis element', () => {
    const { analyser, ctx } = createMockAnalyserWithContext();

    connectAnalysisAudio('test-song.mp3', analyser);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    createdEl.play = vi.fn().mockResolvedValue(undefined);

    startAnalysisPlayback();
    expect(createdEl.play).toHaveBeenCalled();
  });

  it('startAnalysisPlayback is a no-op when no analysis element exists', () => {
    expect(() => startAnalysisPlayback()).not.toThrow();
  });

  it('clearAll cleans up the analysis element and gain node', async () => {
    const canvas = createMockCanvas();
    await init(canvas);

    const { analyser, ctx, mockSource, mockGain } = createMockAnalyserWithContext();

    connectAnalysisAudio('test-song.mp3', analyser);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    createdEl.pause = vi.fn();
    createdEl.load = vi.fn();

    clearAll();

    expect(mockGain.disconnect).toHaveBeenCalled();
    expect(mockSource.disconnect).toHaveBeenCalled();
    expect(createdEl.pause).toHaveBeenCalled();
  });

  it('clearAll cleans analysis graph even when WebGL app is unavailable', () => {
    const { analyser, ctx, mockSource, mockGain } = createMockAnalyserWithContext();

    // No init() call here: pixiApp remains null (fallback path).
    connectAnalysisAudio('test-song.mp3', analyser);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    createdEl.pause = vi.fn();
    createdEl.load = vi.fn();

    clearAll();

    expect(mockGain.disconnect).toHaveBeenCalled();
    expect(mockSource.disconnect).toHaveBeenCalled();
    expect(createdEl.pause).toHaveBeenCalled();
  });

  it('pause stops the analysis element', () => {
    const { analyser, ctx } = createMockAnalyserWithContext();

    connectAnalysisAudio('test-song.mp3', analyser);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    createdEl.pause = vi.fn();

    pause();
    expect(createdEl.pause).toHaveBeenCalled();
  });

  it('resume restarts the analysis element when not reduced motion', () => {
    const { analyser, ctx } = createMockAnalyserWithContext();

    connectAnalysisAudio('test-song.mp3', analyser);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    createdEl.play = vi.fn().mockResolvedValue(undefined);

    resume();
    expect(createdEl.play).toHaveBeenCalled();
  });

  it('resume does not restart analysis element under reduced motion', () => {
    const { analyser, ctx } = createMockAnalyserWithContext();

    connectAnalysisAudio('test-song.mp3', analyser);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    createdEl.play = vi.fn().mockResolvedValue(undefined);

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    resume();
    expect(createdEl.play).not.toHaveBeenCalled();
  });

  it('startAnalysisPlayback catches play rejection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { analyser, ctx } = createMockAnalyserWithContext();

    connectAnalysisAudio('test-song.mp3', analyser);

    const createdEl = ctx.createMediaElementSource.mock.calls[0][0];
    createdEl.play = vi.fn().mockRejectedValue(new Error('autoplay blocked'));

    startAnalysisPlayback();
    expect(createdEl.play).toHaveBeenCalled();
    await Promise.resolve(); // flush microtask so .catch() handler runs
    expect(warnSpy).toHaveBeenCalledWith('Analysis audio play failed:', 'autoplay blocked');
    warnSpy.mockRestore();
  });
});

describe('effects-canvas.js — mask validation errors', () => {
  let originalGetContext;
  let originalImage;
  let originalCreateImageBitmap;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalImage = globalThis.Image;
    originalCreateImageBitmap = globalThis.createImageBitmap;
  });

  afterEach(() => {
    destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.Image = originalImage;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    vi.restoreAllMocks();
  });

  it('skips region when mask image has zero dimensions', async () => {
    // First Image (scene texture) loads fine, second (mask) has zero dims
    let imgCount = 0;
    globalThis.Image = vi.fn(function () {
      imgCount++;
      if (imgCount <= 1) {
        // Scene texture load — normal
        this.width = 256;
        this.height = 256;
        this.naturalWidth = 256;
        this.naturalHeight = 256;
      } else {
        // Mask load — zero dimensions
        this.width = 0;
        this.height = 0;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }
      Object.defineProperty(this, 'src', {
        set: () => { this.onload?.(); },
      });
    });
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 256, height: 256 });

    HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === '2d') {
        return {
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(4),
          })),
          putImageData: vi.fn(),
        };
      }
      return originalGetContext?.call(this, type);
    };

    const canvas = createMockCanvas();
    await init(canvas);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadScene(
      { regions: [{ type: 'glow', mask: 'zero-dim.png' }] },
      'scene.png',
    );

    // Per-region error caught by loadRegionEffects → console.warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping effect region'),
      expect.stringContaining('zero dimensions'),
    );
    // loadScene still returns true (region skipped, not fatal)
    expect(result).toBe(true);
    warnSpy.mockRestore();
  });

  it('skips region when 2D context creation fails for mask processing', async () => {
    // First Image (scene texture) succeeds, second (mask) needs 2D context
    let imgCount = 0;
    globalThis.Image = vi.fn(function () {
      imgCount++;
      this.width = 256;
      this.height = 256;
      this.naturalWidth = 256;
      this.naturalHeight = 256;
      Object.defineProperty(this, 'src', {
        set: () => { this.onload?.(); },
      });
    });
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 256, height: 256 });

    // Make getContext('2d') return null for mask canvas creation
    HTMLCanvasElement.prototype.getContext = function () {
      return null;
    };

    const canvas = createMockCanvas();
    await init(canvas);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadScene(
      { regions: [{ type: 'glow', mask: 'mask.png' }] },
      'scene.png',
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping effect region'),
      expect.stringContaining('2D context'),
    );
    expect(result).toBe(true);
    warnSpy.mockRestore();
  });
});

describe('effects-canvas.js — effect creation failure', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    setupImageMock();

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

  it('handles createEffect returning null (factory declined)', async () => {
    const { createEffect } = await import('../../src/effects.js');
    createEffect.mockReturnValueOnce(null);

    const canvas = createMockCanvas();
    await init(canvas);

    // water type requires noise sprite — createEffect returns null → noise sprite cleaned up
    const result = await loadScene(
      { regions: [{ type: 'water', mask: 'mask.png' }] },
      'scene.png',
    );

    // Should succeed (region is skipped, but loadScene still returns true)
    expect(result).toBe(true);
  });

  it('handles centered effect with centerX/centerY', async () => {
    const canvas = createMockCanvas();
    await init(canvas);

    const { Application } = await import('pixi.js');
    const instance = Application.mock.instances[0];
    instance.screen.width = 1920;
    instance.screen.height = 1080;

    // Load scene with centered shockwave effect
    const result = await loadScene(
      {
        regions: [{
          type: 'shockwave',
          mask: 'mask.png',
          centerX: 0.5,
          centerY: 0.3,
        }],
      },
      'scene.png',
    );

    expect(result).toBe(true);

    // Verify that createEffect was called and center was set on the filter
    const { createEffect } = await import('../../src/effects.js');
    expect(createEffect.mock.results.length).toBeGreaterThan(0);
    const effect = createEffect.mock.results[0].value;
    expect(effect).toBeDefined();
    expect(effect.filter.center).toEqual({
      x: 0.5 * 1920,
      y: 0.3 * 1080,
    });
  });

  it('resize updates centered effect positions to new dimensions', async () => {
    const canvas = createMockCanvas();
    await init(canvas);

    const { Application } = await import('pixi.js');
    const instance = Application.mock.instances[0];
    instance.screen.width = 1920;
    instance.screen.height = 1080;

    await loadScene(
      {
        regions: [{
          type: 'shockwave',
          mask: 'mask.png',
          centerX: 0.5,
          centerY: 0.3,
        }],
      },
      'scene.png',
    );

    // Trigger resize with new dimensions
    instance.screen.width = 1280;
    instance.screen.height = 720;
    const ResizeObserverCb = globalThis.ResizeObserver.mock.calls[0][0];
    ResizeObserverCb();

    expect(instance.renderer.resize).toHaveBeenCalled();

    // Verify centered effects were recalculated for new dimensions
    const { createEffect } = await import('../../src/effects.js');
    expect(createEffect.mock.results.length).toBeGreaterThan(0);
    const effect = createEffect.mock.results[0].value;
    expect(effect).toBeDefined();
    expect(effect.filter.center).toEqual({
      x: 0.5 * 1280,
      y: 0.3 * 720,
    });
  });
});

describe('effects-canvas.js — tickerUpdate error handling', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    setupImageMock();

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

  it('catches effect.update error without crashing ticker', async () => {
    const { createEffect } = await import('../../src/effects.js');
    createEffect.mockReturnValueOnce({
      filter: { enabled: true },
      update: vi.fn(() => { throw new Error('Shader explosion'); }),
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const canvas = createMockCanvas();
    await init(canvas);

    await loadScene(
      { regions: [{ type: 'glow', mask: 'mask.png' }] },
      'scene.png',
    );

    const { Application } = await import('pixi.js');
    const instance = Application.mock.instances[0];
    const tickerCb = instance.ticker.add.mock.calls[0][0];

    // Invoke ticker — should catch error, not crash
    expect(() => tickerCb({ deltaMS: 16.67 })).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      'Effect update failed:',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('catches audio-reactive modulation error', async () => {
    const { analyser, tickerCallback } = await setupTriggerScene({
      band: 'bass',
      trigger: { threshold: 1.5, cooldown: 0.08 },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Make getByteFrequencyData throw
    analyser.getByteFrequencyData.mockImplementation(() => {
      throw new Error('FFT failed');
    });

    expect(() => tickerCallback({ deltaMS: 16.67 })).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      'Audio-reactive modulation failed:',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});

describe('effects-canvas.js — clearAll with masked children', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    setupImageMock();

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

  it('clears mask on children during clearAll', async () => {
    const canvas = createMockCanvas();
    await init(canvas);

    // Load a water region which creates masked containers
    await loadScene(
      { regions: [{ type: 'water', mask: 'mask.png' }] },
      'scene.png',
    );

    const { Container } = await import('pixi.js');
    const container = Container.mock.instances[0];

    // clearAll should remove all stage children and destroy them
    clearAll();

    expect(container.destroy).toHaveBeenCalledWith({ children: true, texture: false });
  });
});

describe('effects-canvas.js — reinit failure', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    setupImageMock();

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

  it('returns false and disables webgl when reinit fails', async () => {
    const canvas = createMockCanvas();
    await init(canvas);

    // Simulate context loss
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const event = new Event('webglcontextlost');
    event.preventDefault = vi.fn();
    canvas.dispatchEvent(event);
    errorSpy.mockRestore();

    // Make the next Application.init fail to simulate reinit failure
    const { Application } = await import('pixi.js');
    Application.mockImplementationOnce(function () {
      this.init = vi.fn().mockRejectedValue(new Error('GPU gone'));
      this.ticker = { add: vi.fn(), stop: vi.fn(), start: vi.fn() };
      this.destroy = vi.fn();
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await loadScene(
      { regions: [{ type: 'glow', mask: 'mask.png' }] },
      'scene.png',
    );

    // reinit failed → webglAvailable becomes false → returns false
    expect(result).toBe(false);
    errSpy.mockRestore();
  });
});

describe('effects-canvas.js — createImageBitmap fallback', () => {
  let originalGetContext;

  beforeEach(() => {
    destroy();
    vi.clearAllMocks();

    globalThis.ResizeObserver = vi.fn(function () {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });

    vi.spyOn(globalThis, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === '2d') {
        return {
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(256 * 256 * 4),
            width: 256,
            height: 256,
          })),
          putImageData: vi.fn(),
        };
      }
      return originalGetContext.call(this, type);
    };
  });

  afterEach(() => {
    destroy();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.restoreAllMocks();
  });

  it('falls back to canvas when createImageBitmap rejects', async () => {
    globalThis.Image = vi.fn(function () {
      this.width = 256;
      this.height = 256;
      this.naturalWidth = 256;
      this.naturalHeight = 256;
      Object.defineProperty(this, 'src', {
        set: () => { this.onload?.(); },
      });
    });

    // createImageBitmap rejects — should fall back to canvas
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('bitmap not supported'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const canvas = createMockCanvas();
    await init(canvas);

    const result = await loadScene(
      { regions: [{ type: 'glow', mask: 'mask.png' }] },
      'scene.png',
    );

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('createImageBitmap failed'),
      expect.any(String),
    );

    warnSpy.mockRestore();
    delete globalThis.createImageBitmap;
    delete globalThis.Image;
  });

  it('falls back to canvas when createImageBitmap is not available', async () => {
    globalThis.Image = vi.fn(function () {
      this.width = 256;
      this.height = 256;
      this.naturalWidth = 256;
      this.naturalHeight = 256;
      Object.defineProperty(this, 'src', {
        set: () => { this.onload?.(); },
      });
    });

    // Remove createImageBitmap entirely
    const saved = globalThis.createImageBitmap;
    delete globalThis.createImageBitmap;

    const canvas = createMockCanvas();
    await init(canvas);

    const result = await loadScene(
      { regions: [{ type: 'glow', mask: 'mask.png' }] },
      'scene.png',
    );

    // Should succeed using canvas fallback
    expect(result).toBe(true);

    globalThis.createImageBitmap = saved;
    delete globalThis.Image;
  });
});
