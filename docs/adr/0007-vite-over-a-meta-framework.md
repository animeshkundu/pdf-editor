# 0007. Vite rather than a meta-framework

## Status

Accepted

## Date

2026-07-26

## Context

The default reflex for a new React project in 2026 is Next.js, Remix, or TanStack Start.
Each brings routing, server rendering, data loading, and a deployment story.

This application has no server, no routes, and no data loading. It is one client-side
surface; navigation is application state, not a URL table. Server rendering an editor
whose entire content comes from a file the user picks locally is not merely unnecessary,
it is impossible.

What the application does need from a bundler is unusual and specific:

- `new Worker(new URL('./doc.worker.ts', import.meta.url), { type: 'module' })` must
  produce a real, separately chunked ES module worker, one instance per document.
- A roughly 10 MB `.wasm` binary must be emitted as a plain asset, not inlined, not
  pre-bundled, and not transformed.
- The engine must be split into its own chunk so the application shell paints before the
  WASM glue is parsed.
- The build target must be pinned to the browser floor imposed by the engine's
  exception-handling model ([ADR 0013](0013-supported-browser-matrix.md)).

Meta-framework bundlers make assumptions about module graphs, server boundaries, and
asset handling that conflict with all four, in exchange for features this product will
never use.

## Decision

Build with Vite 8.1.5 and `@vitejs/plugin-react`, configured in `vite.web.config.ts`.

The configuration encodes the requirements above:

- `worker.format: 'es'`, so workers are real ES modules.
- `optimizeDeps.exclude: ['mupdf']` and `assetsInclude: ['**/*.wasm']`, so the prebuilt
  binary is never pre-bundled or inlined.
- `manualChunks` routes `node_modules/mupdf` into an `engine` chunk, enforced by
  `scripts/check-bundle-size.mjs`, which budgets the initial bundle separately from
  lazily loaded WASM. A combined ceiling would let a doubling of our own JavaScript hide
  behind a 3.4 MB engine.
- `build.target: ['chrome95', 'firefox131', 'safari15.2']`.
- `modulePreload.polyfill: false`, because the polyfill injects a `fetch` shim that
  would trip `scripts/check-no-egress.mjs` ([ADR 0002](0002-client-side-only-zero-egress.md)).
- `sourcemap: false` for production.

Routing, if it is ever needed for deep links into a document, will be a hash or history
state read by the application, not a framework router.

## Consequences

### Positive

- Worker and WASM handling is first-class and configured explicitly rather than fought.
- The dependency surface stays small, which matters under
  [ADR 0003](0003-mupdf-as-the-engine-and-agpl.md)'s licence-compatibility constraint.
- Build output is a plain static directory, which is exactly what
  [ADR 0006](0006-three-toolchain-build-and-committed-wasm.md) needs.

### Negative

- No file-system routing, no framework data layer, no server rendering. If any of those
  ever becomes desirable, it is a rewrite of the shell rather than a configuration change.
- Some ecosystem tooling assumes a meta-framework and will not apply.

### Neutral

- End-to-end tests run against the production build via `npm run preview`, not the dev
  server, because WASM loading, worker instantiation, and chunk splitting all behave
  differently under Vite's dev transform. See `tests/e2e/playwright.config.ts`.

## Notes

Configured in `vite.web.config.ts`, which carries the same reasoning as a comment.
Budgeted by `scripts/check-bundle-size.mjs`.
