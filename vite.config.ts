import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./apps/desk', import.meta.url)),
  base: './',
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
    proxy: {
      '/api/wolf': {
        target: 'http://127.0.0.1:4318',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (forwarded, request) => {
            if (['http://127.0.0.1:4317', 'http://localhost:4317'].includes(request.headers.origin ?? '')) {
              forwarded.setHeader('origin', 'http://127.0.0.1:4318');
            }
          });
        },
      },
    },
  },
});
