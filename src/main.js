import { createApp } from './app.js';

function sanitizeStartupError(err) {
  if (!(err instanceof Error)) {
    return {
      type: typeof err,
      message: 'non-error thrown during initialization',
    };
  }

  const collapsedMessage = err.message.replaceAll(/\s+/g, ' ').trim();
  const scrubbedMessage = collapsedMessage
    .replaceAll(/https?:\/\/\S+/gi, '[redacted-url]')
    .replaceAll(/([A-Za-z]:)?[\\/][^\s]+/g, '[redacted-path]')
    .slice(0, 160);

  return {
    type: err.name || 'Error',
    message: scrubbedMessage || 'startup initialization failure',
  };
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
      // eslint-disable-next-line no-console -- Explicitly requested startup failure telemetry.
      console.log('[carbon-trace] startup_failed', sanitizeStartupError(err));
      const loading = document.getElementById('loading-screen');
      if (loading) {
        loading.textContent = 'Unable to start experience. Please refresh.';
      }
    }
  });
}
