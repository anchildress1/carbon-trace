/**
 * Trace shimmer overlay — visible circuit lines with traveling glow dots.
 *
 * Loads a circuit mask image, renders the lines as warm amber traces,
 * then spawns glowing dots that travel smoothly along the circuit paths.
 * Renders on a dedicated <canvas> layered above effects-canvas.
 *
 * Leaf module: does not import from app, canvas, audio, text, effects,
 * or overlay. Receives config via loadScene(), draws to its own canvas.
 */

let canvas = null;
let ctx = null;
let observer = null;
let rafId = null;
let paused = false;
let walkMap = null; // Uint8Array — 1 = walkable dark pixel
let walkPositions = []; // [{x,y}] — indexed walkable coords for O(1) spawn
let mapW = 0;
let mapH = 0;
let dots = [];
let opacity = 0;
let motionQuery = null;
let motionHandler = null;
let reducedMotion = false;
let traceImage = null;
let activeColor = [232, 200, 120]; // current scene's glow color
let activeDotSpeed = 0.8; // current scene's dot speed
let loadGeneration = 0; // monotonic counter — guards against stale async loads
let glowSprite = null; // pre-rendered glow halo canvas
let coreSprite = null; // pre-rendered bright core canvas
let spriteScale = 0; // scale factor sprites were built for

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Tuning constants
const DOT_COUNT = 15;
const DOT_RADIUS = 6;
const DOT_SPEED = 0.8;
const DEFAULT_COLOR = [232, 200, 120];
const TRACE_ALPHA = 0.25;
const DOT_ALPHA_BOOST = 2.5; // dots render brighter than trace lines for visible shimmer
const PULSE_FREQ = 0.0015; // ~4.2s full cycle
const WALK_RADIUS = 3; // pixels — tolerance for staying on thin lines
const LOOKAHEAD = 25; // how far ahead to scan for runway

function checkReducedMotion() {
  if (typeof globalThis.matchMedia !== 'function') return false;
  if (!motionQuery) {
    motionQuery = globalThis.matchMedia(REDUCED_MOTION_QUERY);
    motionHandler = (e) => {
      reducedMotion = e.matches;
    };
    motionQuery.addEventListener('change', motionHandler);
  }
  reducedMotion = motionQuery.matches;
  return reducedMotion;
}

function buildWalkMap(img) {
  const off = document.createElement('canvas');
  off.width = img.naturalWidth || img.width;
  off.height = img.naturalHeight || img.height;
  if (off.width === 0 || off.height === 0) {
    throw new Error(`shimmer: mask image has zero dimensions (${off.width}×${off.height})`);
  }
  const offCtx = off.getContext('2d', { willReadFrequently: true });
  if (!offCtx) {
    throw new Error('shimmer: failed to acquire offscreen 2D context for mask processing');
  }
  offCtx.drawImage(img, 0, 0);
  const imageData = offCtx.getImageData(0, 0, off.width, off.height);
  const { data, width, height } = imageData;

  mapW = width;
  mapH = height;
  walkMap = new Uint8Array(width * height);
  walkPositions = [];

  const threshold = 128;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < threshold && a > 128) {
      walkMap[i] = 1;
      walkPositions.push({ x: i % width, y: Math.floor(i / width) });
    }
  }
}

function buildTraceImage() {
  const off = document.createElement('canvas');
  off.width = mapW;
  off.height = mapH;
  const offCtx = off.getContext('2d');
  if (!offCtx) {
    throw new Error('shimmer: failed to acquire offscreen 2D context for trace image');
  }
  const imageData = offCtx.createImageData(mapW, mapH);
  const { data } = imageData;
  const [cr, cg, cb] = activeColor;

  for (let i = 0; i < mapW * mapH; i++) {
    if (walkMap[i]) {
      data[i * 4] = cr;
      data[i * 4 + 1] = cg;
      data[i * 4 + 2] = cb;
      data[i * 4 + 3] = Math.round(255 * TRACE_ALPHA);
    }
  }

  offCtx.putImageData(imageData, 0, 0);
  traceImage = off;
}

function isWalkableExact(x, y) {
  if (x < 0 || y < 0 || x >= mapW || y >= mapH) return false;
  return walkMap[y * mapW + x] === 1;
}

/**
 * Check if position is near a walkable pixel (within WALK_RADIUS).
 * This lets dots travel along thin 1-2px lines without falling off.
 */
function isNearWalkable(x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  for (let dy = -WALK_RADIUS; dy <= WALK_RADIUS; dy++) {
    for (let dx = -WALK_RADIUS; dx <= WALK_RADIUS; dx++) {
      if (dx * dx + dy * dy > WALK_RADIUS * WALK_RADIUS) continue;
      if (isWalkableExact(ix + dx, iy + dy)) return true;
    }
  }
  return false;
}

function findRandomWalkable() {
  if (walkPositions.length === 0) return null;
  return walkPositions[Math.floor(Math.random() * walkPositions.length)];
}

const DIRS_8 = [
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
];

// Normalize diagonal directions so speed is consistent
const DIRS_NORM = DIRS_8.map((d) => {
  const mag = Math.hypot(d.dx, d.dy);
  return { dx: d.dx / mag, dy: d.dy / mag };
});

/**
 * Count how far a dot can travel in a given direction using the
 * forgiving near-walkable check.
 */
function countRunway(x, y, dx, dy) {
  let len = 0;
  for (let step = 1; step <= LOOKAHEAD; step++) {
    if (isNearWalkable(x + dx * step, y + dy * step)) {
      len = step;
    } else {
      break;
    }
  }
  return len;
}

/**
 * Find the direction with the longest runway.
 * Optionally exclude backtracking (reverse of current heading).
 */
function findBestDirection(x, y, curDx, curDy) {
  let bestLen = 0;
  let bestIdx = -1;

  for (let i = 0; i < DIRS_NORM.length; i++) {
    const d = DIRS_NORM[i];

    // Penalize backtracking — skip directions that point backwards
    if (curDx !== undefined) {
      const dot = d.dx * curDx + d.dy * curDy;
      if (dot < -0.3) continue;
    }

    const len = countRunway(x, y, d.dx, d.dy);
    if (len > bestLen) {
      bestLen = len;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) return null;
  return { ...DIRS_NORM[bestIdx], runway: bestLen };
}

/**
 * Search a rectangular cell for a random walkable pixel.
 * Returns {x, y} or null after maxAttempts.
 */
function findWalkableInCell(x0, y0, x1, y1) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = x0 + Math.floor(Math.random() * (x1 - x0));
    const y = y0 + Math.floor(Math.random() * (y1 - y0));
    if (isWalkableExact(x, y)) return { x, y };
  }
  return null;
}

/**
 * Create a dot record at the given position with a random heading.
 */
function makeDot(pos) {
  const dir = findBestDirection(pos.x, pos.y);
  return {
    x: pos.x,
    y: pos.y,
    dx: dir ? dir.dx : DIRS_NORM[0].dx,
    dy: dir ? dir.dy : DIRS_NORM[0].dy,
    speed: activeDotSpeed * (0.5 + Math.random()),
    phase: Math.random() * Math.PI * 2,
    life: 0,
    maxLife: 800 + Math.random() * 1200,
    stuckCount: 0,
  };
}

/**
 * Distribute spawns across the mask by dividing into grid cells
 * and spawning one dot per populated cell.
 */
function spawnDistributed(count) {
  if (count === 0) return [];
  const cols = Math.ceil(Math.sqrt(count * (mapW / mapH)));
  const rows = Math.ceil(count / cols);
  const cellW = mapW / cols;
  const cellH = mapH / rows;
  const spawned = [];

  for (let r = 0; r < rows && spawned.length < count; r++) {
    for (let c = 0; c < cols && spawned.length < count; c++) {
      const x0 = Math.floor(c * cellW);
      const y0 = Math.floor(r * cellH);
      const x1 = Math.floor((c + 1) * cellW);
      const y1 = Math.floor((r + 1) * cellH);

      const found = findWalkableInCell(x0, y0, x1, y1);
      if (found) spawned.push(makeDot(found));
    }
  }

  // Fill remaining count from indexed walkable positions (handles sparse masks)
  while (spawned.length < count) {
    const pos = findRandomWalkable();
    if (!pos) break;
    spawned.push(makeDot(pos));
  }

  return spawned;
}

/**
 * Re-steer a dot if its current runway is running short.
 * Called periodically while the dot is moving normally.
 */
function maybeResteer(dot) {
  if (dot.life % 24 !== 0) return;
  const rx = Math.round(dot.x);
  const ry = Math.round(dot.y);
  const currentRun = countRunway(rx, ry, dot.dx, dot.dy);
  if (currentRun >= 6) return;

  const better = findBestDirection(rx, ry, dot.dx, dot.dy);
  if (better && better.runway > currentRun + 2) {
    dot.dx = better.dx;
    dot.dy = better.dy;
  }
}

/**
 * Handle a dot that hit a dead end: try one redirect, or mark for respawn.
 */
function handleDeadEnd(dot) {
  const rx = Math.round(dot.x);
  const ry = Math.round(dot.y);
  const newDir = findBestDirection(rx, ry, dot.dx, dot.dy);
  if (newDir && newDir.runway > 4) {
    dot.dx = newDir.dx;
    dot.dy = newDir.dy;
  } else {
    dot.life = dot.maxLife;
  }
}

/**
 * Respawn a dot at a new random walkable position.
 */
function respawnDot(dot) {
  const pos = findRandomWalkable();
  if (!pos) return;
  const dir = findBestDirection(pos.x, pos.y);
  dot.x = pos.x;
  dot.y = pos.y;
  dot.dx = dir ? dir.dx : DIRS_NORM[0].dx;
  dot.dy = dir ? dir.dy : DIRS_NORM[0].dy;
  dot.speed = activeDotSpeed * (0.5 + Math.random());
  dot.phase = Math.random() * Math.PI * 2;
  dot.life = 0;
  dot.maxLife = 800 + Math.random() * 1200;
  dot.stuckCount = 0;
}

function stepDot(dot) {
  dot.life++;

  const nx = dot.x + dot.dx * dot.speed;
  const ny = dot.y + dot.dy * dot.speed;

  if (isNearWalkable(nx, ny)) {
    dot.x = nx;
    dot.y = ny;
    dot.stuckCount = 0;
    maybeResteer(dot);
  } else {
    handleDeadEnd(dot);
  }

  if (dot.life >= dot.maxLife) {
    respawnDot(dot);
  }
}

/**
 * Build offscreen sprite canvases for glow halo and bright core at the
 * current scale. Called once per scene load (and on resize), replacing
 * 30 createRadialGradient() calls per frame with drawImage() blits.
 */
function buildDotSprites(scale) {
  const [cr, cg, cb] = activeColor;

  // Glow halo sprite
  const glowRadius = Math.ceil(DOT_RADIUS * 7 * scale);
  const glowSize = glowRadius * 2;
  const glowOff = document.createElement('canvas');
  glowOff.width = glowSize;
  glowOff.height = glowSize;
  const glowCtx = glowOff.getContext('2d');
  const glow = glowCtx.createRadialGradient(
    glowRadius,
    glowRadius,
    0,
    glowRadius,
    glowRadius,
    glowRadius,
  );
  glow.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0.6)`);
  glow.addColorStop(0.35, `rgba(${cr}, ${cg}, ${cb}, 0.2)`);
  glow.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
  glowCtx.fillStyle = glow;
  glowCtx.fillRect(0, 0, glowSize, glowSize);
  glowSprite = glowOff;

  // Bright core sprite
  const coreRadius = Math.ceil(DOT_RADIUS * 2 * scale);
  const coreSize = coreRadius * 2;
  const coreOff = document.createElement('canvas');
  coreOff.width = coreSize;
  coreOff.height = coreSize;
  const coreCtx = coreOff.getContext('2d');
  const core = coreCtx.createRadialGradient(
    coreRadius,
    coreRadius,
    0,
    coreRadius,
    coreRadius,
    coreRadius,
  );
  core.addColorStop(0, `rgba(255, 248, 225, 1)`);
  core.addColorStop(0.4, `rgba(${cr}, ${cg}, ${cb}, 0.5)`);
  core.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
  coreCtx.fillStyle = core;
  coreCtx.fillRect(0, 0, coreSize, coreSize);
  coreSprite = coreOff;

  spriteScale = scale;
}

function render(time) {
  if (!ctx || !canvas) return;

  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  if (!walkMap || opacity <= 0) return;

  if (traceImage) {
    ctx.globalAlpha = opacity;
    ctx.drawImage(traceImage, 0, 0, cw, ch);
    ctx.globalAlpha = 1;
  }

  if (dots.length === 0) return;

  const sx = cw / mapW;
  const sy = ch / mapH;
  const scale = Math.max(sx, sy);

  // Rebuild sprites if scale changed (e.g., after resize)
  if (!glowSprite || Math.abs(scale - spriteScale) > 0.01) {
    buildDotSprites(scale);
  }

  const glowR = glowSprite.width / 2;
  const coreR = coreSprite.width / 2;

  for (const dot of dots) {
    if (!reducedMotion) {
      stepDot(dot);
    }

    const px = dot.x * sx;
    const py = dot.y * sy;

    // Strong pulse: oscillates between dim (0.1) and bright (1.0)
    const wave = 0.5 + 0.5 * Math.sin(time * PULSE_FREQ + dot.phase);
    const pulse = reducedMotion ? 0.6 : 0.1 + 0.9 * wave;
    const alpha = Math.min(1, opacity * DOT_ALPHA_BOOST) * pulse;

    ctx.globalAlpha = alpha;
    ctx.drawImage(glowSprite, px - glowR, py - glowR);
    ctx.drawImage(coreSprite, px - coreR, py - coreR);
  }

  ctx.globalAlpha = 1;
}

function tick(time) {
  if (paused) return;
  render(time);
  rafId = requestAnimationFrame(tick);
}

function handleResize() {
  if (!canvas) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (w === 0 || h === 0) return;
  canvas.width = w;
  canvas.height = h;
}

/**
 * Validate traceOverlay config per ADR-006A §06A.3.3.
 * Throws on invalid config — no silent degradation.
 */
function validateConfig(config) {
  if (config.opacity === undefined || config.opacity === null) {
    throw new Error('shimmer: opacity is required when traceOverlay is present');
  }
  if (typeof config.opacity !== 'number' || config.opacity < 0 || config.opacity > 1) {
    throw new Error(`shimmer: opacity must be a number 0–1, got ${config.opacity}`);
  }
  if (!config.mask || typeof config.mask !== 'string') {
    throw new Error('shimmer: mask is required when traceOverlay is present');
  }
  if (config.color !== undefined) {
    if (
      !Array.isArray(config.color) ||
      config.color.length !== 3 ||
      !config.color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
    ) {
      throw new Error(
        `shimmer: color must be [r, g, b] integers 0–255, got ${JSON.stringify(config.color)}`,
      );
    }
    const [r, g, b] = config.color;
    if (r < g || r < b || b >= r * 0.65) {
      throw new Error(
        `shimmer: color must be warm-toned (amber through red-orange), got [${r}, ${g}, ${b}]`,
      );
    }
  }
  if (config.dotCount !== undefined) {
    if (!Number.isInteger(config.dotCount) || config.dotCount < 0) {
      throw new Error(`shimmer: dotCount must be a non-negative integer, got ${config.dotCount}`);
    }
  }
  if (config.dotSpeed !== undefined) {
    if (typeof config.dotSpeed !== 'number' || config.dotSpeed < 0) {
      throw new Error(`shimmer: dotSpeed must be a non-negative number, got ${config.dotSpeed}`);
    }
  }
}

// --- Public API ---

export function init(canvasEl) {
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new TypeError('shimmer: init() requires an HTMLCanvasElement');
  }
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('shimmer: failed to acquire 2D rendering context');
  }
  checkReducedMotion();
  handleResize();

  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => handleResize());
    observer.observe(canvas);
  }
}

export async function loadScene(config) {
  // No canvas yet — init() has not been called. Nothing to render.
  if (!canvas || !ctx) {
    return;
  }

  const gen = ++loadGeneration;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  dots = [];
  walkMap = null;
  walkPositions = [];
  traceImage = null;
  glowSprite = null;
  coreSprite = null;
  spriteScale = 0;

  if (!config) {
    opacity = 0;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  validateConfig(config);

  opacity = config.opacity;
  activeColor = config.color ?? DEFAULT_COLOR;
  activeDotSpeed = config.dotSpeed ?? DOT_SPEED;
  handleResize();

  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`Failed to load mask: ${config.mask}`));
    img.src = config.mask;
  });

  // Guard: if a newer loadScene() was called while we awaited the image,
  // this load is stale — discard results silently.
  if (gen !== loadGeneration) return;

  buildWalkMap(img);
  buildTraceImage();

  const count = config.dotCount ?? DOT_COUNT;
  dots = spawnDistributed(count);

  if (!paused) {
    rafId = requestAnimationFrame(tick);
  }
}

export function pause() {
  paused = true;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export function resume() {
  paused = false;
  if (walkMap) {
    rafId = requestAnimationFrame(tick);
  }
}

export function destroy() {
  loadGeneration++;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (motionQuery && motionHandler) {
    motionQuery.removeEventListener('change', motionHandler);
  }
  motionQuery = null;
  motionHandler = null;
  reducedMotion = false;
  paused = false;
  opacity = 0;
  activeColor = DEFAULT_COLOR;
  activeDotSpeed = DOT_SPEED;
  walkMap = null;
  walkPositions = [];
  traceImage = null;
  glowSprite = null;
  coreSprite = null;
  spriteScale = 0;
  dots = [];
  canvas = null;
  ctx = null;
}
