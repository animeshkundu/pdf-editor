# 0008. One worker per document, plus shared search and OCR workers

Superseded in part by [ADR 0034](0034-bundle-own-origin-ocr.md) for the OCR worker owner.

## Status

Accepted

## Date

2026-07-26

## Context

MuPDF's WebAssembly build is single-threaded. It is not compiled with pthreads, which
means **no `SharedArrayBuffer` and therefore no COOP/COEP headers are required**. That
is a significant simplification: cross-origin isolation constrains embedding, breaks
some third-party integrations, and is a common source of deployment problems. We avoid
all of it.

Being single-threaded also means all engine work is serialised inside one instance. Any
long operation blocks whatever shares that instance.

The decisive constraint, though, is failure behaviour. A malformed PDF can drive MuPDF
into an out-of-bounds memory access. In WebAssembly that is a trap, and a trap is
**unrecoverable**: the instance is dead, its linear memory is gone, and nothing running
in it can be resumed. There is no exception to catch and no state to salvage. If that
instance were shared, one bad file would take down every open document.

`toPixmap()` compounds it. It is not cancellable (upstream issue #190), so a render
already in flight cannot be abandoned; it can only be waited out or thrown away with the
whole instance.

## Decision

Three worker roles, with different lifetimes.

### `doc.worker`, one instance per open document

Each open document gets its own worker with its own MuPDF instance, owning that
document's `pdf_document` handle, its journal ([ADR 0011](0011-undo-on-the-mupdf-journal.md)),
its render queue, and its handle arena ([ADR 0009](0009-wasm-memory-and-handle-discipline.md)).

The worker is **respawnable**. The main thread treats worker death as an expected
outcome, not an exception: an `error` or `messageerror` event, or a request that exceeds
its deadline, marks the document as crashed, tears the worker down, and offers recovery
from the last durable state ([ADR 0017](0017-persistence-via-opfs.md)). Other documents
are unaffected. Crash isolation is the reason for the per-document boundary; it is not a
performance optimisation.

Every request carries a correlation id. Responses to a superseded or cancelled request
are discarded rather than applied, and any handle they allocated is released. A dead
worker's in-flight promises are rejected with a typed error, never left pending.

### `search.worker`, one shared instance

Full-document search opens its own read-only copy of the document bytes. It never
mutates. Keeping it separate means a search across a 10,000-page document cannot stall
editing in the document worker, and a crash while searching a damaged page does not take
the editable document with it. Because it holds only a read-only view, it is cheap to
respawn and re-seed.

### OCR worker, lazy

Tesseract's direct worker is instantiated from the main thread only when OCR is invoked and is
terminated after recognition. The former wrapper worker was removed because Safari 15.2 cannot
spawn Tesseract's worker from inside another worker. OCR image preparation still reads the
document only through background-priority 512 px requests on the `PdfEngine` port.

### Main thread

The main thread owns no MuPDF handle and never imports `mupdf`. This is enforced by
`eslint.config.js`, which restricts the `mupdf` import to `lib/engine/worker/`;
everything else goes through the `PdfEngine` port in `lib/engine/port.ts`.

## Consequences

### Positive

- A malformed document kills one tab-local worker, not the session.
- No cross-origin isolation, so no COOP/COEP headers and no `SharedArrayBuffer`.
- Search and OCR cannot starve visible rendering; OCR tile extraction sits behind viewport work.
- The port boundary makes the engine mockable in tests without a WASM instance.

### Negative

- Each document worker carries its own copy of the engine's memory, so several open
  documents multiply the memory cost. This is bounded by
  [ADR 0014](0014-resource-ceilings.md).
- Everything crossing the boundary must be serialisable, so the port surface has to be
  designed rather than fallen into.
- Recovering a crashed document depends on durable state being current, which puts real
  weight on ADR 0017.

### Neutral

- Single-threaded engine execution is an upstream property, not our choice. If MuPDF
  ever ships a pthreads WASM build, revisiting this would mean accepting cross-origin
  isolation, and that trade would need its own ADR.

## Notes

Enforced by the `no-restricted-imports` rule in `eslint.config.js`. Related:
[ADR 0009](0009-wasm-memory-and-handle-discipline.md) (what a worker owns),
[ADR 0010](0010-tiled-render-pipeline.md) (how a worker renders),
[ADR 0017](0017-persistence-via-opfs.md) (what survives a crash).
