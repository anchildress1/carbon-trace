import { createApp } from './app.js';

// Activate preloaded Google Fonts stylesheet without blocking render.
const fontLink = document.querySelector('link[rel="preload"][as="style"]');
if (fontLink) {
  fontLink.rel = 'stylesheet';
}

if (!globalThis.__carbonTraceInitialized) {
  globalThis.__carbonTraceInitialized = true;

  document.addEventListener('DOMContentLoaded', () => {
    try {
      createApp();
    } catch (err) {
      console.error('Fatal error:', err);
      const loading = document.getElementById('loading-screen');
      if (loading) {
        loading.textContent = 'Something went wrong. Please refresh.';
      }
    }
  });
}
