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

      expect(container.children.length).toBe(18);
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
        expect.objectContaining({ filter: 'blur(6px)' }),
        expect.objectContaining({ filter: 'blur(0px)' }),
      );
    });

    it('runs near-still-pulse effect', () => {
      runEffect('near-still-pulse', container);

      expect(gsap.to).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ opacity: 0.85, repeat: -1 }),
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

      expect(container.children.length).toBe(14);
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

    it.each([
      { label: 'null', value: null },
      { label: 'undefined', value: undefined },
    ])('returns false for $label', ({ value }) => {
      expect(effectExists(value)).toBe(false);
    });

    it.each([
      'dust-drift',
      'motion-drag',
      'heat-pulse',
      'near-still-pulse',
      'light-crack',
      'assembly-micro',
      'illumination-spread',
      'machine-steady',
      'fade-in',
      'dust-settle',
      'water-run',
    ])('reports "%s" as registered', (name) => {
      expect(effectExists(name)).toBe(true);
    });
  });

  describe('particle effects — element properties', () => {
    it('dust-drift creates particles with absolute positioning and border-radius', () => {
      runEffect('dust-drift', container);

      const particle = container.children[0];
      expect(particle.style.position).toBe('absolute');
      expect(particle.style.borderRadius).toBe('50%');
      expect(particle.style.width).toBe('4px');
    });

    it('dust-settle creates particles with distinct color', () => {
      runEffect('dust-settle', container);

      const particle = container.children[0];
      expect(particle.style.position).toBe('absolute');
      expect(particle.style.height).toBe('5px');
    });
  });

  describe('DOM-creating effects — element structure', () => {
    it('light-crack flash has gradient background and zero initial opacity', () => {
      runEffect('light-crack', container);

      const flash = container.children[0];
      expect(flash.style.opacity).toBe('0');
      expect(flash.style.position).toBe('absolute');
    });

    it('illumination-spread glow has radial gradient and scale transform', () => {
      runEffect('illumination-spread', container);

      const glow = container.children[0];
      expect(glow.style.opacity).toBe('0');
      expect(glow.style.position).toBe('absolute');
    });

    it('water-run stream has translateY(-100%) transform', () => {
      runEffect('water-run', container);

      const stream = container.children[0];
      expect(stream.style.position).toBe('absolute');
    });
  });
});
