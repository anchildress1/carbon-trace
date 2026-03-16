import { gsap } from 'gsap';

/**
 * Effects receive { overlay, scene } where:
 * - overlay: the #effects-layer div for adding child elements (particles, gradients)
 * - scene: the #scene-image element for applying filters, opacity, and transforms
 */

function scenePulse(brightness, duration) {
  return ({ scene }) => {
    gsap.to(scene, {
      filter: `brightness(${brightness})`,
      duration,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  };
}

function particleEffect({ count, color, size, glow, topRange, xSpread, yDrift, durationRange }) {
  return ({ overlay }) => {
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border-radius: 50%;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * topRange}%;
        ${glow ? `box-shadow: 0 0 ${glow}px ${color};` : ''}
      `;
      overlay.appendChild(particle);

      gsap.to(particle, {
        x: `+=${(Math.random() - 0.5) * xSpread}`,
        y: `+=${yDrift[0] + Math.random() * yDrift[1]}`,
        opacity: 0,
        duration: durationRange[0] + Math.random() * durationRange[1],
        repeat: -1,
        ease: 'none',
      });
    }
  };
}

const effects = {
  'dust-drift': particleEffect({
    count: 18,
    color: 'rgba(255, 255, 255, 0.4)',
    size: 4,
    glow: 6,
    topRange: 100,
    xSpread: 60,
    yDrift: [-30, -50],
    durationRange: [4, 4],
  }),

  'motion-drag': ({ scene }) => {
    gsap.fromTo(
      scene,
      { filter: 'blur(6px)' },
      { filter: 'blur(0px)', duration: 3, ease: 'power2.out' },
    );
  },

  'heat-pulse': ({ scene }) => {
    gsap.to(scene, {
      filter: 'blur(1px) brightness(1.2)',
      duration: 2,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  },

  'near-still-pulse': scenePulse(0.85, 3),

  'light-crack': ({ overlay }) => {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.5) 50%, transparent 70%);
      opacity: 0;
    `;
    overlay.appendChild(flash);

    gsap.fromTo(
      flash,
      { opacity: 0, scaleX: 0.3 },
      { opacity: 1, scaleX: 1.5, duration: 0.5, ease: 'power3.out' },
    );
    gsap.to(flash, { opacity: 0, duration: 1.2, delay: 0.5, ease: 'power2.in' });
  },

  'assembly-micro': ({ scene }) => {
    gsap.to(scene, {
      x: () => (Math.random() - 0.5) * 4,
      y: () => (Math.random() - 0.5) * 2,
      duration: 0.15,
      repeat: -1,
      repeatRefresh: true,
      ease: 'none',
    });
  },

  'illumination-spread': ({ overlay }) => {
    const glow = document.createElement('div');
    glow.style.cssText = `
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at center, rgba(255,255,255,0.25) 0%, transparent 70%);
      opacity: 0;
      transform: scale(0.3);
    `;
    overlay.appendChild(glow);

    gsap.to(glow, { opacity: 1, scale: 1.5, duration: 3, ease: 'power2.out' });
  },

  'machine-steady': scenePulse(0.85, 1.5),

  'fade-in': ({ overlay }) => {
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' });
  },

  'dust-settle': particleEffect({
    count: 14,
    color: 'rgba(200, 190, 170, 0.4)',
    size: 5,
    glow: 4,
    topRange: 50,
    xSpread: 30,
    yDrift: [25, 40],
    durationRange: [5, 4],
  }),

  'water-run': ({ overlay }) => {
    // Faucet stream — narrow column from top to diamond center
    const faucet = document.createElement('div');
    faucet.style.cssText = `
      position: absolute;
      left: 47%;
      top: 0;
      width: 6%;
      height: 45%;
      background: linear-gradient(180deg,
        rgba(200, 220, 255, 0.18) 0%,
        rgba(200, 220, 255, 0.12) 60%,
        rgba(255, 255, 255, 0.06) 100%);
      mask-image: linear-gradient(180deg, white 0%, white 80%, transparent 100%);
      -webkit-mask-image: linear-gradient(180deg, white 0%, white 80%, transparent 100%);
    `;
    overlay.appendChild(faucet);

    // Shimmer moving down the faucet stream
    const shimmer = document.createElement('div');
    shimmer.style.cssText = `
      position: absolute;
      left: 47%;
      top: 0;
      width: 6%;
      height: 45%;
      background: linear-gradient(180deg,
        transparent 0%,
        rgba(255, 255, 255, 0.15) 30%,
        transparent 60%);
      transform: translateY(-100%);
    `;
    overlay.appendChild(shimmer);
    gsap.to(shimmer, { y: '220%', duration: 1.2, repeat: -1, ease: 'none' });

    // Splash droplets radiating from where water hits the diamond (~50%, 40%)
    const splashCount = 10;
    for (let i = 0; i < splashCount; i++) {
      const drop = document.createElement('div');
      const size = 2 + Math.random() * 3;
      drop.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        background: rgba(200, 220, 255, 0.35);
        border-radius: 50%;
        left: 50%;
        top: 40%;
        box-shadow: 0 0 4px rgba(200, 220, 255, 0.25);
      `;
      overlay.appendChild(drop);

      const angle = (Math.PI * 2 * i) / splashCount + (Math.random() - 0.5) * 0.6;
      const dist = 30 + Math.random() * 60;
      gsap.to(drop, {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist * 0.6 + 15,
        opacity: 0,
        duration: 1 + Math.random() * 1.5,
        delay: Math.random() * 1.5,
        repeat: -1,
        ease: 'power2.out',
      });
    }

    // Rivulets — thin streams cascading down from diamond to basin
    const rivulets = [
      { left: 38, width: 2, delay: 0 },
      { left: 44, width: 3, delay: 0.4 },
      { left: 52, width: 2, delay: 0.8 },
      { left: 58, width: 3, delay: 0.2 },
      { left: 48, width: 2, delay: 0.6 },
    ];
    for (const r of rivulets) {
      const riv = document.createElement('div');
      riv.style.cssText = `
        position: absolute;
        left: ${r.left}%;
        top: 42%;
        width: ${r.width}px;
        height: 25%;
        background: linear-gradient(180deg,
          rgba(200, 220, 255, 0.12) 0%,
          rgba(200, 220, 255, 0.06) 70%,
          transparent 100%);
        transform: translateY(-100%);
      `;
      overlay.appendChild(riv);
      gsap.to(riv, {
        y: '400%',
        duration: 2 + Math.random(),
        delay: r.delay,
        repeat: -1,
        ease: 'power1.in',
      });
    }
  },
};

export function effectExists(name) {
  return name in effects;
}

export function runEffect(name, overlay, scene) {
  const fn = effects[name];
  if (fn) {
    fn({ overlay, scene });
  } else {
    console.warn(`Unknown effect: "${name}"`);
  }
}

export function clearEffects(overlay, scene) {
  gsap.killTweensOf(overlay);
  gsap.killTweensOf(overlay.children);
  overlay.replaceChildren();
  gsap.set(overlay, { clearProps: 'all' });

  if (scene) {
    gsap.killTweensOf(scene);
    gsap.set(scene, { clearProps: 'filter,opacity,transform' });
  }
}
