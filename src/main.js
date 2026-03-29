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
      const app = createApp();
      if (import.meta.env.VITE_E2E === '1') {
        globalThis.__ctE2EApp = app;
      }
    } catch (err) {
      console.error('Fatal error:', err);
      const loading = document.getElementById('loading-screen');
      if (loading) {
        loading.textContent = 'Something went wrong. Please refresh.';
      }
    }
  });
}
