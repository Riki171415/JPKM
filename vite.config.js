import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

const staticMap = [
  { urlPrefix: '/ocr-data/', dir: join(root, 'ocr-data'), dest: 'ocr-data' },
  {
    urlPrefix: '/tesseract/',
    dir: join(root, 'node_modules', 'tesseract.js-core'),
    dest: 'tesseract',
    files: [
      'tesseract-core-lstm.wasm.js',
      'tesseract-core-lstm.wasm',
      'tesseract-core-simd-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm',
    ],
  },
  { urlPrefix: '/pdfjs/cmaps/', dir: join(root, 'node_modules', 'pdfjs-dist', 'cmaps'), dest: 'pdfjs/cmaps' },
  { urlPrefix: '/pdfjs/standard_fonts/', dir: join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts'), dest: 'pdfjs/standard_fonts' },
];

const mimeByExt = {
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.traineddata': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
};

function clientAssetsPlugin() {
  return {
    name: 'sijantan-client-assets',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = (req.url || '').split('?')[0];
        for (const entry of staticMap) {
          if (urlPath.startsWith(entry.urlPrefix)) {
            const rel = urlPath.slice(entry.urlPrefix.length);
            if (!rel || rel.includes('..') || rel.includes('/')) return next();
            try {
              const data = await readFile(join(entry.dir, rel));
              res.setHeader('Content-Type', mimeByExt[extname(rel)] || 'application/octet-stream');
              res.end(data);
              return;
            } catch {
              return next();
            }
          }
        }
        next();
      });
    },
    async closeBundle() {
      const outDir = resolve(root, 'dist');
      for (const entry of staticMap) {
        const targetDir = join(outDir, entry.dest);
        await mkdir(targetDir, { recursive: true });
        if (entry.files) {
          for (const file of entry.files) {
            await cp(join(entry.dir, file), join(targetDir, file));
          }
        } else {
          await cp(entry.dir, targetDir, { recursive: true });
        }
      }
    },
  };
}

const local = {
  host: '127.0.0.1',
  port: 5173,
  strictPort: true,
  proxy: { '/api': { target: 'http://127.0.0.1:' + (process.env.SIJANTAN_PORT || '8766'), changeOrigin: true } },
};

export default defineConfig({
  plugins: [clientAssetsPlugin()],
  server: local,
  preview: { ...local, port: 4173 },
  build: { assetsInlineLimit: 0, target: 'esnext' },
  esbuild: { jsx: 'automatic' },
});
