import { defineConfig } from 'vite';

const local = {
  host: '127.0.0.1',
  port: 5173,
  strictPort: true,
  proxy: { '/api': { target: 'http://127.0.0.1:' + (process.env.SIJANTAN_PORT || '8766'), changeOrigin: true } },
};

export default defineConfig({
  server: local,
  preview: { ...local, port: 4173 },
  build: { assetsInlineLimit: 0, target: 'esnext' },
  esbuild: { jsx: 'automatic' },
});
