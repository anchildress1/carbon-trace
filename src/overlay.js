let dotElements = [];
let currentSceneIndex = -1;

export function initOverlay(sceneCount, onDotClick) {
  const dotsContainer = document.getElementById('progress-dots');
  if (!dotsContainer) return;

  dotsContainer.replaceChildren();
  dotElements = [];
  currentSceneIndex = -1;

  for (let i = 0; i < sceneCount; i++) {
    const dot = document.createElement('button');
    dot.className = 'progress-dot';
    dot.setAttribute('aria-label', `Go to scene ${i + 1} of ${sceneCount}`);
    dot.dataset.sceneIndex = String(i + 1);
    dot.setAttribute('title', `Scene ${i + 1} of ${sceneCount}`);
    if (onDotClick) {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        onDotClick(i + 1);
      });
    }
    dotsContainer.appendChild(dot);
    dotElements.push(dot);
  }
}

export function updateProgress(sceneIndex) {
  if (sceneIndex === currentSceneIndex) return;

  const prev = currentSceneIndex;
  currentSceneIndex = sceneIndex;

  if (prev === -1) {
    // First call — set all dots
    dotElements.forEach((dot, i) => {
      dot.classList.toggle('active', i < sceneIndex);
      if (i === sceneIndex - 1) {
        dot.setAttribute('aria-current', 'step');
      }
    });
    return;
  }

  // Clear previous current marker
  if (prev >= 1 && prev <= dotElements.length) {
    dotElements[prev - 1].removeAttribute('aria-current');
  }

  // Update only the dots between old and new positions
  const lo = Math.min(prev, sceneIndex);
  const hi = Math.max(prev, sceneIndex);
  for (let i = lo; i < hi; i++) {
    if (i >= 0 && i < dotElements.length) {
      dotElements[i].classList.toggle('active', i < sceneIndex);
    }
  }

  // Set new current marker
  if (sceneIndex >= 1 && sceneIndex <= dotElements.length) {
    dotElements[sceneIndex - 1].setAttribute('aria-current', 'step');
  }
}

export function focusActiveDot() {
  if (currentSceneIndex >= 1 && currentSceneIndex <= dotElements.length) {
    dotElements[currentSceneIndex - 1].focus();
  }
}

export function showControls() {
  const controls = document.getElementById('overlay-controls');
  if (controls) {
    controls.hidden = false;
  }
}
