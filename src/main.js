import { createApp } from './app.js';

if (!window.__carbonTraceInitialized) {
  window.__carbonTraceInitialized = true;

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
