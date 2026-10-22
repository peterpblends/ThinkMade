import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BRAND } from '@thinkmade/shared';

const manifestIcons = JSON.parse(readFileSync(new URL('./public/manifest-icons.json', import.meta.url), 'utf8'));
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8787';
const proxy = { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new service worker waits until the user chooses to update, so a release never cuts off playback.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'brand/*.svg'],
      manifest: {
        id: '/',
        name: BRAND.name,
        short_name: BRAND.name,
        description: BRAND.shortDescription,
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: BRAND.colors.warmIvory,
        theme_color: BRAND.colors.warmIvory,
        categories: ['education', 'books', 'podcasts'],
        icons: manifestIcons,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, proxy },
  build: { target: 'es2022', sourcemap: true },
});
