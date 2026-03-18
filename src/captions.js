const STORAGE_KEY = 'carbon-trace-captions-enabled';

let enabled = false;

export function initCaptions() {
  try {
    enabled = localStorage.getItem(STORAGE_KEY) === 'true';
  } catch (err) {
    console.warn('Could not read captions preference:', err);
    enabled = false;
  }
  return enabled;
}

export function setCaptionsEnabled(value) {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch (err) {
    console.warn('Could not save captions preference:', err);
  }
}

export function areCaptionsEnabled() {
  return enabled;
}

export function syncCaptionsToTime(captionEntries, currentTimeSec, container) {
  if (!captionEntries || !container) return;

  clearCaptionElements(captionEntries);

  for (const entry of captionEntries) {
    if (entry.startSec <= currentTimeSec && currentTimeSec < entry.endSec) {
      const el = document.createElement('p');
      el.className = 'caption-text';
      el.textContent = entry.text;
      container.appendChild(el);
      entry.el = el;
    }
  }
}

export function clearCaptionElements(captionEntries) {
  if (!captionEntries) return;

  for (const entry of captionEntries) {
    if (entry.el) {
      entry.el.remove();
      entry.el = null;
    }
  }
}
