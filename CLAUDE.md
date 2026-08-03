# PDF Editor engineering guide

A 100% client-side PDF viewer and editor. No server, no upload, no accounts, no
telemetry. Vite 8, React 19, strict TypeScript 6, Tailwind 4, shadcn over Radix, MuPDF via
WebAssembly. Licensed AGPL-3.0-only.

Full context is in [`docs/`](docs/), starting with
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the ADRs in
[`docs/adr/`](docs/adr/).

## This repository is three languages

Each owns a distinct part of the problem. Do not blur the boundaries.

| Language           | Location                       | Owns                                                                                                                                                                           |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C / Emscripten** | `vendor/mupdf-wasm/`           | The forked MuPDF WASM build. Parsing, repair, rendering, structured text, content-stream processing and filtering, annotations, AcroForm, signing structure, incremental save. |
| **Rust / wasm32**  | `crates/pdftext/`              | Fonts and text layout **only**. Shaping, subsetting, bidirectional ordering. A pure function library over bytes.                                                               |
| **TypeScript**     | `lib/`, `entrypoints/`, `web/` | The application, the worker protocol, the render pipeline, and the PDF font-encoding inversion.                                                                                |

The Rust module **never touches the PDF document**. That is a structural invariant, not a
style preference: it is what makes MuPDF's own journal a complete undo history
([ADR 0011](docs/adr/0011-undo-on-the-mupdf-journal.md)).

## Required architecture

- The release surface is `web/index.html` built to `dist/`. One client-side surface, no
  routes, no SSR.
- The main thread owns no MuPDF handle. `mupdf` may be imported **only** inside
  `lib/engine/worker/`; everything else goes through the `PdfEngine` port in
  `lib/engine/port.ts`. Enforced by `eslint.config.js`.
- One `doc.worker` per open document, plus a shared read-only `search.worker` and a lazy direct
  Tesseract OCR worker. Document workers are respawnable because a malformed PDF can trap the
  WASM instance unrecoverably
  ([ADR 0008](docs/adr/0008-worker-topology-and-crash-isolation.md),
  [ADR 0034](docs/adr/0034-bundle-own-origin-ocr.md)).
- Rendering is tiled at no more than 512 by 512 device pixels. `toPixmap()` is not
  cancellable (upstream #190), and tiling is what makes the pipeline cancellable at roughly
  15 ms granularity ([ADR 0010](docs/adr/0010-tiled-render-pipeline.md)).
- Page layout is a prefix sum over page heights, never a DOM measurement.
- Scroll and zoom live outside React. A scroll event must not cause a render pass.
- **No positioned DOM text anywhere.** Selection quads come from `stext.walk`, highlights
  paint to a canvas overlay, assistive technology reads a visually hidden logical-reading-
  order element, and Ctrl+F is intercepted and routed to engine search
  ([ADR 0015](docs/adr/0015-accessibility-and-no-positioned-dom-text.md)).
- Undo is MuPDF's journal. Do not build a command stack
  ([ADR 0011](docs/adr/0011-undo-on-the-mupdf-journal.md)).
- Persistence is OPFS, written from the document worker via `createSyncAccessHandle()`,
  debounced after each committed journal operation, atomic through a temporary entry plus
  rename ([ADR 0017](docs/adr/0017-persistence-via-opfs.md)).
- The engine is single-threaded. No `SharedArrayBuffer`, and **do not add COOP/COEP
  headers**.

## Invariants that must never be weakened

1. **Zero egress.** Never add upload, accounts, telemetry, analytics, error reporting,
   advertising, remote configuration, CDN assets, or any third-party request. Keep the
   exact default-deny CSP in `web/index.html`. `connect-src` is `'self'` only because the
   WASM binary is fetched from our own origin
   ([ADR 0002](docs/adr/0002-client-side-only-zero-egress.md)).

2. **Handle discipline.** All 27 MuPDF wrapper classes require an explicit `.destroy()`
   and there is **no `FinalizationRegistry`**. Every construction is wrapped in
   `arena.keep(...)` or `retain(key, ...)`. Release happens in `finally`, in reverse
   acquisition order, on success, failure, and cancellation alike. Every retained object
   has a named owner and an eviction policy
   ([ADR 0009](docs/adr/0009-wasm-memory-and-handle-discipline.md)).

3. **Project, assert, then mutate.** Compute the cost, assert the ceiling, then touch the
   document. Never the other way round. A ceiling discovered mid-mutation leaves a
   half-edited document no undo can reach. Ceilings are exactly the values in
   `lib/core/limits.ts` ([ADR 0014](docs/adr/0014-resource-ceilings.md)).

4. **The oracle rule.** **MuPDF is never the acceptance reader for output MuPDF
   produced.** Validate with pdf.js and qpdf. A MuPDF round trip proves self-consistency
   and nothing else ([ADR 0019](docs/adr/0019-correctness-oracles.md)).

5. **Content streams are rewritten through the engine.** Use
   `pdf_filter_page_contents` with `pdf_new_sanitize_filter`. Never hand-assemble a
   content stream: it loses graphics state, clipping, transparency groups, and optional
   content in ways invisible until a specific viewer renders it
   ([ADR 0012](docs/adr/0012-content-stream-text-editing.md)).

6. **The browser floor.** Chrome 95, Firefox 131, Safari 15.2, imposed by MuPDF's
   `-fwasm-exceptions` build. It is encoded in `vite.web.config.ts`,
   `tests/e2e/playwright.config.ts`, and
   [ADR 0013](docs/adr/0013-supported-browser-matrix.md), and those three must agree.

7. **The supply-chain denylist.** `rustybuzz` (RUSTSEC-2026-0206), `ttf-parser`
   (RUSTSEC-2026-0192), and `rsa` (RUSTSEC-2023-0071, still unpatched) are excluded and
   enforced by `scripts/check-supply-chain.mjs`. Also excluded by decision: RustCrypto
   `cms` (pre-release, unverified detached-signature support) and `wasm-pack` (archived
   July 2025) ([ADR 0005](docs/adr/0005-rust-font-module-scope.md)).

8. **Accessibility.** WCAG 2.2 AA for all chrome. Keyboard operation for every command,
   visible focus everywhere, `role="alert"` errors, reduced-motion and forced-colors
   support, and reflow at 200% zoom
   ([ADR 0015](docs/adr/0015-accessibility-and-no-positioned-dom-text.md)).

9. **The token layer.** Components reference semantic tokens only, never palette tokens
   and never raw values. Density is a token, not a component concern. Light and dark are
   peers. `--page-paper` is not tinted
   ([ADR 0016](docs/adr/0016-density-aware-design-tokens.md)).

10. **Say what is true.** Never describe a planned capability as shipped. Signing does
    not do timestamping, revocation checking, or LTV, and the product must say so
    ([ADR 0018](docs/adr/0018-signing-via-custom-signer-vtable.md)).

## Verify capability against source, not docs

MuPDF's published reference documents the union of the WebAssembly build and the
`mutool run` desktop interpreter. Many documented methods are marked `[mutool run only]`
and **do not exist in the browser build**. Check `platform/wasm/lib/mupdf.c` at the
version in use. It is 2,944 lines with 331 unique `wasm_` symbols, and reading it is
faster than debugging a wrong assumption.

## Resource and format contracts

`lib/core/limits.ts` is normative. Desktop: 512 MiB input, 10,000 pages, 14,400 pt page
side, 1,400,000,000 byte soft heap ceiling, 4,000,000 pixel single render, 384 MiB bitmap
cache. iOS: 200 MiB, 4,000 pages, 700,000,000 bytes, 1,000,000 pixels, 160 MiB. The wasm32
hard ceiling is 2,147,483,648 bytes, and exceeding it **aborts rather than throws**. iOS
Safari kills the tab with no catchable error, which is why its budget is measured rather
than scaled.

Overflow-prone arithmetic uses `BigInt` and clamps. A `2^30 x 2^30` render computed as
`Number` wraps to a small float and sails past the very check meant to catch it.

Every rejection is a `LimitError` with a code from the closed set in `limits.ts` and a
message written for the person who hit it: the actual number, the limit, and what to do
next.

## Commands

```sh
npm run dev              # Vite dev server
npm run build            # build:wasm then build:web
npm run build:web        # web app only
npm run build:wasm       # the forked MuPDF WASM (needs Emscripten)
npm run build:vercel     # manifest-only freshness check, then build:web
npm run preview          # serve the production build

npm run typecheck        # tsc --noEmit
npm run lint             # lint:js + lint:rust
npm run test             # test:js + test:rust
npm run test:e2e         # Playwright against the production build
npm run check            # typecheck + lint + test

npm run check:wasm:fresh # committed artifacts match their source
npm run check:egress     # no third-party URL in shipped output
npm run check:size       # bundle budgets
npm run check:supply     # denylist, cargo audit, npm audit

npm run format           # prettier -w .
npm run format:check     # prettier -c .
```

`scripts/cargo.mjs` and `scripts/build-wasm.mjs` exit 0 when their toolchain or source
tree is absent, so a TypeScript-only contributor is never blocked. CI has all three
toolchains and is where those gates actually bite.

If your shell exports `NODE_ENV=production`, `npm ci` skips `devDependencies` and the
build fails on a missing `vite`. Use `npm ci --include=dev`.

## Definition of done

- `npm run check` passes.
- `npm run build:web` succeeds, then `npm run check:egress` and `npm run check:size` pass
  against that fresh `dist/`.
- `npm run test:e2e` passes in Chromium and Firefox against the production build.
- Changed behaviour has a test that would fail without the change, including its boundary
  and error paths. No test, assertion, or coverage was weakened.
- Any document the change writes is validated with **pdf.js or qpdf**, never MuPDF.
- Any change to the C shim or the Rust crate ships rebuilt artifacts and a regenerated
  `vendor/wasm-manifest.json`, with `npm run check:wasm:fresh` passing in full mode.
- Any dependency change is exact-pinned, recorded in `docs/THIRD-PARTY.md`, and passes
  `npm run check:supply`.
- The changed UI was driven in a browser, in all three densities and both themes, with
  keyboard-only operation checked and reduced motion actually exercised.
- A decision with lasting consequences has an ADR in the same pull request; user-visible
  changes are in `docs/CHANGELOG.md`; a durable lesson is in `docs/LEARNINGS.md` or
  `docs/history/`.
- No attribution to generative or automated tooling anywhere in the diff, commits, pull
  request, or artifacts.

The full per-pull-request checklist, including the merge blockers, is
[`docs/qa/review-rubric.md`](docs/qa/review-rubric.md).
