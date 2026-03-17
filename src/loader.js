/**
 * Asset preloader — preloads images and audio metadata so transitions
 * are instant. Images use the browser Image constructor; audio uses
 * native Audio elements for lightweight metadata-only preloading
 * (Howler handles actual playback in audio.js).
 */

export function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = () => {
      console.warn(`Failed to load image: ${src}`);
      resolve();
    };
    img.src = src;
  });
}

export function preloadAudio(src) {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';

    const timeout = setTimeout(() => {
      console.warn(`Audio preload timed out: ${src}`);
      resolve(null);
    }, 5000);

    audio.onloadedmetadata = () => {
      clearTimeout(timeout);
      resolve(src);
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      console.warn(`Failed to preload audio: ${src}`);
      resolve(null);
    };
    audio.src = src;
  });
}

export function audioSrcsFromEntry(entry) {
  return [entry.ambient?.src, entry.narration?.audio, entry.music?.src].filter(Boolean);
}

export function preloadFirstFrameAssets(frames) {
  const firstFrame = frames[0];
  return firstFrame?.image ? preloadImage(firstFrame.image) : Promise.resolve();
}

export function preloadFirstFrameAudio(frames, onLoaded) {
  const srcs = audioSrcsFromEntry(frames[0]);
  for (const src of srcs) {
    preloadAudio(src)
      .then((loaded) => onLoaded(loaded))
      .catch((err) => console.warn('First frame audio preload failed:', err));
  }
}

export async function preloadBackgroundAssets(frames, onLoaded) {
  if (frames.length === 0) return;
  const firstFrameSrcs = new Set(audioSrcsFromEntry(frames[0]));

  for (const frame of frames.slice(1)) {
    if (frame.image) await preloadImage(frame.image);
    for (const src of audioSrcsFromEntry(frame)) {
      if (!firstFrameSrcs.has(src)) {
        const loaded = await preloadAudio(src);
        onLoaded(loaded);
      }
    }
  }
}
