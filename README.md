# PDF Editor

A private, local-first PDF viewer and editor for the web. Open, read, annotate, fill,
edit, redact, and sign PDFs in the browser. The document never leaves your device.

There is no server, no upload, no account, and no telemetry. That is not a policy, it is
the deployment: static hosting with no function, no middleware, and no endpoint that could
receive a document. The absence of third-party traffic is proved by an executable gate
rather than a privacy page.

## Status

Early. The repository currently contains the build, the resource-ceiling contract, the
design token system, a structural editor shell, the CI gates, and the architecture
decision records. The engine layers are designed and recorded but not yet built.
[`docs/ROADMAP.md`](docs/ROADMAP.md) is honest about what exists.
[`docs/PRODUCT-SPEC.md`](docs/PRODUCT-SPEC.md) is deliberately a stub until the de-risking
spikes report, because a specification written before them would be a promise nobody has
checked.

## How it works

Three engine layers, in three languages:

- **A forked MuPDF WebAssembly build** (C, Emscripten) for parsing, repair, rendering,
  structured text, content-stream processing, annotations, forms, and saving. The fork adds
  four things the stock WASM shim does not export
  ([ADR 0004](docs/adr/0004-fork-the-mupdf-wasm-build.md)).
- **A small Rust module** (`crates/pdftext`) for shaping, font subsetting, and
  bidirectional ordering. It never touches the document
  ([ADR 0005](docs/adr/0005-rust-font-module-scope.md)).
- **TypeScript** for the application, the worker protocol, the tiled render pipeline, and
  the PDF font-encoding inversion that in-place text editing depends on
  ([ADR 0012](docs/adr/0012-content-stream-text-editing.md)).

More in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Supported browsers

Chrome, Chromium, and Edge 95+; Firefox 131+; Safari 15.2+ on desktop. The floor is set by
MuPDF's `-fwasm-exceptions` build, which requires native WebAssembly exception handling.
iOS and iPadOS are supported under a materially lower resource budget
([ADR 0013](docs/adr/0013-supported-browser-matrix.md)).

## Development

```sh
npm ci
npm run dev
```

Production:

```sh
npm run check          # typecheck, lint, test
npm run build:web
npm run check:egress
npm run check:size
npm run preview
```

Working on the engine layers additionally needs Emscripten and a Rust toolchain with the
`wasm32-unknown-unknown` target. Built WASM artifacts are committed, so a TypeScript-only
contributor needs neither. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licence

[AGPL-3.0-only](LICENSE). This follows from MuPDF, which is AGPL-3.0-or-later
([ADR 0003](docs/adr/0003-mupdf-as-the-engine-and-agpl.md)). Because the application is
served over a network, section 13 applies: users of the deployed site are offered the
corresponding source of the version they are running.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Vision and non-goals](docs/VISION.md)
- [Design](docs/DESIGN.md)
- [Decision records](docs/adr/)
- [Third-party software](docs/THIRD-PARTY.md)
- [Roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
