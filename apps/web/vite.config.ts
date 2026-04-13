import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev server proxies /api and /ws to the Fastify backend so the UI can be
 * developed standalone (`pnpm --filter @claude-hub/web dev`) against a
 * running server (`pnpm --filter @claude-hub/server dev`).
 *
 * In production, the server is expected to serve the built `dist/` folder.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7878', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:7878', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
