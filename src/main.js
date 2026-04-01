import { createApp } from './app.js';

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
