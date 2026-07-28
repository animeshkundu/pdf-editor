import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const PRODUCTION_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const DEVELOPMENT_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

function developmentCsp() {
  return {
    name: 'development-csp',
    apply: 'serve' as const,
    transformIndexHtml(html: string) {
      if (!html.includes(PRODUCTION_CSP)) {
        throw new Error('The production CSP changed without updating the dev-only transform.');
      }
      return html.replace(PRODUCTION_CSP, DEVELOPMENT_CSP);
    },
  };
}

function engineChunk(id: string): string | undefined {
  return id.includes('node_modules/mupdf') || id.includes('/vendor/mupdf-wasm/')
    ? 'engine'
    : undefined;
}

// The editor is a single client-side surface. There is no server, no SSR, and no
// route table: navigation is application state. Vite is used over a meta-framework
// because per-document Web Workers loading a ~10 MB WASM binary are first-class here
// (`new Worker(new URL(...), { type: 'module' })` and `?url` asset imports), and a
// meta-framework's bundler assumptions would fight that for features we never use.
export default defineConfig({
  root: 'web',
  plugins: [developmentCsp(), react(), tailwindcss()],
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
        manualChunks: engineChunk,
      },
    },
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        manualChunks: engineChunk,
      },
    },
  },
  // MuPDF ships a prebuilt .wasm that must not be pre-bundled or inlined.
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  assetsInclude: ['**/*.wasm'],
});
