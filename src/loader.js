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

    function cleanup() {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = '';
    }

    const timeout = setTimeout(() => {
      cleanup();
      console.warn(`Audio preload timed out: ${src}`);
      resolve({ src: null, duration: 0 });
    }, 5000);

    audio.onloadedmetadata = () => {
      clearTimeout(timeout);
      const duration = audio.duration || 0;
      cleanup();
      resolve({ src, duration });
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      console.warn(`Failed to preload audio: ${src}`);
      cleanup();
      resolve({ src: null, duration: 0 });
    };
    audio.src = src;
  });
}

export function audioSrcsFromEntry(entry) {
  if (!entry.audioCues) return [];
  return entry.audioCues.map((c) => c.src).filter(Boolean);
}

export function preloadFirstFrameAudio(frames, onLoaded) {
  if (!frames.length) return;
  const srcs = audioSrcsFromEntry(frames[0]);
  for (const src of srcs) {
    preloadAudio(src).then((result) => onLoaded(result));
  }
}

export async function preloadBackgroundAudio(frames, onLoaded) {
  if (frames.length === 0) return;
  const firstFrameSrcs = new Set(audioSrcsFromEntry(frames[0]));

  for (const frame of frames.slice(1)) {
    for (const src of audioSrcsFromEntry(frame)) {
      if (!firstFrameSrcs.has(src)) {
        const result = await preloadAudio(src);
        onLoaded(result);
      }
    }
  }
}
