import { Howl } from 'howler';

let currentAmbient = null;
let currentNarration = null;
let globalMuted = false;

export function playAmbient(src, volume, loop) {
  if (currentAmbient) {
    currentAmbient.stop();
  }

  currentAmbient = new Howl({
    src: [src],
    volume: globalMuted ? 0 : volume,
    loop: loop,
    html5: true,
  });

  currentAmbient.play();
  return currentAmbient;
}

export function crossfadeAmbient(newSrc, volume, durationMs) {
  const oldAmbient = currentAmbient;

  currentAmbient = new Howl({
    src: [newSrc],
    volume: 0,
    loop: true,
    html5: true,
  });

  currentAmbient.play();
  currentAmbient.fade(0, globalMuted ? 0 : volume, durationMs);

  if (oldAmbient) {
    oldAmbient.fade(oldAmbient.volume(), 0, durationMs);
    setTimeout(() => oldAmbient.stop(), durationMs + 100);
  }

  return currentAmbient;
}

export function playNarration(src) {
  if (currentNarration) {
    currentNarration.stop();
  }

  currentNarration = new Howl({
    src: [src],
    volume: globalMuted ? 0 : 1,
    html5: true,
  });

  currentNarration.play();
  return currentNarration;
}

export function stopAll() {
  if (currentAmbient) currentAmbient.stop();
  if (currentNarration) currentNarration.stop();
  currentAmbient = null;
  currentNarration = null;
}

export function setMuted(muted) {
  globalMuted = muted;
  if (currentAmbient) {
    currentAmbient.mute(muted);
  }
  if (currentNarration) {
    currentNarration.mute(muted);
  }
}
