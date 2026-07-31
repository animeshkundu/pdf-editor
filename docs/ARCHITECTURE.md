# PDF Editor architecture

A 100% client-side PDF viewer and editor. No server, no upload, no account, no
telemetry. The document never leaves the device, and that claim is enforced by the gates
described below rather than asserted in copy.

> **Read this as the target architecture.** It is written in the present tense because it
> is the contract every change is reviewed against, not a report of what is built. Today
> the repository contains the build, resource ceilings, design tokens, the Phase 3 viewer,
> its document and search workers, the tiled render pipeline, the mutating engine port,
> journal undo, local save/export, annotation and page-operation verticals, and the initial
> `lib/text/` and `lib/store/` layers. The full parity inventory remains a multi-year contract.
> [`ROADMAP.md`](ROADMAP.md) is the source of truth for what exists.

## Runtime

`site/index.html` is the static landing page and `web/index.html` mounts the React
application from `entrypoints/app/`. The application document carries the default-deny
Content Security Policy and the default `data-density` attribute. `vite.web.config.ts`
builds the application to `dist/`; Build Output API routes publish the landing page at
`/pdf/` and the application at `/pdf/app/`. There is no server or server rendering, and
navigation inside the editor remains application state
([ADR 0007](adr/0007-vite-over-a-meta-framework.md),
[ADR 0027](adr/0027-prebuilt-mounted-vercel-deployment.md)).

The main thread owns the UI and never owns a MuPDF handle. All engine work happens in
workers ([ADR 0008](adr/0008-worker-topology-and-crash-isolation.md)):

- **`doc.worker`**, one per open document. Owns that document's handle, journal, render
  queue, and handle arena. Respawnable, because a malformed PDF can trap the WASM
  instance unrecoverably.
- **`search.worker`**, one shared read-only instance for full-document search.
- **`ocr.worker`**, lazily created and torn down when idle.

The engine is single-threaded, so there is no `SharedArrayBuffer` and no COOP/COEP
requirement.

## The three engine layers

This repository is **three languages**, and each owns a distinct part of the problem.

### 1. C and Emscripten: the forked MuPDF WASM build

MuPDF 1.28.0 is the document engine ([ADR 0003](adr/0003-mupdf-as-the-engine-and-agpl.md)).
Its C API already contains what the hard features need, but its WebAssembly shim
(`platform/wasm/lib/mupdf.c`, 2,944 lines and 331 unique `wasm_` symbols) does not export
it. We
maintain an additive fork ([ADR 0004](adr/0004-fork-the-mupdf-wasm-build.md)) that adds:

- a `js_processor` bridging `pdf_processor`, MuPDF's complete content-stream operator
  vtable, into JavaScript, delivering a resolved `pdf_font_desc` from `op_Tf`, the cooked
  marked-content dictionary from `op_BDC`, and a decoded image from `op_BI`;
- `pdf_filter_page_contents` with `pdf_new_sanitize_filter`, for safe content-stream
  rewriting and true redaction;
- `mujs=yes` in the build FEATURES, plus worker-local event and console bridges for observable
  AcroForm and document JavaScript without honoring external side effects;
- a custom `pdf_pkcs7_signer` whose `create_digest` calls into JavaScript
  ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md)).

The fork changes no MuPDF behaviour. Every patch is additive surface area, so rebasing
onto a new upstream release stays tractable.

### 2. Rust and WebAssembly: fonts and text layout only

`crates/pdftext` shapes text, subsets fonts, and orders bidirectional runs
([ADR 0005](adr/0005-rust-font-module-scope.md)). It uses `harfrust` (not `rustybuzz`,
RUSTSEC-2026-0206 unmaintained), Fontations `skrifa` / `read-fonts` / `write-fonts` (not
`ttf-parser`, RUSTSEC-2026-0192 unmaintained), `subsetter`, and `unicode-bidi`. It is
built with `wasm-bindgen-cli` and `wasm-opt`, not `wasm-pack`, which was archived when
the rustwasm organisation was sunset in July 2025.

It is a pure function library over bytes. **It never touches the PDF document.** That
boundary is what makes MuPDF's own journal a complete undo history
([ADR 0011](adr/0011-undo-on-the-mupdf-journal.md)).

### 3. TypeScript: the application and guarded text replacement

Everything else. The repository retains encoding-inversion analysis, but it is not a product
write path: `/ToUnicode` cannot safely generate character codes, and the earlier broad path
destroyed a CJK selection while reporting success. The shipped existing-text path is instead
the narrow transactional mechanism in
[ADR 0028](adr/0028-guarded-content-removal-and-existing-text-replacement.md): native glyph
removal, a standard-font appearance, strict refusal classes, and pre-commit postconditions.

## Module map

- `lib/core/`: resource ceilings and the project-assert-then-mutate gate
  (`limits.ts`), plus framework-free helpers.
- `lib/engine/port.ts`: the `PdfEngine` port. Plain serialisable values, no handles.
  The only way the application talks to the engine.
- `lib/engine/worker/`: the only place `mupdf` may be imported. Arena-owned handles,
  the journal, the render queue.
- `lib/render/`: tile geometry, the prefix-sum layout, the priority queue, and the
  bitmap cache ([ADR 0010](adr/0010-tiled-render-pipeline.md)).
- `lib/text/`: structured text, selection quads, hit testing, and read-side encoding
  analysis.
- `lib/store/`: Zustand state. Scroll and zoom are kept out of React entirely.
- `entrypoints/app/`: the editor shell, panels, dialogs, command bus, and tool registry,
  each in its own module.
- `assets/tailwind.css`: the two-tier design token system
  ([ADR 0016](adr/0016-density-aware-design-tokens.md)).
- `scripts/`: the build and the gates.

## Rendering

Tiled at no more than 512 by 512 device pixels. `toPixmap()` is not cancellable (upstream
issue #190), so tiling is what converts an uncancellable primitive into a pipeline
cancellable at roughly 15 ms granularity. Page positions come from a prefix sum over page
heights, never from DOM measurement, so a 10,000-page document costs the same to lay out
as a one-page document.

There is **no positioned DOM text anywhere**
([ADR 0015](adr/0015-accessibility-and-no-positioned-dom-text.md)). Selection quads come
from `stext.walk`, highlights paint to a canvas overlay, assistive technology reads a
visually hidden element carrying logical reading order, and Ctrl+F is intercepted and
routed to engine search.

## Memory

MuPDF's binding exposes 27 classes that each require an explicit `.destroy()`, and there
is **no `FinalizationRegistry`**. A leaked `Pixmap` leaks until the page reloads, and this
is the single most common production failure in mupdf.js
([ADR 0009](adr/0009-wasm-memory-and-handle-discipline.md)).

`eslint.config.js` enforces the discipline: `mupdf` may only be imported inside
`lib/engine/worker/`, and inside that directory a bare `new mupdf.X()` is a lint error.
Every handle must be wrapped in `arena.keep(...)` or `retain(key, ...)` so it is released
deterministically, in reverse order, in a `finally` block.

wasm32 linear memory cannot exceed 2 GiB, and exceeding it aborts rather than throws.
iOS Safari kills the tab far below that with no catchable error. Ceilings for both are in
`lib/core/limits.ts` and [ADR 0014](adr/0014-resource-ceilings.md).

## Persistence

OPFS, written from the document worker through `createSyncAccessHandle()`, which is
available in worker contexts only ([ADR 0017](adr/0017-persistence-via-opfs.md)). Writes
are debounced after each committed journal operation and are atomic through a temporary
entry plus rename. Recovery after a worker crash is offered explicitly, never silently.

## Security and publication

The CSP in `web/index.html` is default-deny. `connect-src` is `'self'` rather than
`'none'` because the WASM binary is fetched from our own origin at runtime; the
zero-egress guarantee is instead proved by `scripts/check-no-egress.mjs`, which fails on
any absolute URL in the shipped output that is not same-origin, and by
`tests/e2e/shell.e2e.ts`, which fails if the running app contacts any foreign origin
([ADR 0002](adr/0002-client-side-only-zero-egress.md)).

Built WASM artifacts are committed so Vercel can deploy without Emscripten or Rust.
`vendor/wasm-manifest.json` records source and artifact digests, and
`scripts/check-wasm-fresh.mjs` proves the correspondence
([ADR 0006](adr/0006-three-toolchain-build-and-committed-wasm.md)).

`scripts/check-supply-chain.mjs` denies `rustybuzz`, `ttf-parser`, and `rsa` by name and
runs `cargo audit` and `npm audit`. `scripts/check-bundle-size.mjs` budgets the initial
bundle separately from lazily loaded WASM.

## Tests

Vitest covers framework-free kernels in `lib/`, including the exact ceilings in
`tests/limits.test.ts`. Playwright drives the **production build**, not the dev server,
because WASM loading, worker instantiation, and chunk splitting all behave differently
under Vite's dev transform.

Correctness of anything we write is judged by an independent reader. **MuPDF is never the
acceptance reader for MuPDF's output**; pdf.js and qpdf are
([ADR 0019](adr/0019-correctness-oracles.md)).

## Decision records

The full set is in [`adr/`](adr/), starting with
[0001](adr/0001-record-architecture-decisions.md). Several are cited directly from the
code they govern: `eslint.config.js` cites 0009, `vite.web.config.ts` cites 0013, and
`scripts/build-wasm.mjs` cites 0004.
