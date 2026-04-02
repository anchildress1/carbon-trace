import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const previewPort = Number(process.env.PLAYWRIGHT_PREVIEW_PORT || 4174);

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'playwright-results',
  reporter: isCI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 30_000,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  use: {
    baseURL: `http://localhost:${previewPort}`,
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `VITE_E2E=1 pnpm exec vite build && BROWSER=none pnpm exec vite preview --host localhost --port ${previewPort} --strictPort`,
    port: previewPort,
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
