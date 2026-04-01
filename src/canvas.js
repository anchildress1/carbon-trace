/**
 * Canvas 2D — scene image rendering with cover-fit, DPR-aware sizing,
 * and resize handling. Exposes the scene canvas context via
 * getSceneContext() for pixel-level effects (e.g., ripple, bloom)
 * that read scene image data.
 *
 * Images are drawn to canvas via ctx.drawImage() with cover-fit logic
 * (same behaviour as CSS object-fit: cover). This is the primary
 * rendering surface — required for pixel effects that read scene image
 * data via getImageData/putImageData.
 */

let ctx = null;
let canvasEl = null;
let observer = null;
let currentImg = null;
let cssWidth = 0;
let cssHeight = 0;
let lastDpr = 1;

const imageCache = new Map();

function sizeCanvas() {
  if (!canvasEl) return;

  const dpr = globalThis.devicePixelRatio || 1;
  const rect = canvasEl.getBoundingClientRect();
  cssWidth = rect.width;
  cssHeight = rect.height;
  lastDpr = dpr;

  canvasEl.width = cssWidth * dpr;
  canvasEl.height = cssHeight * dpr;

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

function cssSize() {
  if (!canvasEl) return { w: 0, h: 0 };
  const dpr = globalThis.devicePixelRatio || 1;
  if (Math.abs(dpr - lastDpr) > 0.001) {
    sizeCanvas();
  }
  return { w: cssWidth, h: cssHeight };
}

function drawCurrent() {
  if (!ctx || !canvasEl || !currentImg) return;
  const { w, h } = cssSize();
  const fit = coverFit(currentImg, w, h);
  ctx.clearRect(0, 0, w, h);
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
    canvasEl = null;
    throw new Error('Failed to acquire 2D scene canvas context');
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
    const { w, h } = cssSize();
    ctx.clearRect(0, 0, w, h);
  }
}

export function drawFallback() {
  if (!ctx || !canvasEl) return;
  const { w, h } = cssSize();
  ctx.fillStyle = 'rgba(18, 18, 24, 0.92)';
  ctx.fillRect(0, 0, w, h);
}

export function destroySceneCanvas() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  ctx = null;
  canvasEl = null;
  currentImg = null;
  cssWidth = 0;
  cssHeight = 0;
  lastDpr = 1;
}

export function getSceneContext() {
  return ctx;
}

/**
 * Load an image and cache the resulting promise. Concurrent calls for
 * the same src share one in-flight request. Failed loads are evicted
 * from the cache so a subsequent call can retry.
 */
export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      imageCache.delete(src);
      console.warn(`Failed to load image: ${src}`);
      resolve(null);
    };
    img.src = src;
  });

  imageCache.set(src, promise);
  return promise;
}

export function resetImageCache() {
  imageCache.clear();
}
