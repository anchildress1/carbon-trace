import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initOverlay, updateProgress, showControls } from '../../src/overlay.js';

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
});
