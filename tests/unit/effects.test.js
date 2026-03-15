import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('gsap', () => ({
  gsap: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

import { runEffect, clearEffects, effectExists } from '../../src/effects.js';
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

    it('runs dust-settle effect and creates particles', () => {
      runEffect('dust-settle', container);

      expect(container.children.length).toBe(10);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('runs water-run effect and creates stream element', () => {
      runEffect('water-run', container);

      expect(container.children.length).toBe(1);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('warns for unknown effect name', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      runEffect('nonexistent', container);

      expect(gsap.to).not.toHaveBeenCalled();
      expect(gsap.fromTo).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('Unknown effect: "nonexistent"');
      warnSpy.mockRestore();
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

  describe('effectExists', () => {
    it('returns true for registered effects', () => {
      expect(effectExists('dust-drift')).toBe(true);
      expect(effectExists('fade-in')).toBe(true);
      expect(effectExists('machine-steady')).toBe(true);
    });

    it('returns false for unknown effects', () => {
      expect(effectExists('nonexistent')).toBe(false);
      expect(effectExists('')).toBe(false);
    });
  });
});
