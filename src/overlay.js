let dotElements = [];
let currentSceneIndex = -1;
let rovingIndex = 0;

function setRovingTarget(index) {
  if (index < 0 || index >= dotElements.length) return;
  dotElements[rovingIndex]?.setAttribute('tabindex', '-1');
  rovingIndex = index;
  dotElements[rovingIndex].setAttribute('tabindex', '0');
}

function handleDotsKeydown(e) {
  const len = dotElements.length;
  if (len === 0) return;

  let nextIndex;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      nextIndex = (rovingIndex + 1) % len;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      nextIndex = (rovingIndex - 1 + len) % len;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = len - 1;
      break;
    default:
      return;
  }

  e.preventDefault();
  e.stopPropagation();
  setRovingTarget(nextIndex);
  dotElements[nextIndex].focus();
}

export function initOverlay(sceneCount, onDotClick) {
  const dotsContainer = document.getElementById('progress-dots');
  if (!dotsContainer) return;

  dotsContainer.replaceChildren();
  dotsContainer.removeEventListener('keydown', handleDotsKeydown);
  dotElements = [];
  currentSceneIndex = -1;
  rovingIndex = 0;

  for (let i = 0; i < sceneCount; i++) {
    const dot = document.createElement('button');
    dot.className = 'progress-dot';
    dot.setAttribute('aria-label', `Go to scene ${i + 1} of ${sceneCount}`);
    dot.dataset.sceneIndex = String(i + 1);
    dot.setAttribute('title', `Scene ${i + 1} of ${sceneCount}`);
    dot.setAttribute('tabindex', i === 0 ? '0' : '-1');
    if (onDotClick) {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        onDotClick(i + 1);
      });
    }
    dotsContainer.appendChild(dot);
    dotElements.push(dot);
  }

  if (sceneCount > 0) {
    dotsContainer.addEventListener('keydown', handleDotsKeydown);
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
    setRovingTarget(currentSceneIndex - 1);
    dotElements[currentSceneIndex - 1].focus();
  }
}

export function showControls() {
  const controls = document.getElementById('overlay-controls');
  if (controls) {
    controls.hidden = false;
  }
}
