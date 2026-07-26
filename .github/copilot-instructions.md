# PDF Editor repository guide

Follow [`CLAUDE.md`](../CLAUDE.md) and the ADRs in [`docs/adr/`](../docs/adr/).

A 100% client-side PDF viewer and editor. Three languages: C with Emscripten (the forked
MuPDF WASM build), Rust on wasm32 (fonts and text layout only, never touching the
document), and TypeScript (the application, the worker protocol, the render pipeline, and
the PDF font-encoding inversion).

Preserve:

- The zero-egress posture and the exact default-deny CSP in `web/index.html`. No upload,
  accounts, telemetry, analytics, or third-party requests.
- MuPDF handle discipline. `mupdf` imports only in `lib/engine/worker/`; every handle
  arena-owned and released in `finally`; there is no `FinalizationRegistry`.
- Project, assert, then mutate, against the exact ceilings in `lib/core/limits.ts`.
- One respawnable `doc.worker` per document; tiled rendering at 512 px; no positioned DOM
  text; undo on MuPDF's journal.
- Acceptance by pdf.js and qpdf. MuPDF is never the acceptance reader for its own output.
- Content-stream rewrites through `pdf_filter_page_contents` with
  `pdf_new_sanitize_filter`.
- Chrome 95 / Firefox 131 / Safari 15.2, single-threaded, no COOP/COEP headers.
- The supply-chain denylist: `rustybuzz`, `ttf-parser`, `rsa`.
- WCAG 2.2 AA chrome, semantic tokens only, three density modes, light and dark as peers.

Verify engine capability against `platform/wasm/lib/mupdf.c` rather than MuPDF's published
reference, which documents the union of the WASM build and the `mutool run` interpreter.

Use exact-pinned dependencies, update `docs/THIRD-PARTY.md`, and run `npm run check`, the
production build, and the egress, size, and supply-chain gates before handoff. Never
describe a planned capability as shipped, and never attribute work to generative or
automated tooling.
