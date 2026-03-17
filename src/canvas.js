/**
 * Canvas 2D — scene image rendering with cover-fit, DPR-aware sizing,
 * and resize handling. Exposes the context for effects.js pixel access.
 *
 * Images are drawn to canvas via ctx.drawImage() with cover-fit logic
 * (same behaviour as CSS object-fit: cover). This is the primary
 * rendering surface — required for v2 pixel effects on the scene image.
 */

let ctx = null;
let canvasEl = null;
let observer = null;
let currentImg = null;

const imageCache = new Map();

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

function coverFit(img, cw, ch) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return { sx: 0, sy: 0, sw: iw, sh: ih, dx: 0, dy: 0, dw: cw, dh: ch };

  const canvasRatio = cw / ch;
  const imgRatio = iw / ih;

  let sx, sy, sw, sh;
  if (imgRatio > canvasRatio) {
    sh = ih;
    sw = ih * canvasRatio;
    sx = (iw - sw) / 2;
    sy = 0;
  } else {
    sw = iw;
    sh = iw / canvasRatio;
    sx = 0;
    sy = (ih - sh) / 2;
  }

  return { sx, sy, sw, sh, dx: 0, dy: 0, dw: cw, dh: ch };
}

function drawCurrent() {
  if (!ctx || !canvasEl || !currentImg) return;
  const rect = canvasEl.getBoundingClientRect();
  const fit = coverFit(currentImg, rect.width, rect.height);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.drawImage(currentImg, fit.sx, fit.sy, fit.sw, fit.sh, fit.dx, fit.dy, fit.dw, fit.dh);
}

export function initSceneCanvas(el) {
  if (!el || !(el instanceof HTMLCanvasElement)) {
    throw new Error('initSceneCanvas requires a <canvas> element');
  }

  if (canvasEl) destroySceneCanvas();

  canvasEl = el;
  ctx = canvasEl.getContext('2d');
  if (!ctx) {
    console.error('Failed to acquire 2D canvas context');
    canvasEl = null;
    return null;
  }

  sizeCanvas();

  observer = new ResizeObserver(() => {
    sizeCanvas();
    drawCurrent();
  });
  observer.observe(canvasEl);

  return ctx;
}

export function drawImage(img) {
  if (!img) {
    clearScene();
    return;
  }
  currentImg = img;
  drawCurrent();
}

export function clearScene() {
  currentImg = null;
  if (ctx && canvasEl) {
    const rect = canvasEl.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }
}

export function destroySceneCanvas() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  ctx = null;
  canvasEl = null;
  currentImg = null;
}

export function getSceneContext() {
  return ctx;
}

export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`Failed to load image: ${src}`);
      resolve(null);
    };
    img.src = src;
  });

  imageCache.set(src, promise);
  return promise;
}

export function getImageCache() {
  return imageCache;
}
