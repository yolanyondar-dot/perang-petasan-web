import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const gameServer = process.env.GAME_SERVER_URL ?? 'ws://localhost:2567';

/** Di hosting, client memakai satu origin: /ws diteruskan ke Colyseus. */
const proxy = {
  '/ws': {
    target: gameServer,
    ws: true,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/ws/, ''),
  },
};

export default defineConfig({
  // Domain root deployment: aset absolut /assets/ ... juga aman dengan SPA fallback.
  base: '/',
  server: {
    host: true,
    port: 5173,
    proxy,
    // Shared balancing JSON lives one level above the Vite root.
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
  preview: {
    host: true,
    port: 4173,
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
