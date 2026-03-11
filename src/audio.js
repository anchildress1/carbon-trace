import { Howl } from 'howler';

let currentAmbient = null;
let currentNarration = null;
let globalMuted = false;

export function playAmbient(src, volume, loop) {
  if (currentAmbient) {
    currentAmbient.unload();
  }

  currentAmbient = new Howl({
    src: [src],
    volume: volume,
    loop: loop,
    html5: true,
    mute: globalMuted,
    onloaderror: (_id, err) => console.warn(`Failed to load ambient: ${src}`, err),
    onplayerror: (_id, err) => console.warn(`Failed to play ambient: ${src}`, err),
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
    mute: globalMuted,
    onloaderror: (_id, err) => console.warn(`Failed to load ambient: ${newSrc}`, err),
    onplayerror: (_id, err) => console.warn(`Failed to play ambient: ${newSrc}`, err),
  });

  currentAmbient.play();
  currentAmbient.fade(0, volume, durationMs);

  if (oldAmbient) {
    oldAmbient.fade(oldAmbient.volume(), 0, durationMs);
    setTimeout(() => oldAmbient.unload(), durationMs + 100);
  }

  return currentAmbient;
}

export function playNarration(src) {
  if (currentNarration) {
    currentNarration.unload();
  }

  currentNarration = new Howl({
    src: [src],
    volume: 1,
    html5: true,
    mute: globalMuted,
    onloaderror: (_id, err) => console.warn(`Failed to load narration: ${src}`, err),
    onplayerror: (_id, err) => console.warn(`Failed to play narration: ${src}`, err),
  });

  currentNarration.play();
  return currentNarration;
}

export function stopAll() {
  if (currentAmbient) currentAmbient.unload();
  if (currentNarration) currentNarration.unload();
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
