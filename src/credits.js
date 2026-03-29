import { gsap } from 'gsap';
import { PausableTimer } from './pausable-timer.js';
// Static build-time import — content is a compile-time constant from a local
// file, not user-controlled input. Safe for innerHTML assignment.
import creditsHtml from './credits-content.html?raw';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Module state
let scrollTimeline = null;
let fadeInTween = null;
let scrollResumeTimer = null;
let focusedLink = null;
let hoveredLink = false;
let contentInitialized = false;
let isPaused = false;

// Event handler refs (for cleanup)
let wheelHandler = null;
let pointeroverHandler = null;
let pointeroutHandler = null;
let focusinHandler = null;
let focusoutHandler = null;
let motionQuery = null;
let motionHandler = null;

function clearScrollTransform(scrollContentEl) {
  if (!scrollContentEl) return;
  gsap.set(scrollContentEl, { clearProps: 'y' });
}

/**
 * Populate the scroll content container with credits HTML.
 * Idempotent — no-op if content is already populated.
 */
export function initCreditsContent(scrollContentEl) {
  if (contentInitialized) return;
  // SAFE: creditsHtml is a static build-time import (credits-content.html?raw),
  // not user-controlled input — no XSS risk.
  scrollContentEl.innerHTML = creditsHtml; // NOSONAR
  contentInitialized = true;
}

/**
 * Reveal the credits panel with a fade-in and start auto-scrolling.
 *
 * @param {HTMLElement} panelEl - The #credits-panel container
 * @param {HTMLElement} scrollContentEl - The #credits-scroll-content inner container
 * @param {object} config - Credits config from scenes.json
 * @param {number} config.scrollDuration - Total scroll cycle duration (ms)
 * @param {number} config.resumeDelay - Idle delay before auto-scroll resumes after manual interaction (ms)
 * @param {number} config.fadeInDuration - Panel fade-in duration (ms)
 * @param {number} config.repeatDelay - Pause at loop restart point (ms)
 * @param {object} opts
 * @param {boolean} opts.reducedMotion - Whether prefers-reduced-motion is active
 */
export function revealCreditsPanel(panelEl, scrollContentEl, config, opts = {}) {
  initCreditsContent(scrollContentEl);

  // Remove hidden FIRST so clientHeight is measurable —
  // hidden = display:none = clientHeight 0. Panel is still opacity:0
  // from CSS so nothing is visually revealed yet.
  panelEl.hidden = false;
  clearScrollTransform(scrollContentEl);

  if (opts.reducedMotion) {
    panelEl.style.opacity = '1';
    // Content stays at natural position — CSS overflow-y:auto handles scroll
    return;
  }

  // Position content below the visible area AFTER hidden is removed
  // so clientHeight returns a real value. Prevents flash of full text.
  gsap.set(scrollContentEl, { y: panelEl.clientHeight });

  fadeInTween = gsap.to(panelEl, {
    opacity: 1,
    duration: config.fadeInDuration / 1000,
    ease: 'power2.out',
    onComplete: () => {
      fadeInTween = null;
      startAutoScroll(panelEl, scrollContentEl, config);
    },
  });
}

function startAutoScroll(panelEl, scrollContentEl, config) {
  const contentHeight = scrollContentEl.scrollHeight;
  const panelHeight = panelEl.clientHeight;

  // fromTo ensures the repeat cycle has an explicit start position —
  // gsap.to() with repeat can lose the start value on loop restart.
  scrollTimeline = gsap.fromTo(
    scrollContentEl,
    { y: panelHeight },
    {
      y: -contentHeight,
      duration: config.scrollDuration / 1000,
      ease: 'none',
      repeat: -1,
      repeatDelay: config.repeatDelay / 1000,
    },
  );

  attachScrollListeners(panelEl, scrollContentEl, config);
  watchReducedMotion(panelEl, scrollContentEl);
}

function watchReducedMotion(panelEl, scrollContentEl) {
  motionQuery = globalThis.matchMedia(REDUCED_MOTION_QUERY);
  motionHandler = (e) => {
    if (!e.matches || !scrollTimeline) return;
    // User enabled reduced motion mid-credits — kill auto-scroll,
    // reset content to natural position for native scroll.
    scrollTimeline.kill();
    scrollTimeline = null;
    scrollResumeTimer?.cancel();
    scrollResumeTimer = null;
    removeScrollListeners(panelEl);
    gsap.set(scrollContentEl, { clearProps: 'y' });
    panelEl.style.opacity = '1';
  };
  motionQuery.addEventListener('change', motionHandler);
}

function attachScrollListeners(panelEl, scrollContentEl, config) {
  wheelHandler = (e) => {
    e.preventDefault();
    if (!scrollTimeline) return;
    scrollTimeline.pause();
    const totalDuration = scrollTimeline.duration();
    const currentTime = scrollTimeline.time();
    const scrubDelta = (e.deltaY / scrollContentEl.scrollHeight) * totalDuration;
    scrollTimeline.time(Math.max(0, Math.min(totalDuration, currentTime + scrubDelta)));
    scheduleScrollResume(config.resumeDelay);
  };

  focusinHandler = (e) => {
    if (e.target.closest('a, button')) {
      focusedLink = e.target;
      scrollTimeline?.pause();
      scrollResumeTimer?.cancel();
      scrollResumeTimer = null;
    }
  };

  focusoutHandler = (e) => {
    if (e.target === focusedLink) {
      focusedLink = null;
      if (!hoveredLink) {
        scheduleScrollResume(config.resumeDelay);
      }
    }
  };

  pointeroverHandler = (e) => {
    if (e.target.closest('a, button')) {
      hoveredLink = true;
      scrollTimeline?.pause();
      scrollResumeTimer?.cancel();
      scrollResumeTimer = null;
    }
  };

  pointeroutHandler = (e) => {
    if (e.target.closest('a, button')) {
      hoveredLink = false;
      if (!focusedLink) {
        scheduleScrollResume(config.resumeDelay);
      }
    }
  };

  panelEl.addEventListener('wheel', wheelHandler, { passive: false });
  panelEl.addEventListener('focusin', focusinHandler);
  panelEl.addEventListener('focusout', focusoutHandler);
  panelEl.addEventListener('pointerover', pointeroverHandler);
  panelEl.addEventListener('pointerout', pointeroutHandler);
}

function scheduleScrollResume(delay) {
  scrollResumeTimer?.cancel();
  scrollResumeTimer = new PausableTimer(() => {
    scrollResumeTimer = null;
    if (!isPaused && !focusedLink && !hoveredLink) {
      scrollTimeline?.play();
    }
  }, delay);
}

function removeScrollListeners(panelEl) {
  if (wheelHandler) {
    panelEl.removeEventListener('wheel', wheelHandler);
    wheelHandler = null;
  }
  if (focusinHandler) {
    panelEl.removeEventListener('focusin', focusinHandler);
    focusinHandler = null;
  }
  if (focusoutHandler) {
    panelEl.removeEventListener('focusout', focusoutHandler);
    focusoutHandler = null;
  }
  if (pointeroverHandler) {
    panelEl.removeEventListener('pointerover', pointeroverHandler);
    pointeroverHandler = null;
  }
  if (pointeroutHandler) {
    panelEl.removeEventListener('pointerout', pointeroutHandler);
    pointeroutHandler = null;
  }
}

/**
 * Hide the credits panel and tear down all animation state.
 */
export function hideCreditsPanel(panelEl) {
  const scrollContentEl = panelEl.querySelector('#credits-scroll-content');

  fadeInTween?.kill();
  fadeInTween = null;

  scrollTimeline?.kill();
  scrollTimeline = null;

  scrollResumeTimer?.cancel();
  scrollResumeTimer = null;

  focusedLink = null;
  hoveredLink = false;
  isPaused = false;

  contentInitialized = false;

  removeScrollListeners(panelEl);

  if (motionQuery && motionHandler) {
    motionQuery.removeEventListener('change', motionHandler);
    motionQuery = null;
    motionHandler = null;
  }

  clearScrollTransform(scrollContentEl);
  panelEl.hidden = true;
  panelEl.style.opacity = '0';
}

/**
 * Pause the credits scroll timeline (called from app doPause).
 * Matches shimmer.js/effects-canvas.js pattern: single isPaused flag
 * checked in scheduleScrollResume callback to prevent auto-resume
 * while paused. All listeners stay attached — wheel scrubbing and
 * link hover/focus still work during pause.
 */
export function pauseCreditsScroll() {
  isPaused = true;
  scrollTimeline?.pause();
  scrollResumeTimer?.pause();
}

/**
 * Resume the credits scroll timeline (called from app doResume).
 */
export function resumeCreditsScroll() {
  isPaused = false;
  scrollResumeTimer?.resume();
  if (!scrollResumeTimer && !focusedLink && !hoveredLink) {
    scrollTimeline?.play();
  }
}

/**
 * Full teardown — alias for hideCreditsPanel. Safe to call multiple times.
 */
export function cleanupCredits(panelEl) {
  hideCreditsPanel(panelEl);
}
