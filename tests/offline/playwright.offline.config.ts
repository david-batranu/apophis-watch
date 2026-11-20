import { defineConfig } from '@playwright/test';

/**
 * Production-build offline test. It starts a fresh `vite preview` server so
 * the generated service worker and hashed chunks are exercised exactly as
 * they would be on static hosting.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'offline.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    timezoneId: 'Europe/Bucharest',
    colorScheme: 'dark',
    serviceWorkers: 'allow',
    permissions: ['camera'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
