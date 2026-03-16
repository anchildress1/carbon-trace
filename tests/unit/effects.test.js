import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('gsap', () => ({
  gsap: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    getTweensOf: vi.fn(() => []),
  },
}));

import { runEffect, clearEffects, effectExists } from '../../src/effects.js';
import { gsap } from 'gsap';

describe('effects.js', () => {
  let overlay;
  let scene;

  beforeEach(() => {
    overlay = document.createElement('div');
    scene = document.createElement('img');
    vi.clearAllMocks();
  });

  describe('runEffect', () => {
    it('runs dust-drift effect and creates particles in overlay', () => {
      runEffect('dust-drift', overlay, scene);

      expect(overlay.children.length).toBe(18);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('runs heat-pulse effect on scene element', () => {
      runEffect('heat-pulse', overlay, scene);

      expect(gsap.to).toHaveBeenCalledWith(
        scene,
        expect.objectContaining({
          repeat: -1,
          yoyo: true,
        }),
      );
    });

    it('runs motion-drag effect on scene element', () => {
      runEffect('motion-drag', overlay, scene);

      expect(gsap.fromTo).toHaveBeenCalledWith(
        scene,
        expect.objectContaining({ filter: 'blur(6px)' }),
        expect.objectContaining({ filter: 'blur(0px)' }),
      );
    });

    it('runs near-still-pulse effect on scene element', () => {
      runEffect('near-still-pulse', overlay, scene);

      expect(gsap.to).toHaveBeenCalledWith(
        scene,
        expect.objectContaining({ filter: 'brightness(0.85)', repeat: -1 }),
      );
    });

    it('runs light-crack effect and creates flash element in overlay', () => {
      runEffect('light-crack', overlay, scene);

      expect(overlay.children.length).toBe(1);
      expect(gsap.fromTo).toHaveBeenCalled();
    });

    it('runs assembly-micro effect on scene element', () => {
      runEffect('assembly-micro', overlay, scene);

      expect(gsap.to).toHaveBeenCalledWith(
        scene,
        expect.objectContaining({ repeat: -1 }),
      );
    });

    it('runs illumination-spread effect and creates glow in overlay', () => {
      runEffect('illumination-spread', overlay, scene);

      expect(overlay.children.length).toBe(1);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('runs machine-steady effect on scene element', () => {
      runEffect('machine-steady', overlay, scene);

      expect(gsap.to).toHaveBeenCalledWith(
        scene,
        expect.objectContaining({ filter: 'brightness(0.85)', repeat: -1, yoyo: true }),
      );
    });

    it('runs fade-in effect on overlay element', () => {
      runEffect('fade-in', overlay, scene);

      expect(gsap.fromTo).toHaveBeenCalledWith(
        overlay,
        expect.objectContaining({ opacity: 0 }),
        expect.objectContaining({ opacity: 1 }),
      );
    });

    it('runs dust-settle effect and creates particles in overlay', () => {
      runEffect('dust-settle', overlay, scene);

      expect(overlay.children.length).toBe(14);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('runs water-run effect and creates stream element in overlay', () => {
      runEffect('water-run', overlay, scene);

      expect(overlay.children.length).toBe(1);
      expect(gsap.to).toHaveBeenCalled();
    });

    it('warns for unknown effect name', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      runEffect('nonexistent', overlay, scene);

      expect(gsap.to).not.toHaveBeenCalled();
      expect(gsap.fromTo).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('Unknown effect: "nonexistent"');
      warnSpy.mockRestore();
    });
  });

  describe('clearEffects', () => {
    it('kills GSAP tweens on overlay, children, and scene', () => {
      overlay.appendChild(document.createElement('div'));

      clearEffects(overlay, scene);

      expect(gsap.killTweensOf).toHaveBeenCalledWith(overlay);
      expect(gsap.killTweensOf).toHaveBeenCalledWith(overlay.children);
      expect(gsap.killTweensOf).toHaveBeenCalledWith(scene);
    });

    it('removes all children from overlay', () => {
      overlay.appendChild(document.createElement('div'));
      overlay.appendChild(document.createElement('div'));

      clearEffects(overlay, scene);

      expect(overlay.children.length).toBe(0);
    });

    it('resets GSAP inline styles on overlay and scene', () => {
      clearEffects(overlay, scene);

      expect(gsap.set).toHaveBeenCalledWith(overlay, { clearProps: 'all' });
      expect(gsap.set).toHaveBeenCalledWith(scene, {
        clearProps: 'filter,opacity,transform',
      });
    });

    it('handles missing scene gracefully', () => {
      expect(() => clearEffects(overlay)).not.toThrow();
    });

    it('handles empty overlay', () => {
      expect(() => clearEffects(overlay, scene)).not.toThrow();
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
      runEffect('dust-drift', overlay, scene);

      const particle = overlay.children[0];
      expect(particle.style.position).toBe('absolute');
      expect(particle.style.borderRadius).toBe('50%');
      expect(particle.style.width).toBe('4px');
    });

    it('dust-settle creates particles with distinct color', () => {
      runEffect('dust-settle', overlay, scene);

      const particle = overlay.children[0];
      expect(particle.style.position).toBe('absolute');
      expect(particle.style.height).toBe('5px');
    });
  });

  describe('DOM-creating effects — element structure', () => {
    it('light-crack flash has gradient background and zero initial opacity', () => {
      runEffect('light-crack', overlay, scene);

      const flash = overlay.children[0];
      expect(flash.style.opacity).toBe('0');
      expect(flash.style.position).toBe('absolute');
    });

    it('illumination-spread glow has radial gradient and scale transform', () => {
      runEffect('illumination-spread', overlay, scene);

      const glow = overlay.children[0];
      expect(glow.style.opacity).toBe('0');
      expect(glow.style.position).toBe('absolute');
    });

    it('water-run stream has translateY(-100%) transform', () => {
      runEffect('water-run', overlay, scene);

      const stream = overlay.children[0];
      expect(stream.style.position).toBe('absolute');
    });
  });
});
