import { defineConfig, devices } from '@playwright/test';

const usesExternalPerfServer = process.env.PERF_EXTERNAL_SERVER === '1';
const includeWebkit = process.env.PERF_INCLUDE_WEBKIT === '1';
const previewPortEnv = process.env.PERF_PREVIEW_PORT;
const previewPort = previewPortEnv === undefined ? 4173 : Number.parseInt(previewPortEnv, 10);

if (previewPortEnv !== undefined && !/^\d+$/.test(previewPortEnv)) {
  throw new Error(
    `Invalid PERF_PREVIEW_PORT value: "${previewPortEnv}". Expected an integer between 1 and 65535.`,
  );
}

if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
  throw new Error(
    `Invalid PERF_PREVIEW_PORT value: "${previewPortEnv}". Expected an integer between 1 and 65535.`,
  );
}

const projects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'mobile-chrome',
    use: { ...devices['Pixel 5'] },
  },
];

if (includeWebkit) {
  projects.push({
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
  });
}

export default defineConfig({
  testDir: 'tests/perf',
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${previewPort}`,
    headless: true,
    trace: 'off',
  },
  ...(usesExternalPerfServer
    ? {}
    : {
        webServer: {
          command: `BROWSER=none pnpm exec vite preview --host localhost --port ${previewPort} --strictPort`,
          port: previewPort,
          reuseExistingServer: !process.env.CI,
        },
      }),
  projects,
});
