const STORAGE_KEY = 'carbon-trace-captions-enabled';

let enabled = false;
let activeTimers = [];
let activeElements = [];
let currentCaptions = null;
let currentContainer = null;
let playbackStartedAt = null;
let elapsedBeforePause = 0;

export function initCaptions() {
  try {
    enabled = localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    enabled = false;
  }
  return enabled;
}

export function setCaptionsEnabled(value) {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* localStorage unavailable */
  }
}

export function areCaptionsEnabled() {
  return enabled;
}

function scheduleCaptionsFromOffset(captions, container, offsetMs) {
  captions.forEach((caption) => {
    const showDelay = caption.start - offsetMs;
    const hideDelay = caption.end - offsetMs;

    if (hideDelay <= 0) return;

    if (showDelay <= 0) {
      const el = document.createElement('p');
      el.className = 'caption-text';
      el.textContent = caption.text;
      container.appendChild(el);
      activeElements.push(el);

      const hideId = setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
        const idx = activeElements.indexOf(el);
        if (idx >= 0) activeElements.splice(idx, 1);
      }, hideDelay);
      activeTimers.push(hideId);
    } else {
      const showId = setTimeout(() => {
        const el = document.createElement('p');
        el.className = 'caption-text';
        el.textContent = caption.text;
        container.appendChild(el);
        activeElements.push(el);

        const hideId = setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
          const idx = activeElements.indexOf(el);
          if (idx >= 0) activeElements.splice(idx, 1);
        }, caption.end - caption.start);
        activeTimers.push(hideId);
      }, showDelay);
      activeTimers.push(showId);
    }
  });
}

export function showCaptions(captions, container, offsetMs = 0) {
  clearCaptions();

  if (!captions || !container) return;

  currentCaptions = captions;
  currentContainer = container;
  playbackStartedAt = Date.now();
  elapsedBeforePause = offsetMs;

  scheduleCaptionsFromOffset(captions, container, offsetMs);
}

export function clearCaptions() {
  for (const id of activeTimers) {
    clearTimeout(id);
  }
  activeTimers = [];

  for (const el of activeElements) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  activeElements = [];

  currentCaptions = null;
  currentContainer = null;
  playbackStartedAt = null;
  elapsedBeforePause = 0;
}

export function pauseCaptions() {
  if (playbackStartedAt === null) return;

  elapsedBeforePause += Date.now() - playbackStartedAt;
  playbackStartedAt = null;

  for (const id of activeTimers) {
    clearTimeout(id);
  }
  activeTimers = [];
}

export function resumeCaptions() {
  if (!currentCaptions || !currentContainer) return;

  playbackStartedAt = Date.now();

  for (const el of activeElements) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  activeElements = [];

  scheduleCaptionsFromOffset(currentCaptions, currentContainer, elapsedBeforePause);
}
