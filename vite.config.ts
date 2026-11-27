import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Self-hosted OCR worker, WebAssembly core, and English traineddata served
 * locally under `/ocr/*` so client-side scanned-PDF OCR never touches a CDN.
 */
const OCR_ASSETS: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  ...Object.fromEntries(
    ['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((variant) => [
      `ocr/core/tesseract-core-${variant}.wasm.js`,
      `node_modules/tesseract.js-core/tesseract-core-${variant}.wasm.js`,
    ]),
  ),
  'ocr/lang/eng.traineddata.gz':
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

function ocrAssets(): Plugin {
  let root = '.';
  return {
    name: 'ocr-assets',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const src = OCR_ASSETS[key];
        if (!src) {
          return next();
        }
        res.setHeader(
          'Content-Type',
          src.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
        );
        res.end(readFileSync(resolve(root, src)));
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(OCR_ASSETS)) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(resolve(root, src)),
        });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), ocrAssets()],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
});
