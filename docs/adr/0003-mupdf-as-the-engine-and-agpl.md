# 0003. MuPDF as the engine, and accepting the AGPL consequence

## Status

Accepted

## Date

2026-07-26

## Context

A viewer and a full editor need very different things from a PDF library. A viewer
needs parsing and rasterisation. An editor needs to mutate the object graph in place,
rewrite content streams, edit AcroForm and annotation dictionaries, save incrementally
so existing signatures survive, and repair damaged files well enough to open them at
all.

The realistic candidates were:

- **pdf.js.** Excellent rasteriser, deliberately not an editor. Its object model is not
  designed for mutation and it cannot write a document.
- **pdf-lib.** Pure TypeScript and pleasant, but it has no rasteriser, no text layout,
  no content-stream processor, and no repair path. It composes documents; it does not
  edit rendered content.
- **`krilla`.** Creation-only by design. It cannot open and modify an existing document,
  which is the entire product.
- **PDFium.** Capable and permissively licensed, but its editing surface for content
  streams is thin, its WASM story is unofficial, and its build is far heavier to fork.
- **MuPDF.** A complete PDF implementation: parser, repair, renderer, structured text
  extraction, content-stream processor and filter, annotations, AcroForm, redaction,
  and incremental save. It ships an official WebAssembly build, `mupdf` on npm.

MuPDF is licensed AGPL-3.0-or-later. Artifex sells a commercial licence; we are not
buying one.

## Decision

Use MuPDF 1.28.0 as the document engine, and license the entire project AGPL-3.0-only.

`package.json` declares `"license": "AGPL-3.0-only"`, and the repository carries the
full AGPL text in `LICENSE`. Because the application is conveyed to users over a
network, section 13 of the AGPL applies: users must be offered the corresponding source
of the version they are running. The deployed site therefore links to the repository and
identifies the exact commit it was built from.

No proprietary or licence-incompatible dependency may be linked into the shipped
bundle. Every shipped component is recorded in [`../THIRD-PARTY.md`](../THIRD-PARTY.md)
with its SPDX identifier, and a new one with an incompatible licence is a merge blocker.

## Consequences

### Positive

- We get a complete, battle-tested PDF implementation, including the parts nobody wants
  to write twice: the repair path, the CMap and font machinery, and the content-stream
  processor that ADR 0012 depends on.
- AGPL is a coherent match for a privacy product. The user can verify what the code
  running in their browser does.

### Negative

- The licence rules out closed-source reuse, closed forks, and any future commercial
  variant that does not either buy an Artifex licence or replace the engine.
- Every dependency must be AGPL-compatible forever. That constraint alone eliminated
  several otherwise attractive libraries.

### Neutral

- Artifex's commercial licence remains available if the project's needs ever change.
  Nothing about this decision is technically irreversible; only the licensing is.

## Notes

The fork of the WASM build and its own licence implications are in
[ADR 0004](0004-fork-the-mupdf-wasm-build.md). The engine's runtime constraints are in
[ADR 0009](0009-wasm-memory-and-handle-discipline.md),
[ADR 0010](0010-tiled-render-pipeline.md), and
[ADR 0014](0014-resource-ceilings.md).
