/**
 * Canvas 2D lifecycle — manages the effects overlay canvas context,
 * DPR-aware sizing, and the requestAnimationFrame render loop. Effect
 * drawing calls are inserted into the render loop by the orchestrator;
 * the registry and dispatch live in effects.js.
 *
 * Respects prefers-reduced-motion: the render loop will not start (and
 * will self-stop) when the user prefers reduced motion.
 */

let ctx = null;
let canvasEl = null;
let observer = null;
let running = false;
let rafId = null;

function reducedMotion() {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

  if (reducedMotion()) {
    pause();
    return;
  }

  const rect = canvasEl.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  // Active effect drawing calls are inserted here by the orchestrator.

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
