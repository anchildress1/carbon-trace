import { gsap } from 'gsap';

function opacityPulse(opacity, duration) {
  return (container) => {
    gsap.to(container, { opacity, duration, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  };
}

function particleEffect({ count, color, topRange, xSpread, yDrift, durationRange }) {
  return (container) => {
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.style.cssText = `
        position: absolute;
        width: 2px;
        height: 2px;
        background: ${color};
        border-radius: 50%;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * topRange}%;
      `;
      container.appendChild(particle);

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
    count: 12,
    color: 'rgba(255, 255, 255, 0.15)',
    topRange: 100,
    xSpread: 40,
    yDrift: [-20, -30],
    durationRange: [4, 4],
  }),

  'motion-drag': (container) => {
    gsap.fromTo(
      container,
      { filter: 'blur(2px)' },
      { filter: 'blur(0px)', duration: 1.5, ease: 'power2.out' },
    );
  },

  'heat-pulse': (container) => {
    gsap.to(container, {
      filter: 'blur(0.5px) brightness(1.08)',
      duration: 1.5,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  },

  'near-still-pulse': opacityPulse(0.97, 3),

  'light-crack': (container) => {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%);
      opacity: 0;
    `;
    container.appendChild(flash);

    gsap.fromTo(
      flash,
      { opacity: 0, scaleX: 0.5 },
      { opacity: 1, scaleX: 1.2, duration: 0.4, ease: 'power3.out' },
    );
    gsap.to(flash, { opacity: 0, duration: 0.8, delay: 0.4, ease: 'power2.in' });
  },

  'assembly-micro': (container) => {
    gsap.to(container, {
      x: () => `+=${(Math.random() - 0.5) * 2}`,
      y: () => `+=${(Math.random() - 0.5) * 1}`,
      duration: 0.15,
      repeat: -1,
      ease: 'none',
    });
  },

  'illumination-spread': (container) => {
    const glow = document.createElement('div');
    glow.style.cssText = `
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at center, rgba(255,255,255,0.1) 0%, transparent 70%);
      opacity: 0;
      transform: scale(0.3);
    `;
    container.appendChild(glow);

    gsap.to(glow, { opacity: 1, scale: 1.5, duration: 3, ease: 'power2.out' });
  },

  'machine-steady': opacityPulse(0.95, 1.5),

  'fade-in': (container) => {
    gsap.fromTo(container, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' });
  },

  'dust-settle': particleEffect({
    count: 10,
    color: 'rgba(200, 190, 170, 0.2)',
    topRange: 50,
    xSpread: 20,
    yDrift: [20, 30],
    durationRange: [5, 4],
  }),

  'water-run': (container) => {
    const stream = document.createElement('div');
    stream.style.cssText = `
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
      transform: translateY(-100%);
    `;
    container.appendChild(stream);

    gsap.to(stream, {
      y: '200%',
      duration: 5,
      repeat: -1,
      ease: 'sine.inOut',
    });
  },
};

export function effectExists(name) {
  return name in effects;
}

export function runEffect(name, container) {
  const fn = effects[name];
  if (fn) {
    fn(container);
  } else {
    console.warn(`Unknown effect: "${name}"`);
  }
}

export function clearEffects(container) {
  gsap.killTweensOf(container);
  gsap.killTweensOf(container.children);
  container.replaceChildren();
  gsap.set(container, { clearProps: 'all' });
}
