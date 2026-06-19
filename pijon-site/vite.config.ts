/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// IMPORTANT: This app is LOCAL-FIRST. No backend, no network calls at runtime.
// Do NOT add any proxy, server-side routes, or network-dependent plugins.
// All data lives in the browser (IndexedDB) or in files the user owns.
export default defineConfig({
  plugins: [react()],
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
