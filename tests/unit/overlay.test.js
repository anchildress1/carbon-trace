import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initOverlay, updateProgress, showControls, focusActiveDot } from '../../src/overlay.js';

describe('overlay.js', () => {
  let dotsContainer;
  let controlsEl;

  beforeEach(() => {
    document.body.replaceChildren();

    dotsContainer = document.createElement('div');
    dotsContainer.id = 'progress-dots';
    document.body.appendChild(dotsContainer);

    controlsEl = document.createElement('div');
    controlsEl.id = 'overlay-controls';
    controlsEl.hidden = true;
    document.body.appendChild(controlsEl);
  });

  describe('initOverlay', () => {
    it('creates the correct number of dots', () => {
      initOverlay(10);

      expect(dotsContainer.children.length).toBe(10);
    });

    it('creates dots with progress-dot class', () => {
      initOverlay(5);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots.length).toBe(5);
    });

    it('sets aria-label on each dot', () => {
      initOverlay(3);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[0].getAttribute('aria-label')).toBe('Go to scene 1 of 3');
      expect(dots[2].getAttribute('aria-label')).toBe('Go to scene 3 of 3');
    });

    it('sets data-scene-index and title on each dot', () => {
      initOverlay(3);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[0].dataset.sceneIndex).toBe('1');
      expect(dots[2].dataset.sceneIndex).toBe('3');
      expect(dots[0].getAttribute('title')).toBe('Scene 1 of 3');
      expect(dots[2].getAttribute('title')).toBe('Scene 3 of 3');
    });

    it('clears existing dots before creating new ones', () => {
      initOverlay(5);
      initOverlay(3);

      expect(dotsContainer.children.length).toBe(3);
    });

    it('handles zero scenes', () => {
      initOverlay(0);

      expect(dotsContainer.children.length).toBe(0);
    });

    it('calls onDotClick with scene index when dot is clicked', () => {
      const onClick = vi.fn();
      initOverlay(3, onClick);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      dots[1].click();

      expect(onClick).toHaveBeenCalledWith(2);
    });

    it('creates dots as button elements', () => {
      initOverlay(3);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[0].tagName).toBe('BUTTON');
    });

    it('returns early when progress-dots container is missing', () => {
      dotsContainer.remove();

      expect(() => initOverlay(5)).not.toThrow();
    });

    it('creates dots without click handler when onDotClick is omitted', () => {
      initOverlay(3);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(() => dots[0].click()).not.toThrow();
    });
  });

  describe('updateProgress', () => {
    it('marks dots as active up to the current scene index', () => {
      initOverlay(5);
      updateProgress(3);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[0].classList.contains('active')).toBe(true);
      expect(dots[1].classList.contains('active')).toBe(true);
      expect(dots[2].classList.contains('active')).toBe(true);
      expect(dots[3].classList.contains('active')).toBe(false);
      expect(dots[4].classList.contains('active')).toBe(false);
    });

    it('marks no dots active when sceneIndex is 0', () => {
      initOverlay(5);
      updateProgress(0);

      const activeDots = dotsContainer.querySelectorAll('.active');
      expect(activeDots.length).toBe(0);
    });

    it('marks all dots active when at last scene', () => {
      initOverlay(3);
      updateProgress(3);

      const activeDots = dotsContainer.querySelectorAll('.active');
      expect(activeDots.length).toBe(3);
    });

    it('sets aria-current="step" on the current dot', () => {
      initOverlay(5);
      updateProgress(3);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[2].getAttribute('aria-current')).toBe('step');
      expect(dots[1].hasAttribute('aria-current')).toBe(false);
      expect(dots[3].hasAttribute('aria-current')).toBe(false);
    });

    it('moves aria-current when progress updates', () => {
      initOverlay(5);
      updateProgress(2);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[1].getAttribute('aria-current')).toBe('step');

      updateProgress(4);
      expect(dots[1].hasAttribute('aria-current')).toBe(false);
      expect(dots[3].getAttribute('aria-current')).toBe('step');
    });

    it('removes aria-current from all dots when sceneIndex is 0', () => {
      initOverlay(3);
      updateProgress(2);
      updateProgress(0);

      const current = dotsContainer.querySelectorAll('[aria-current]');
      expect(current.length).toBe(0);
    });
  });

  describe('updateProgress — edge cases', () => {
    it('handles being called before initOverlay without throwing', () => {
      expect(() => updateProgress(3)).not.toThrow();
    });

    it('handles sceneIndex beyond total dot count', () => {
      initOverlay(3);
      updateProgress(10);

      const activeDots = dotsContainer.querySelectorAll('.active');
      expect(activeDots.length).toBe(3);
    });
  });

  describe('showControls', () => {
    it('shows the overlay controls', () => {
      showControls();

      expect(controlsEl.hidden).toBe(false);
    });

    it('handles missing overlay-controls element gracefully', () => {
      controlsEl.remove();

      expect(() => showControls()).not.toThrow();
    });
  });

  describe('focusActiveDot', () => {
    it('focuses the current active dot', () => {
      initOverlay(5);
      updateProgress(3);

      focusActiveDot();

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(document.activeElement).toBe(dots[2]);
    });

    it('does nothing when called before initOverlay', () => {
      expect(() => focusActiveDot()).not.toThrow();
    });

    it('does nothing when sceneIndex is 0', () => {
      initOverlay(3);
      // sceneIndex never set (still -1 internally)
      focusActiveDot();
      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(document.activeElement).not.toBe(dots[0]);
    });

    it('focuses the updated dot after progress change', () => {
      initOverlay(5);
      updateProgress(2);
      updateProgress(4);

      focusActiveDot();

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(document.activeElement).toBe(dots[3]);
    });

    it('updates roving tabindex target to focused dot', () => {
      initOverlay(5);
      updateProgress(3);

      focusActiveDot();

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[2].getAttribute('tabindex')).toBe('0');
      expect(dots[0].getAttribute('tabindex')).toBe('-1');
      expect(dots[4].getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('roving tabindex', () => {
    function pressKey(container, key) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true });
      vi.spyOn(e, 'stopPropagation');
      vi.spyOn(e, 'preventDefault');
      container.dispatchEvent(e);
      return e;
    }

    it('first dot gets tabindex="0", rest get tabindex="-1"', () => {
      initOverlay(5);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[0].getAttribute('tabindex')).toBe('0');
      expect(dots[1].getAttribute('tabindex')).toBe('-1');
      expect(dots[4].getAttribute('tabindex')).toBe('-1');
    });

    it('ArrowRight moves focus to next dot and updates tabindex', () => {
      initOverlay(5);
      const dots = dotsContainer.querySelectorAll('.progress-dot');
      dots[0].focus();

      pressKey(dotsContainer, 'ArrowRight');

      expect(document.activeElement).toBe(dots[1]);
      expect(dots[0].getAttribute('tabindex')).toBe('-1');
      expect(dots[1].getAttribute('tabindex')).toBe('0');
    });

    it('ArrowLeft moves focus to previous dot', () => {
      initOverlay(5);
      const dots = dotsContainer.querySelectorAll('.progress-dot');
      // Move to dot 2 first
      dots[0].focus();
      pressKey(dotsContainer, 'ArrowRight');

      pressKey(dotsContainer, 'ArrowLeft');

      expect(document.activeElement).toBe(dots[0]);
      expect(dots[0].getAttribute('tabindex')).toBe('0');
    });

    it('ArrowRight wraps from last dot to first', () => {
      initOverlay(3);
      const dots = dotsContainer.querySelectorAll('.progress-dot');

      // Navigate to last dot
      pressKey(dotsContainer, 'ArrowRight');
      pressKey(dotsContainer, 'ArrowRight');
      expect(document.activeElement).toBe(dots[2]);

      // Wrap around
      pressKey(dotsContainer, 'ArrowRight');
      expect(document.activeElement).toBe(dots[0]);
      expect(dots[0].getAttribute('tabindex')).toBe('0');
    });

    it('ArrowLeft wraps from first dot to last', () => {
      initOverlay(3);
      const dots = dotsContainer.querySelectorAll('.progress-dot');

      pressKey(dotsContainer, 'ArrowLeft');

      expect(document.activeElement).toBe(dots[2]);
      expect(dots[2].getAttribute('tabindex')).toBe('0');
    });

    it('Home moves focus to first dot', () => {
      initOverlay(5);
      const dots = dotsContainer.querySelectorAll('.progress-dot');
      pressKey(dotsContainer, 'ArrowRight');
      pressKey(dotsContainer, 'ArrowRight');

      pressKey(dotsContainer, 'Home');

      expect(document.activeElement).toBe(dots[0]);
      expect(dots[0].getAttribute('tabindex')).toBe('0');
    });

    it('End moves focus to last dot', () => {
      initOverlay(5);
      const dots = dotsContainer.querySelectorAll('.progress-dot');

      pressKey(dotsContainer, 'End');

      expect(document.activeElement).toBe(dots[4]);
      expect(dots[4].getAttribute('tabindex')).toBe('0');
    });

    it('ArrowDown behaves like ArrowRight', () => {
      initOverlay(3);
      const dots = dotsContainer.querySelectorAll('.progress-dot');

      pressKey(dotsContainer, 'ArrowDown');

      expect(document.activeElement).toBe(dots[1]);
    });

    it('ArrowUp behaves like ArrowLeft', () => {
      initOverlay(3);
      const dots = dotsContainer.querySelectorAll('.progress-dot');

      pressKey(dotsContainer, 'ArrowUp');

      expect(document.activeElement).toBe(dots[2]);
    });

    it('arrow keys call stopPropagation to prevent global nav', () => {
      initOverlay(3);

      const e = pressKey(dotsContainer, 'ArrowRight');

      expect(e.stopPropagation).toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('unhandled keys do not call stopPropagation', () => {
      initOverlay(3);

      const e = pressKey(dotsContainer, 'Tab');

      expect(e.stopPropagation).not.toHaveBeenCalled();
    });

    it('Space and Enter are not intercepted (native button activation)', () => {
      initOverlay(3);

      const eSpace = pressKey(dotsContainer, ' ');
      const eEnter = pressKey(dotsContainer, 'Enter');

      expect(eSpace.stopPropagation).not.toHaveBeenCalled();
      expect(eEnter.stopPropagation).not.toHaveBeenCalled();
    });

    it('handles zero dots without error', () => {
      initOverlay(0);

      expect(() => pressKey(dotsContainer, 'ArrowRight')).not.toThrow();
    });
  });
});
