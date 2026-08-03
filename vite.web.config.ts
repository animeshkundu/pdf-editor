import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  deriveOfflineCacheVersion,
  deriveOfflineWorkerLogicDigest,
} from './scripts/offline-cache-version';
import { OCR_VERSIONS } from './scripts/ocr-versions';
import { renderServiceWorkerSource } from './scripts/service-worker-source';

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

function bundledOcrAssets(): Plugin {
  const remoteDefault = 'https://cdn.jsdelivr.net/npm/';
  const workerSource = readFileSync(
    fileURLToPath(new URL('./node_modules/tesseract.js/dist/worker.min.js', import.meta.url)),
    'utf8',
  );
  const patchedWorker = workerSource.replaceAll(remoteDefault, './');
  if (patchedWorker === workerSource) {
    throw new Error('The Tesseract worker no longer contains the expected remote defaults.');
  }
  const coreNames = [
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ] as const;
  const cores = coreNames.map((name) => ({
    name,
    source: readFileSync(
      fileURLToPath(new URL(`./node_modules/tesseract.js-core/${name}`, import.meta.url)),
    ),
  }));
  const language = readFileSync(
    fileURLToPath(
      new URL(
        './node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
        import.meta.url,
      ),
    ),
  );

  return {
    name: 'bundled-own-origin-ocr',
    enforce: 'pre',
    transform(code, id) {
      const normalized = id.replaceAll('\\', '/');
      if (
        !normalized.includes('/node_modules/tesseract.js/') ||
        !code.includes(remoteDefault)
      ) {
        return null;
      }
      return { code: code.replaceAll(remoteDefault, './'), map: null };
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: `ocr/tesseract-${OCR_VERSIONS.tesseract}/worker.min.js`,
        source: patchedWorker,
      });
      for (const core of cores) {
        this.emitFile({
          type: 'asset',
          fileName: `ocr/tesseract-${OCR_VERSIONS.core}/${core.name}`,
          source: core.source,
        });
      }
      this.emitFile({
        type: 'asset',
        fileName: `ocr/eng-${OCR_VERSIONS.language}/eng.traineddata.gz`,
        source: language,
      });
    },
  };
}

function offlineAppShell(base: string): Plugin {
  const manifest = readFileSync(
    fileURLToPath(new URL('./vendor/wasm-manifest.json', import.meta.url)),
    'utf8',
  );
  const manifestDigest = createHash('sha256').update(manifest).digest('hex');
  const configDigest = deriveOfflineWorkerLogicDigest([
    readFileSync(fileURLToPath(import.meta.url)),
    readFileSync(fileURLToPath(new URL('./scripts/service-worker-source.ts', import.meta.url))),
  ]);
  return {
    name: 'offline-app-shell',
    apply: 'build' as const,
    enforce: 'post',
    generateBundle(_options, bundle) {
      const outputBytes = (output: (typeof bundle)[string]): Uint8Array | string =>
        output.type === 'asset' ? output.source : output.code;
      const assets = Object.keys(bundle)
        .filter(
          (file) =>
            file !== 'index.html' &&
            file !== 'sw.js' &&
            !file.endsWith('.map') &&
            !file.startsWith('ocr/'),
        )
        .sort();
      const byteLength = (value: Uint8Array | string): number =>
        typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength;
      const indexOutput = bundle['index.html'];
      if (!indexOutput) {
        throw new Error(
          'The offline app shell cannot be versioned without emitted index.html.',
        );
      }
      const versionAssets = [
        ...assets.map((file) => ({
          path: file,
          bytes: outputBytes(bundle[file]!),
        })),
        { path: 'index.html', bytes: outputBytes(indexOutput) },
      ];
      const cacheVersion = deriveOfflineCacheVersion({
        manifestDigest,
        configDigest,
        base,
        assets: versionAssets,
      });
      const precacheBytes =
        assets.reduce((total, file) => total + byteLength(outputBytes(bundle[file]!)), 0) +
        byteLength(outputBytes(indexOutput));
      const shellDocumentDigest = createHash('sha256')
        .update(outputBytes(indexOutput))
        .digest('hex');
      const source = renderServiceWorkerSource({
        manifestDigest,
        shellDocumentDigest,
        cacheVersion,
        base,
        assets,
        precacheBytes: Math.ceil(precacheBytes * 1.1),
      });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Where the app is mounted. Defaults to the domain root, which is what a standalone
// Vercel deployment serves and what every gate and the Playwright suite assume.
//
// It is configurable because the sibling deployment at tools.kundus.in mounts each app
// under a path and serves its assets from a distinct prefix, so two apps on one domain
// cannot collide over /assets/. Hardcoding a prefix would break the standalone URL, and
// hardcoding root makes a path-mounted deployment impossible; an env var is the only
// option that serves both without a second build config.
//
// Must have a leading and trailing slash: Vite joins it to asset paths verbatim, and a
// missing trailing slash silently yields /pdfassets/... rather than /pdf/assets/...
function resolveBase(): string {
  const configured = process.env.PDF_EDITOR_BASE?.trim();
  if (!configured) return '/';
  if (!configured.startsWith('/') || !configured.endsWith('/')) {
    throw new Error(
      `PDF_EDITOR_BASE must start and end with "/", got ${JSON.stringify(configured)}. ` +
        'Example: /pdf-editor/',
    );
  }
  return configured;
}

// The editor is a single client-side surface. There is no server, no SSR, and no
// route table: navigation is application state. Vite is used over a meta-framework
// because per-document Web Workers loading a ~10 MB WASM binary are first-class here
// (`new Worker(new URL(...), { type: 'module' })` and `?url` asset imports), and a
// meta-framework's bundler assumptions would fight that for features we never use.
export default defineConfig({
  root: 'web',
  base: resolveBase(),
  plugins: [
    developmentCsp(),
    bundledOcrAssets(),
    offlineAppShell(resolveBase()),
    react(),
    tailwindcss(),
  ],
  define: {
    __TESSERACT_VERSION__: JSON.stringify(OCR_VERSIONS.tesseract),
    __TESSERACT_CORE_VERSION__: JSON.stringify(OCR_VERSIONS.core),
    __TESSERACT_LANGUAGE_VERSION__: JSON.stringify(OCR_VERSIONS.language),
  },
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
