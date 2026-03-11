import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('gsap', () => ({
  gsap: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

import { runEffect, clearEffects } from '../../src/effects.js';
import { gsap } from 'gsap';

describe('effects.js', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    vi.clearAllMocks();
  });

  describe('runEffect', () => {
    it('runs dust-drift effect and creates particles', () => {
      runEffect('dust-drift', container);

      expect(container.children.length).toBe(12);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('runs heat-pulse effect', () => {
      runEffect('heat-pulse', container);

      expect(gsap.to).toHaveBeenCalledWith(
        container,
        expect.objectContaining({
          repeat: -1,
          yoyo: true,
        }),
      );
    });

    it('runs motion-drag effect', () => {
      runEffect('motion-drag', container);

      expect(gsap.fromTo).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ filter: 'blur(2px)' }),
        expect.objectContaining({ filter: 'blur(0px)' }),
      );
    });

    it('runs water-clarity effect', () => {
      runEffect('water-clarity', container);

      expect(gsap.fromTo).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ filter: 'blur(3px)' }),
        expect.objectContaining({ filter: 'blur(0px)' }),
      );
    });

    it('runs near-still-pulse effect', () => {
      runEffect('near-still-pulse', container);

      expect(gsap.to).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ opacity: 0.97, repeat: -1 }),
      );
    });

    it('runs light-crack effect and creates flash element', () => {
      runEffect('light-crack', container);

      expect(container.children.length).toBe(1);
      expect(gsap.fromTo).toHaveBeenCalled();
    });

    it('runs assembly-micro effect', () => {
      runEffect('assembly-micro', container);

      expect(gsap.to).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ repeat: -1 }),
      );
    });

    it('runs illumination-spread effect', () => {
      runEffect('illumination-spread', container);

      expect(container.children.length).toBe(1);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('runs room-carry effect', () => {
      runEffect('room-carry', container);

      expect(container.children.length).toBe(1);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('runs machine-steady effect', () => {
      runEffect('machine-steady', container);

      expect(gsap.to).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ repeat: -1, yoyo: true }),
      );
    });

    it('runs fade-in effect', () => {
      runEffect('fade-in', container);

      expect(gsap.fromTo).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ opacity: 0 }),
        expect.objectContaining({ opacity: 1 }),
      );
    });

    it('does nothing for unknown effect name', () => {
      runEffect('nonexistent', container);

      expect(gsap.to).not.toHaveBeenCalled();
      expect(gsap.fromTo).not.toHaveBeenCalled();
    });
  });

  describe('clearEffects', () => {
    it('kills GSAP tweens on container and children', () => {
      container.appendChild(document.createElement('div'));

      clearEffects(container);

      expect(gsap.killTweensOf).toHaveBeenCalledWith(container);
      expect(gsap.killTweensOf).toHaveBeenCalledWith(container.children);
    });

    it('removes all children from container', () => {
      container.appendChild(document.createElement('div'));
      container.appendChild(document.createElement('div'));

      clearEffects(container);

      expect(container.children.length).toBe(0);
    });

    it('resets GSAP inline styles', () => {
      clearEffects(container);

      expect(gsap.set).toHaveBeenCalledWith(container, { clearProps: 'all' });
    });

    it('handles empty container', () => {
      expect(() => clearEffects(container)).not.toThrow();
    });
  });
});
