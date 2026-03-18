/**
 * Asset preloader — preloads audio metadata so transitions are instant.
 * Audio uses native Audio elements for lightweight metadata-only
 * preloading (Howler handles actual playback in audio.js). Also
 * provides frame-aware orchestration helpers (preloadFirstFrameAudio,
 * preloadBackgroundAudio) that sequence audio loading across the
 * scene list.
 *
 * Image preloading is handled by canvas.js's loadImage which caches
 * promises and resolves with Image objects.
 */

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

export function preloadFirstFrameAudio(frames, onLoaded) {
  if (!frames.length) return;
  const srcs = audioSrcsFromEntry(frames[0]);
  for (const src of srcs) {
    preloadAudio(src)
      .then((loaded) => onLoaded(loaded))
      .catch((err) => console.warn('First frame audio preload failed:', err));
  }
}

export async function preloadBackgroundAudio(frames, onLoaded) {
  if (frames.length === 0) return;
  const firstFrameSrcs = new Set(audioSrcsFromEntry(frames[0]));

  for (const frame of frames.slice(1)) {
    for (const src of audioSrcsFromEntry(frame)) {
      if (!firstFrameSrcs.has(src)) {
        const loaded = await preloadAudio(src);
        onLoaded(loaded);
      }
    }
  }
}
