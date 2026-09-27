import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// IMPORTANT: set `base` to '/<your-repo-name>/' before deploying to GitHub
// Pages project sites (e.g. https://username.github.io/shivansh-stores/).
// If deploying to a custom domain or a user/org root site, use '/'.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/shivansh-stores/',
  resolve: {
    alias: {
      // Mirrors the "@/*" path mapping in tsconfig.json. tsc only checks
      // types against that mapping — Rollup needs this alias separately to
      // actually resolve the imports at build time.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'logo-source.png'],
      manifest: {
        name: 'Shree Shivansh Stores',
        short_name: 'Shivansh Stores',
        description: 'Store management PWA for Shree Shivansh Stores — BETA V1',
        theme_color: '#19470B',
        background_color: '#FAF5E6',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell caching only. Financial data is never cached as "safe to
        // trust offline" — see src/lib/offlineQueue.ts for the pending-sync
        // model used for any offline-entered transactions.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { port: 5173 },
});
