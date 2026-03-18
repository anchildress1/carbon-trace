/**
 * Canvas 2D lifecycle — manages the effects overlay canvas context,
 * DPR-aware sizing, and the requestAnimationFrame render loop. The
 * render loop currently clears the canvas each frame; effect
 * implementations will draw into this canvas via the effects.js
 * registry. The render loop is controlled by the orchestrator via
 * pause()/resume().
 *
 * Respects prefers-reduced-motion: the render loop will not start (and
 * will self-stop) when the user prefers reduced motion.
 */

let ctx = null;
let canvasEl = null;
let observer = null;
let running = false;
let rafId = null;
let cssWidth = 0;
let cssHeight = 0;

function reducedMotion() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sizeCanvas() {
  if (!canvasEl) return;

  const dpr = globalThis.devicePixelRatio || 1;
  const rect = canvasEl.getBoundingClientRect();

  cssWidth = rect.width;
  cssHeight = rect.height;

  canvasEl.width = cssWidth * dpr;
  canvasEl.height = cssHeight * dpr;

  if (ctx) {
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
  }
}

function render() {
  if (!running || !ctx || !canvasEl) return;

  if (reducedMotion()) {
    pause();
    return;
  }

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Currently no-op: effect draw calls will be added here when effect implementations are wired in.

  rafId = requestAnimationFrame(render);
}

export function initCanvas(el) {
  if (!el || !(el instanceof HTMLCanvasElement)) {
    throw new Error('initCanvas requires a <canvas> element');
  }

  if (canvasEl) destroy();

  canvasEl = el;
  ctx = canvasEl.getContext('2d');
  if (!ctx) {
    canvasEl = null;
    throw new Error('Failed to acquire 2D effects canvas context');
  }

  sizeCanvas();

  observer = new ResizeObserver(sizeCanvas);
  observer.observe(canvasEl);

  return ctx;
}

export function pause() {
  running = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export function resume() {
  if (!ctx || running || reducedMotion()) return;
  running = true;
  rafId = requestAnimationFrame(render);
}

export function clearAll() {
  pause();
  if (ctx && canvasEl) {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
  }
}

export function destroy() {
  pause();
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  ctx = null;
  canvasEl = null;
}

export function getContext() {
  return ctx;
}

export function isRunning() {
  return running;
}
