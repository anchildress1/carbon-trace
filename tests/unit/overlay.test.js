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

    it('marks each dot as aria-hidden', () => {
      initOverlay(3);

      const dots = dotsContainer.querySelectorAll('.progress-dot');
      expect(dots[0].getAttribute('aria-hidden')).toBe('true');
      expect(dots[2].getAttribute('aria-hidden')).toBe('true');
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

  describe('showControls', () => {
    it('shows the overlay controls', () => {
      showControls();

      expect(controlsEl.hidden).toBe(false);
    });
  });
});
