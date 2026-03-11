let dotElements = [];

export function initOverlay(sceneCount) {
  const dotsContainer = document.getElementById('progress-dots');
  if (!dotsContainer) return;

  while (dotsContainer.firstChild) {
    dotsContainer.removeChild(dotsContainer.firstChild);
  }
  dotElements = [];

  for (let i = 0; i < sceneCount; i++) {
    const dot = document.createElement('span');
    dot.className = 'progress-dot';
    dot.setAttribute('aria-label', `Scene ${i + 1}`);
    dotsContainer.appendChild(dot);
    dotElements.push(dot);
  }
}

export function updateProgress(sceneIndex) {
  dotElements.forEach((dot, i) => {
    dot.classList.toggle('active', i < sceneIndex);
  });
}

export function showControls() {
  const controls = document.getElementById('overlay-controls');
  if (controls) {
    controls.hidden = false;
  }
}
