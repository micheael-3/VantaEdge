import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // Local dev only — `npx netlify-cli dev` is recommended if you want
    // the functions to run locally. Otherwise this proxies /api to a
    // deployed Netlify URL set via VITE_DEV_PROXY (optional).
    proxy: process.env.VITE_DEV_PROXY
      ? { '/api': process.env.VITE_DEV_PROXY }
      : undefined,
  },
});
