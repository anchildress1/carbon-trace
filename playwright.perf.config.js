import { defineConfig, devices } from '@playwright/test';

const usesExternalPerfServer = process.env.PERF_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: 'tests/perf',
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    trace: 'off',
  },
  ...(usesExternalPerfServer
    ? {}
    : {
        webServer: {
          command: 'BROWSER=none pnpm exec vite preview --host localhost --port 4173 --strictPort',
          port: 4173,
          reuseExistingServer: !process.env.CI,
        },
      }),
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
