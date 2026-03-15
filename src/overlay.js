let dotElements = [];

export function initOverlay(sceneCount) {
  const dotsContainer = document.getElementById('progress-dots');
  if (!dotsContainer) return;

  dotsContainer.replaceChildren();
  dotElements = [];

  for (let i = 0; i < sceneCount; i++) {
    const dot = document.createElement('span');
    dot.className = 'progress-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.dataset.sceneIndex = String(i + 1);
    dot.setAttribute('title', `Scene ${i + 1} of ${sceneCount}`);
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
