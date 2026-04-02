/**
 * Asset preloader — preloads audio metadata so transitions are instant.
 * Audio uses native Audio elements for lightweight metadata-only
 * preloading (Howler handles actual playback in audio.js). Also
 * provides frame-aware orchestration helpers (preloadFirstFrameAudio,
 * preloadBackgroundAudio) that sequence audio loading across the
 * scene list.
 *
 * Image preloading is handled by canvas.js's loadImage which caches
 * promises and rejects on failure.
 */

export function preloadAudio(src) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';

    function cleanup() {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.src = '';
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Audio preload timed out: ${src}`));
    }, 5000);

    audio.onloadedmetadata = () => {
      clearTimeout(timeout);
      const duration = audio.duration || 0;
      cleanup();
      resolve({ src, duration });
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Failed to preload audio: ${src}`));
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
    preloadAudio(src)
      .then((result) => onLoaded(result))
      .catch((err) => console.warn(err.message));
  }
}

export async function preloadBackgroundAudio(frames, onLoaded) {
  if (frames.length === 0) return;
  const firstFrameSrcs = new Set(audioSrcsFromEntry(frames[0]));

  for (const frame of frames.slice(1)) {
    for (const src of audioSrcsFromEntry(frame)) {
      if (!firstFrameSrcs.has(src)) {
        try {
          const result = await preloadAudio(src);
          onLoaded(result);
        } catch (err) {
          console.warn(err.message);
        }
      }
    }
  }
}
