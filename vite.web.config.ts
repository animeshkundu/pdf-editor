import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The editor is a single client-side surface. There is no server, no SSR, and no
// route table: navigation is application state. Vite is used over a meta-framework
// because per-document Web Workers loading a ~10 MB WASM binary are first-class here
// (`new Worker(new URL(...), { type: 'module' })` and `?url` asset imports), and a
// meta-framework's bundler assumptions would fight that for features we never use.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Baseline is bounded by MuPDF's `-fwasm-exceptions` build, which requires native
    // WebAssembly exception handling. See docs/adr/0013-supported-browser-matrix.md.
    target: ['chrome95', 'firefox131', 'safari15.2'],
    sourcemap: false,
    // The polyfill injects a `fetch` shim that would trip scripts/check-no-egress.mjs.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Keep the engine out of the entry chunk so the app shell paints before the
        // WASM glue is parsed. Enforced by scripts/check-bundle-size.mjs.
        manualChunks(id: string) {
          if (id.includes('node_modules/mupdf')) return 'engine';
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  // MuPDF ships a prebuilt .wasm that must not be pre-bundled or inlined.
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  assetsInclude: ['**/*.wasm'],
});
