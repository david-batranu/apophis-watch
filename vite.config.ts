import { readFileSync } from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };
const buildTime = new Date().toISOString();

export default defineConfig({
  // Relative base works both at a root domain and under a GitHub Pages
  // sub-path (e.g. /apophis-watch/). The service worker is registered from
  // the same base, so its scope stays inside the deployment directory.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  // HTTPS is opt-in for phone camera/orientation testing on the LAN:
  //   npm run dev:https
  plugins: [
    ...(process.env.HTTPS === '1' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Apophis Watch',
        short_name: 'Apophis',
        description:
          'Simulate the 13 April 2029 Apophis close approach: sky, terrain, best viewing spots and camera AR.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#070b14',
        theme_color: '#070b14',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Data JSON is intentionally excluded. Offline data is an explicit
        // IndexedDB snapshot so a service-worker refresh cannot silently
        // replace the prepared ephemeris/terrain/building set.
        globIgnores: ['data/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
