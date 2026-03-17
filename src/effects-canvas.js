/**
 * Canvas 2D lifecycle — manages the effects canvas context, DPR-aware
 * sizing, and the render loop. Individual effects will be registered
 * and dispatched through this module.
 */

let ctx = null;
let canvasEl = null;
let observer = null;
let running = false;
let rafId = null;

function sizeCanvas() {
  if (!canvasEl) return;

  const dpr = globalThis.devicePixelRatio || 1;
  const rect = canvasEl.getBoundingClientRect();

  canvasEl.width = rect.width * dpr;
  canvasEl.height = rect.height * dpr;

  if (ctx) {
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
  }
}

function render() {
  if (!running || !ctx || !canvasEl) return;

  const rect = canvasEl.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  // Effect render calls will go here when effects are added.

  rafId = requestAnimationFrame(render);
}

export function initCanvas(el) {
  if (!el || !(el instanceof HTMLCanvasElement)) {
    throw new Error('initCanvas requires a <canvas> element');
  }

  canvasEl = el;
  ctx = canvasEl.getContext('2d');

  sizeCanvas();

  observer = new ResizeObserver(() => {
    sizeCanvas();
  });
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
  if (!ctx) return;
  running = true;
  rafId = requestAnimationFrame(render);
}

export function clearAll() {
  pause();
  if (ctx && canvasEl) {
    const rect = canvasEl.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
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
