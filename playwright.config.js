import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'playwright-results',
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'VITE_E2E=1 pnpm exec vite build && BROWSER=none pnpm exec vite preview --host localhost --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
