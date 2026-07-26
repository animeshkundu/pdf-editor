# Repository instructions

Read and follow [`CLAUDE.md`](CLAUDE.md) before making changes. The architecture and
release contracts are recorded in [`docs/`](docs/), especially the ADRs in
[`docs/adr/`](docs/adr/).

This repository is three languages: C with Emscripten (the forked MuPDF WASM build), Rust
compiled to wasm32 (fonts and text layout only), and TypeScript (the application). The
Rust module never touches the PDF document.

Do not weaken any of the following:

- Zero egress: no upload, accounts, telemetry, analytics, error reporting, advertising, or
  third-party requests. Keep the exact default-deny CSP in `web/index.html`.
- WASM handle discipline: `mupdf` is imported only inside `lib/engine/worker/`, and every
  handle is arena-owned and released in `finally`. There is no `FinalizationRegistry`.
- Project, assert, then mutate. The ceilings in `lib/core/limits.ts` are the contract.
- The oracle rule: MuPDF is never the acceptance reader for output MuPDF produced. Use
  pdf.js and qpdf.
- Content-stream rewrites through `pdf_filter_page_contents` with
  `pdf_new_sanitize_filter`. Never hand-assemble a content stream.
- The Chrome 95 / Firefox 131 / Safari 15.2 floor, and no COOP/COEP headers.
- The supply-chain denylist: `rustybuzz`, `ttf-parser`, `rsa`.
- WCAG 2.2 AA chrome, the semantic-token layer, and the three density modes.

Verify engine capability against `platform/wasm/lib/mupdf.c`, not the published MuPDF
reference, which documents the union of the WASM build and the `mutool run` interpreter.

Never describe a planned capability as shipped, and never attribute work to generative or
automated tooling.
