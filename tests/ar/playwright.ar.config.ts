import { defineConfig } from '@playwright/test';

/**
 * AR-only harness config. It is intentionally separate from the shared
 * playwright.config.ts so the Phase 2 suite is untouched.
 *
 * Run from the repository root:
 *   npx playwright test -c tests/ar/playwright.ar.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'ar.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    timezoneId: 'Europe/Bucharest',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    permissions: ['camera'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5174',
    cwd: process.cwd(),
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
