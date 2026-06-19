/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
// IMPORTANT: This app is LOCAL-FIRST. No backend, no network calls at runtime.
// Do NOT add any proxy, server-side routes, or network-dependent plugins.
// All data lives in the browser (IndexedDB) or in files the user owns.
//
// PWA / service worker note: the SW precaches only the static app shell produced
// by `vite build`. There is NO runtime caching that touches external origins —
// everything served is from the same bundle. This satisfies "data never leaves
// the device" (Design Goal 1) and "works offline" (Design Goal 2).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Inject the <script> that registers the SW automatically into index.html
      injectRegister: 'auto',
      // Eagerly claim all open tabs so the updated SW activates immediately
      workbox: {
        // Precache every file in dist/ that Vite emits (JS, CSS, HTML, icons, …)
        // globPatterns covers all typical static-bundle assets.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // No runtimeCaching entries — we only precache the local app shell.
        // Any entry here that pointed at an external origin would violate
        // the local-first promise; omitting the array is the safe default.
        runtimeCaching: [],
        // Tell Workbox to skip the waiting phase so the new SW takes over
        // as soon as it's installed (matches registerType: 'autoUpdate').
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'Pijon',
        short_name: 'Pijon',
        description:
          'Local-first classroom seating tool — build your layout, seat your students, nothing leaves your device.',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Dev mode: emit the SW in development too so you can inspect it
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**'],
      reporter: ['text', 'json-summary'],
    },
  },
});
