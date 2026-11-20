import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // HTTPS is opt-in for phone camera/orientation testing on the LAN:
  //   npm run dev:https
  plugins: process.env.HTTPS === '1' ? [basicSsl()] : [],
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
