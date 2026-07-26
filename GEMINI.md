# Repository instructions

Follow [`CLAUDE.md`](CLAUDE.md) and the accepted ADRs under [`docs/adr/`](docs/adr/).

This is a 100% client-side PDF viewer and editor built on a forked MuPDF WebAssembly
build. Three languages: C with Emscripten (the engine fork), Rust compiled to wasm32
(fonts and text layout only, never touching the document), and TypeScript (everything
else).

Guardrails that must not be weakened:

- Zero egress, and the exact default-deny CSP in `web/index.html`.
- MuPDF handle discipline: worker-only imports, arena-owned handles, release in `finally`.
  There is no `FinalizationRegistry`.
- Project, assert, then mutate, against the exact ceilings in `lib/core/limits.ts`.
- Acceptance by pdf.js and qpdf, never by MuPDF itself.
- Content-stream rewrites via `pdf_filter_page_contents` with `pdf_new_sanitize_filter`.
- Chrome 95 / Firefox 131 / Safari 15.2, single-threaded, no COOP/COEP.
- The denylist: `rustybuzz`, `ttf-parser`, `rsa`.
- WCAG 2.2 AA chrome, semantic tokens only, three densities, light and dark as peers.

Check engine capability against `platform/wasm/lib/mupdf.c` rather than the published
MuPDF documentation, which describes a superset of the WebAssembly build.

Do not describe planned capabilities as shipped. Do not attribute work to generative or
automated tooling.
