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
//
// §8.D7 — GitHub Pages readiness:
// To host on a GitHub Pages PROJECT site (username.github.io/<repo>/), set:
//
//   base: '/<repo>/',   // e.g. base: '/pijon/'
//
// just before the `plugins` key.  Leave it unset (defaults to '/') for root
// deployments (Netlify, Cloudflare Pages, custom domain, org/user GH Pages).
// See README.md §"GitHub Pages project sites" for full instructions.
//
// When `base` is set, Vite rewrites all JS/CSS asset references automatically.
// The asset paths in src/assets/paths.ts use import.meta.env.BASE_URL (also
// injected by Vite) so public/ images resolve correctly too.
//
// PWA manifest notes for non-root bases:
//   • start_url uses './' so it is relative to wherever the manifest is served,
//     making it correct for both root and subpath deployments.
//   • Icon src paths use './' for the same reason. vite-plugin-pwa resolves them
//     against the build base automatically.
// Config is a function so we can read Vite's `mode`: `vite build` runs in
// 'production', Vitest runs in 'test'. We only apply the /pijon/ base for real
// builds; tests stay at '/' so BASE_URL-derived asset-path assertions are
// deploy-agnostic.
export default defineConfig(({ mode }) => ({
  // §8.D7 — GitHub Pages PROJECT site at https://praisefsm.github.io/pijon/.
  // The repo is named `pijon`, so the site is served under the /pijon/ subpath.
  // Vite rewrites all JS/CSS asset URLs to this base, and src/assets/paths.ts +
  // the PWA manifest already use relative / BASE_URL paths so public/ assets and
  // the service worker resolve correctly. Change this to '/' for a root deploy
  // (custom domain, Netlify/Cloudflare, or a user/org github.io site).
  //
  base: mode === 'test' ? '/' : '/pijon/',
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
        // §8.D7: './' (relative to the manifest) works for both root and
        // subpath deployments. Absolute '/' would point at the origin root,
        // causing a 404 for project-site bases like /pijon/.
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          {
            // §8.D7: relative paths — vite-plugin-pwa prefixes them with the
            // build base so they resolve correctly under any deployment path.
            src: './icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: './icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: './icon-maskable-512.png',
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
}));
