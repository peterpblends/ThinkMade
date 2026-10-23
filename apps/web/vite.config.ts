import { readFileSync } from 'node:fs';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BRAND } from '@thinkmade/shared';

const manifestIcons = JSON.parse(readFileSync(new URL('./public/manifest-icons.json', import.meta.url), 'utf8'));
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8787';
const proxy = { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } };

/**
 * Dev only: ONNX Runtime imports its loader from /speech at run time, and Vite's dev server refuses
 * `import()` of public files (it adds `?import`). Serve them as the plain static files production uses.
 */
const servePublicSpeechModules: PluginOption = {
  name: 'thinkmade-public-speech-modules',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/speech/') && req.url.endsWith('?import')) req.url = req.url.slice(0, -'?import'.length);
      next();
    });
  },
};

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev') },
  plugins: [
    servePublicSpeechModules,
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
        // Precache Latin font subsets only; other scripts' subsets still load on demand via unicode-range.
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-latin-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/speech\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, proxy },
  build: { target: 'es2022', sourcemap: true },
});
