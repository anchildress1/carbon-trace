import { gsap } from 'gsap';

const effects = {
  'dust-drift': (container) => {
    for (let i = 0; i < 12; i++) {
      const particle = document.createElement('div');
      particle.style.cssText = `
        position: absolute;
        width: 2px;
        height: 2px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 50%;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
      `;
      container.appendChild(particle);

      gsap.to(particle, {
        x: `+=${(Math.random() - 0.5) * 40}`,
        y: `+=${-20 - Math.random() * 30}`,
        opacity: 0,
        duration: 4 + Math.random() * 4,
        repeat: -1,
        ease: 'none',
      });
    }
  },

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

  'near-still-pulse': (container) => {
    gsap.to(container, {
      opacity: 0.97,
      duration: 3,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  },

  'water-clarity': (container) => {
    gsap.fromTo(
      container,
      { filter: 'blur(3px)' },
      { filter: 'blur(0px)', duration: 2, ease: 'power2.out' },
    );
  },

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

  'room-carry': (container) => {
    const sweep = document.createElement('div');
    sweep.style.cssText = `
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, rgba(255,255,255,0.08) 0%, transparent 30%);
      transform: translateX(-100%);
    `;
    container.appendChild(sweep);

    gsap.to(sweep, {
      x: '200%',
      duration: 5,
      repeat: -1,
      ease: 'none',
    });
  },

  'machine-steady': (container) => {
    gsap.to(container, {
      opacity: 0.95,
      duration: 1.5,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });
  },

  'fade-in': (container) => {
    gsap.fromTo(container, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' });
  },

  'dust-settle': (container) => {
    for (let i = 0; i < 10; i++) {
      const particle = document.createElement('div');
      particle.style.cssText = `
        position: absolute;
        width: 2px;
        height: 2px;
        background: rgba(200, 190, 170, 0.2);
        border-radius: 50%;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 50}%;
      `;
      container.appendChild(particle);

      gsap.to(particle, {
        x: `+=${(Math.random() - 0.5) * 20}`,
        y: `+=${20 + Math.random() * 30}`,
        opacity: 0,
        duration: 5 + Math.random() * 4,
        repeat: -1,
        ease: 'none',
      });
    }
  },

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
