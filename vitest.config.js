import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.js'],
      exclude: ['src/main.js'],
      thresholds: {
        lines: 97,
        functions: 98,
        statements: 95,
        branches: 88,
      },
    },
  },
});
