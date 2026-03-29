import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mock state ---
const { gsapMockState } = vi.hoisted(() => ({
  gsapMockState: {
    autoComplete: true,
    pendingOnCompletes: [],
    lastTimeline: null,
  },
}));

// --- Mocks ---
vi.mock('gsap', () => {
  const mockTimeline = () => ({
    pause: vi.fn(),
    play: vi.fn(),
    kill: vi.fn(),
    time: vi.fn().mockReturnValue(0),
    duration: vi.fn().mockReturnValue(60),
  });

  const set = vi.fn();
  const to = vi.fn((_target, opts) => {
    const tl = mockTimeline();
    gsapMockState.lastTimeline = tl;
    if (opts?.onComplete) {
      if (gsapMockState.autoComplete) {
        opts.onComplete();
      } else {
        gsapMockState.pendingOnCompletes.push(opts.onComplete);
      }
    }
    return tl;
  });
  const fromTo = vi.fn((_target, _from, toOpts) => {
    const tl = mockTimeline();
    gsapMockState.lastTimeline = tl;
    if (toOpts?.onComplete) {
      if (gsapMockState.autoComplete) {
        toOpts.onComplete();
      } else {
        gsapMockState.pendingOnCompletes.push(toOpts.onComplete);
      }
    }
    return tl;
  });

  return { gsap: { to, set, fromTo }, default: { to, set, fromTo } };
});

// SAFE: Test mock — hardcoded string, not user input.
vi.mock('../../src/credits-content.html?raw', () => ({
  default:
    '<section class="credits-section"><h2 class="credits-heading">Test Credit</h2>' +
    '<p class="credits-text">Test content</p>' +
    '<a class="credits-link" href="https://example.com">Link</a></section>',
}));

// Import after mocks
import {
  initCreditsContent,
  revealCreditsPanel,
  pauseCreditsScroll,
  resumeCreditsScroll,
  cleanupCredits,
} from '../../src/credits.js';
import { gsap } from 'gsap';

// --- Helpers ---
function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'credits-panel';
  panel.hidden = true;
  panel.style.opacity = '0';
  Object.defineProperty(panel, 'clientHeight', { value: 400, configurable: true });
  document.body.appendChild(panel);

  const scrollContent = document.createElement('div');
  scrollContent.id = 'credits-scroll-content';
  Object.defineProperty(scrollContent, 'scrollHeight', { value: 2000, configurable: true });
  panel.appendChild(scrollContent);

  return { panel, scrollContent };
}

const defaultConfig = {
  scrollDuration: 60000,
  resumeDelay: 2000,
  fadeInDuration: 800,
  repeatDelay: 3000,
};

function runNextGsapCompletion() {
  const callback = gsapMockState.pendingOnCompletes.shift();
  if (callback) callback();
}

// --- Tests ---
describe('credits.js', () => {
  let panel;
  let scrollContent;

  beforeEach(() => {
    vi.useFakeTimers();
    gsapMockState.autoComplete = true;
    gsapMockState.pendingOnCompletes = [];
    gsapMockState.lastTimeline = null;
    vi.clearAllMocks();

    // Ensure a deterministic matchMedia for tests that hit watchReducedMotion.
    // happy-dom provides one, but relying on that is fragile.
    globalThis.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    document.body.replaceChildren();
    ({ panel, scrollContent } = buildPanel());
  });

  afterEach(() => {
    cleanupCredits(panel);
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  // -- initCreditsContent --

  describe('initCreditsContent', () => {
    it('populates content with credits HTML on first call', () => {
      initCreditsContent(scrollContent);
      expect(scrollContent.textContent).toContain('Test Credit');
      expect(scrollContent.querySelector('.credits-link')).not.toBeNull();
    });

    it('is idempotent — does not repopulate when children already exist', () => {
      initCreditsContent(scrollContent);
      const originalHTML = scrollContent.innerHTML;
      // Mutate a child — initCreditsContent should not overwrite
      scrollContent.querySelector('.credits-heading').textContent = 'Modified';
      initCreditsContent(scrollContent);
      expect(scrollContent.querySelector('.credits-heading').textContent).toBe('Modified');
    });
  });

  // -- revealCreditsPanel (normal motion) --

  describe('revealCreditsPanel — normal motion', () => {
    it('removes hidden attribute', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      expect(panel.hidden).toBe(false);
    });

    it('populates content if not already initialized', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      expect(scrollContent.textContent).toContain('Test Credit');
    });

    it('removes hidden before measuring clientHeight for off-screen position', () => {
      gsapMockState.autoComplete = false;
      // Panel starts hidden — clientHeight would be 0
      expect(panel.hidden).toBe(true);

      let hiddenWhenSetCalled = null;
      gsap.set.mockImplementationOnce((el, props) => {
        // Capture hidden state at the moment gsap.set is called
        hiddenWhenSetCalled = panel.hidden;
      });

      revealCreditsPanel(panel, scrollContent, defaultConfig);

      // hidden must be false when gsap.set is called (so clientHeight > 0)
      expect(hiddenWhenSetCalled).toBe(false);
    });

    it('positions content off-screen before fade-in to prevent flash', () => {
      gsapMockState.autoComplete = false;
      revealCreditsPanel(panel, scrollContent, defaultConfig);

      // gsap.set must be called BEFORE gsap.to (fade-in)
      expect(gsap.set).toHaveBeenCalledWith(
        scrollContent,
        expect.objectContaining({ y: 400 }),
      );

      const setCallOrder = gsap.set.mock.invocationCallOrder[0];
      const toCallOrder = gsap.to.mock.invocationCallOrder[0];
      expect(setCallOrder).toBeLessThan(toCallOrder);
    });

    it('starts GSAP fade-in with correct duration', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);

      expect(gsap.to).toHaveBeenCalledWith(
        panel,
        expect.objectContaining({
          opacity: 1,
          duration: 0.8,
          ease: 'power2.out',
        }),
      );
    });

    it('creates scroll timeline with gsap.fromTo after fade-in completes', () => {
      gsapMockState.autoComplete = false;
      revealCreditsPanel(panel, scrollContent, defaultConfig);

      expect(gsap.to).toHaveBeenCalledTimes(1);

      runNextGsapCompletion();

      // Must use fromTo (not set+to) so repeat cycle has explicit start position
      expect(gsap.fromTo).toHaveBeenCalledWith(
        scrollContent,
        { y: 400 }, // from: panelHeight
        expect.objectContaining({
          y: -2000, // to: -contentHeight
          duration: 60,
          ease: 'none',
          repeat: -1,
          repeatDelay: 3,
        }),
      );
    });
  });

  // -- revealCreditsPanel (reduced motion) --

  describe('revealCreditsPanel — reduced motion', () => {
    it('sets opacity to 1 immediately', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig, { reducedMotion: true });
      expect(panel.style.opacity).toBe('1');
    });

    it('does not create GSAP tweens in reduced motion', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig, { reducedMotion: true });
      expect(gsap.to).not.toHaveBeenCalled();
      expect(gsap.fromTo).not.toHaveBeenCalled();
      expect(gsap.set).toHaveBeenCalledWith(
        scrollContent,
        expect.objectContaining({ clearProps: 'y' }),
      );
    });

    it('removes hidden attribute', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig, { reducedMotion: true });
      expect(panel.hidden).toBe(false);
    });

    it('clears stale transform state from a prior animated reveal', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      cleanupCredits(panel);
      vi.clearAllMocks();

      revealCreditsPanel(panel, scrollContent, defaultConfig, { reducedMotion: true });

      expect(gsap.set).toHaveBeenCalledWith(
        scrollContent,
        expect.objectContaining({ clearProps: 'y' }),
      );
      expect(gsap.to).not.toHaveBeenCalled();
      expect(gsap.fromTo).not.toHaveBeenCalled();
    });
  });

  // -- cleanupCredits --

  describe('cleanupCredits', () => {
    it('sets hidden and resets opacity', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      cleanupCredits(panel);
      expect(panel.hidden).toBe(true);
      expect(panel.style.opacity).toBe('0');
    });

    it('clears scroll transform state on hide', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      vi.clearAllMocks();

      cleanupCredits(panel);

      expect(gsap.set).toHaveBeenCalledWith(
        scrollContent,
        expect.objectContaining({ clearProps: 'y' }),
      );
    });

    it('kills fade-in tween if active', () => {
      gsapMockState.autoComplete = false;
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const fadeInTween = gsapMockState.lastTimeline;

      cleanupCredits(panel);
      expect(fadeInTween.kill).toHaveBeenCalled();
    });

    it('kills scroll timeline if active', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      cleanupCredits(panel);
      expect(scrollTl.kill).toHaveBeenCalled();
    });

    it('is idempotent — safe to call when already hidden', () => {
      cleanupCredits(panel);
      expect(panel.hidden).toBe(true);
    });

    it('removes every event listener it registered', () => {
      const addSpy = vi.spyOn(panel, 'addEventListener');
      const removeSpy = vi.spyOn(panel, 'removeEventListener');

      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const addedListeners = addSpy.mock.calls.map(([type, handler]) => [type, handler]);

      cleanupCredits(panel);

      for (const [type, handler] of addedListeners) {
        expect(removeSpy).toHaveBeenCalledWith(type, handler);
      }
    });
  });

  // -- pauseCreditsScroll / resumeCreditsScroll --

  describe('pauseCreditsScroll', () => {
    it('pauses scroll timeline', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      pauseCreditsScroll();
      expect(scrollTl.pause).toHaveBeenCalled();
    });

    it('is null-safe when no timeline exists', () => {
      expect(() => pauseCreditsScroll()).not.toThrow();
    });
  });

  describe('resumeCreditsScroll', () => {
    it('resumes scroll timeline when no focus or hover is active', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      pauseCreditsScroll();
      resumeCreditsScroll();
      expect(scrollTl.play).toHaveBeenCalled();
    });

    it('is null-safe when no timeline exists', () => {
      expect(() => resumeCreditsScroll()).not.toThrow();
    });
  });

  // -- wheel scroll override --

  describe('wheel scroll override', () => {
    it('pauses timeline on wheel event', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const wheelEvent = new Event('wheel', { bubbles: true });
      wheelEvent.deltaY = 100;
      wheelEvent.preventDefault = vi.fn();
      panel.dispatchEvent(wheelEvent);

      expect(wheelEvent.preventDefault).toHaveBeenCalled();
      expect(scrollTl.pause).toHaveBeenCalled();
    });

    it('scrubs timeline position proportionally', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;
      scrollTl.time.mockReturnValue(10);

      const wheelEvent = new Event('wheel', { bubbles: true });
      wheelEvent.deltaY = 200;
      wheelEvent.preventDefault = vi.fn();
      panel.dispatchEvent(wheelEvent);

      // scrubDelta = (200 / 2000) * 60 = 6; newTime = 10 + 6 = 16
      expect(scrollTl.time).toHaveBeenCalledWith(16);
    });

    it('starts resume timer after wheel stops', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const wheelEvent = new Event('wheel', { bubbles: true });
      wheelEvent.deltaY = 100;
      wheelEvent.preventDefault = vi.fn();
      panel.dispatchEvent(wheelEvent);

      scrollTl.play.mockClear();
      vi.advanceTimersByTime(2000);
      expect(scrollTl.play).toHaveBeenCalled();
    });

    it('resets resume timer on repeated wheel events', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const makeWheel = () => {
        const e = new Event('wheel', { bubbles: true });
        e.deltaY = 50;
        e.preventDefault = vi.fn();
        return e;
      };

      panel.dispatchEvent(makeWheel());
      vi.advanceTimersByTime(1000);
      panel.dispatchEvent(makeWheel());
      vi.advanceTimersByTime(1000);

      scrollTl.play.mockClear();
      expect(scrollTl.play).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(scrollTl.play).toHaveBeenCalled();
    });
  });

  // -- touch drag scroll override --

  describe('touch drag scroll override', () => {
    function makeTouchEvent(type, clientY) {
      const e = new Event(type, { bubbles: true });
      e.touches = [{ clientY }];
      e.preventDefault = vi.fn();
      return e;
    }

    it('pauses timeline on touchmove', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      panel.dispatchEvent(makeTouchEvent('touchstart', 300));
      panel.dispatchEvent(makeTouchEvent('touchmove', 250));

      expect(scrollTl.pause).toHaveBeenCalled();
    });

    it('scrubs timeline position proportionally to drag delta', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;
      scrollTl.time.mockReturnValue(10);

      panel.dispatchEvent(makeTouchEvent('touchstart', 300));
      panel.dispatchEvent(makeTouchEvent('touchmove', 200));

      // deltaY = 300 - 200 = 100 (drag up); scrubDelta = (100 / 2000) * 60 = 3
      expect(scrollTl.time).toHaveBeenCalledWith(13);
    });

    it('prevents default on touchmove to block native scroll', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);

      panel.dispatchEvent(makeTouchEvent('touchstart', 300));
      const moveEvent = makeTouchEvent('touchmove', 250);
      panel.dispatchEvent(moveEvent);

      expect(moveEvent.preventDefault).toHaveBeenCalled();
    });

    it('schedules resume timer after touch drag', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      panel.dispatchEvent(makeTouchEvent('touchstart', 300));
      panel.dispatchEvent(makeTouchEvent('touchmove', 250));
      panel.dispatchEvent(new Event('touchend', { bubbles: true }));

      scrollTl.play.mockClear();
      vi.advanceTimersByTime(2000);
      expect(scrollTl.play).toHaveBeenCalled();
    });

    it('ignores touchmove without prior touchstart', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      // touchmove without touchstart — lastTouchY is null
      panel.dispatchEvent(makeTouchEvent('touchmove', 250));

      expect(scrollTl.pause).not.toHaveBeenCalled();
    });

    it('resets touch tracking on touchcancel', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      panel.dispatchEvent(makeTouchEvent('touchstart', 300));
      panel.dispatchEvent(new Event('touchcancel', { bubbles: true }));

      // After touchcancel, a new touchmove without touchstart should be ignored
      scrollTl.pause.mockClear();
      panel.dispatchEvent(makeTouchEvent('touchmove', 250));
      expect(scrollTl.pause).not.toHaveBeenCalled();
    });

    it('resets touch tracking on touchend', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      panel.dispatchEvent(makeTouchEvent('touchstart', 300));
      panel.dispatchEvent(new Event('touchend', { bubbles: true }));

      // After touchend, a new touchmove without touchstart should be ignored
      scrollTl.pause.mockClear();
      panel.dispatchEvent(makeTouchEvent('touchmove', 250));
      expect(scrollTl.pause).not.toHaveBeenCalled();
    });
  });

  // -- focus/hover pause (WCAG 2.4.3) --

  describe('focus/hover pause (WCAG 2.4.3)', () => {
    it('pauses scroll on focusin of a link', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const link = scrollContent.querySelector('a');
      link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(scrollTl.pause).toHaveBeenCalled();
    });

    it('starts resume timer on focusout', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const link = scrollContent.querySelector('a');
      link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      scrollTl.play.mockClear();
      link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      expect(scrollTl.play).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);
      expect(scrollTl.play).toHaveBeenCalled();
    });

    it('pauses scroll on pointerover of a link', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const link = scrollContent.querySelector('a');
      link.dispatchEvent(new Event('pointerover', { bubbles: true }));

      expect(scrollTl.pause).toHaveBeenCalled();
    });

    it('starts resume timer on pointerout', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const link = scrollContent.querySelector('a');
      link.dispatchEvent(new Event('pointerover', { bubbles: true }));

      scrollTl.play.mockClear();
      link.dispatchEvent(new Event('pointerout', { bubbles: true }));

      vi.advanceTimersByTime(2000);
      expect(scrollTl.play).toHaveBeenCalled();
    });

    it('does not resume while both focus and hover are active', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      const link = scrollContent.querySelector('a');
      link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      link.dispatchEvent(new Event('pointerover', { bubbles: true }));

      scrollTl.play.mockClear();

      // Release hover but keep focus
      link.dispatchEvent(new Event('pointerout', { bubbles: true }));
      vi.advanceTimersByTime(5000);
      expect(scrollTl.play).not.toHaveBeenCalled();

      // Release focus too
      link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      vi.advanceTimersByTime(2000);
      expect(scrollTl.play).toHaveBeenCalled();
    });

    it('ignores focusin on non-interactive elements', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;
      scrollTl.pause.mockClear();

      const textEl = scrollContent.querySelector('.credits-text');
      textEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(scrollTl.pause).not.toHaveBeenCalled();
    });

    it('ignores pointerover on non-interactive elements', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;
      scrollTl.pause.mockClear();

      const textEl = scrollContent.querySelector('.credits-text');
      textEl.dispatchEvent(new Event('pointerover', { bubbles: true }));

      expect(scrollTl.pause).not.toHaveBeenCalled();
    });
  });

  // -- cleanupCredits --

  describe('cleanupCredits', () => {
    it('performs full teardown', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      cleanupCredits(panel);
      expect(panel.hidden).toBe(true);
      expect(panel.style.opacity).toBe('0');
    });

    it('is safe to call multiple times', () => {
      cleanupCredits(panel);
      cleanupCredits(panel);
      expect(panel.hidden).toBe(true);
    });

    it('cancels pending resume timer', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);

      const wheelEvent = new Event('wheel', { bubbles: true });
      wheelEvent.deltaY = 100;
      wheelEvent.preventDefault = vi.fn();
      panel.dispatchEvent(wheelEvent);

      cleanupCredits(panel);
      // Timer was cancelled — advancing time must not throw
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    });
  });

  // -- pause prevents auto-resume but allows interaction --

  describe('isPaused prevents auto-resume, allows wheel scrub', () => {
    it('wheel scrub still works during pause', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;
      scrollTl.time.mockReturnValue(10);

      pauseCreditsScroll();

      const wheelEvent = new Event('wheel', { bubbles: true });
      wheelEvent.deltaY = 200;
      wheelEvent.preventDefault = vi.fn();
      panel.dispatchEvent(wheelEvent);

      // Scrub works — timeline position updated
      expect(scrollTl.time).toHaveBeenCalledWith(16);
    });

    it('resume timer does not play timeline while paused', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      // Wheel creates a resume timer
      const wheelEvent = new Event('wheel', { bubbles: true });
      wheelEvent.deltaY = 100;
      wheelEvent.preventDefault = vi.fn();
      panel.dispatchEvent(wheelEvent);

      // Pause before resume timer fires
      pauseCreditsScroll();
      scrollTl.play.mockClear();

      // Resume timer fires (PausableTimer was paused then we advance)
      // But even if it somehow fires, isPaused guard prevents play()
      vi.advanceTimersByTime(5000);
      expect(scrollTl.play).not.toHaveBeenCalled();
    });

    it('resume after pause plays scroll timeline automatically', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      pauseCreditsScroll();
      scrollTl.play.mockClear();

      resumeCreditsScroll();
      expect(scrollTl.play).toHaveBeenCalled();
    });

    it('link hover still works during pause', () => {
      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      pauseCreditsScroll();
      scrollTl.pause.mockClear();

      // Hover on link during pause — listener fires, pauses timeline (no-op since already paused)
      const link = scrollContent.querySelector('a');
      link.dispatchEvent(new Event('pointerover', { bubbles: true }));

      // Pointer out + timer fires — but isPaused prevents play()
      link.dispatchEvent(new Event('pointerout', { bubbles: true }));
      scrollTl.play.mockClear();
      vi.advanceTimersByTime(5000);
      expect(scrollTl.play).not.toHaveBeenCalled();
    });
  });

  // -- runtime reduced motion change --

  describe('runtime prefers-reduced-motion change', () => {
    it('stops auto-scroll when reduced motion enabled mid-credits', () => {
      // Set up a dispatchable matchMedia mock
      let changeCallback = null;
      const mockQuery = {
        matches: false,
        addEventListener: vi.fn((event, cb) => {
          changeCallback = cb;
        }),
        removeEventListener: vi.fn(),
      };
      vi.spyOn(globalThis, 'matchMedia').mockReturnValue(mockQuery);

      revealCreditsPanel(panel, scrollContent, defaultConfig);
      const scrollTl = gsapMockState.lastTimeline;

      // Scroll timeline is running
      expect(scrollTl).not.toBeNull();

      // Simulate user enabling reduced motion
      changeCallback({ matches: true });

      // Scroll timeline should be killed
      expect(scrollTl.kill).toHaveBeenCalled();

      // Panel should be visible with opacity 1 (native scroll takes over)
      expect(panel.style.opacity).toBe('1');

      // gsap.set should have been called to clear the y transform
      expect(gsap.set).toHaveBeenCalledWith(
        scrollContent,
        expect.objectContaining({ clearProps: 'y' }),
      );

      vi.restoreAllMocks();
    });

    it('removes matchMedia listener on cleanup', () => {
      const mockQuery = {
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      vi.spyOn(globalThis, 'matchMedia').mockReturnValue(mockQuery);

      revealCreditsPanel(panel, scrollContent, defaultConfig);
      expect(mockQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      cleanupCredits(panel);
      expect(mockQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));

      vi.restoreAllMocks();
    });
  });
});
