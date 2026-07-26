# 0010. A tiled, virtualized render pipeline

## Status

Accepted

## Date

2026-07-26

## Context

Two upstream facts shape everything about rendering.

**`toPixmap()` cannot be cancelled.** This is upstream issue #190. Once a render begins,
the single-threaded engine is occupied until it finishes. A user who scrolls quickly
through a document with heavy pages would otherwise queue seconds of work that cannot be
abandoned, and the viewer would feel broken in exactly the way a PDF viewer must not.

**A full-page render at high zoom is enormous.** An A4 page at 300 dpi is roughly
2,480 by 3,508 pixels, which is about 35 MB as RGBA. At 800% zoom it is far worse. Under
the 2 GiB ceiling of [ADR 0014](0014-resource-ceilings.md), a handful of those is fatal.

A 10,000-page document also cannot have 10,000 mounted page elements, and cannot have
its layout computed by measuring the DOM.

## Decision

### Tiles, not pages

Rendering is tiled at no more than 512 by 512 device pixels per `toPixmap()` call.

This is the key move, and its value is not primarily about memory. A tile that size
renders in roughly 15 ms or less on typical content. An uncancellable call at 15 ms
granularity is, for every practical purpose, a cancellable pipeline: the queue is
drained between tiles, superseded work is dropped before it starts, and the worst case
the user can experience is one tile of latency rather than one page.

`lib/core/limits.ts` enforces the ceiling from the other direction:
`assertRenderSize()` refuses any single render above `maxRenderPixels` and says
explicitly to tile it instead. A 512-square tile is 262,144 pixels, comfortably inside
the desktop budget of 4,000,000 and inside the iOS budget of 1,000,000.

### A prefix-sum layout, computed not measured

Page positions come from a prefix sum over page heights at the current zoom, maintained
outside React. Scrolling to page 8,000 is an arithmetic lookup. Nothing is measured from
the DOM, so layout does not depend on mounting, and zoom changes rescale the sum rather
than re-measuring.

### A priority queue with a viewport-derived ordering

The render queue is ordered by distance from the viewport, with visible tiles first,
then a small prefetch ring above and below. When the viewport moves, the queue is
reordered rather than appended to, and tiles that left the prefetch ring are dropped
before they are ever submitted.

Each request carries a correlation id. A response whose id is stale is discarded and its
pixmap destroyed, per [ADR 0009](0009-wasm-memory-and-handle-discipline.md).

### Scroll and zoom never enter React

Scroll offset and zoom level are held outside the React tree and applied through direct
style writes and canvas painting. A scroll event must not cause a render pass of the
component tree. Zustand holds the document and UI state that genuinely belongs in React;
the continuously changing view transform does not.

### Bitmaps are budgeted separately

Decoded tiles held on the main thread as `ImageBitmap` count against `bitmapBudget`,
which is a separate ceiling from the WASM heap because they live in a different address
space. Eviction is furthest-from-viewport first.

## Consequences

### Positive

- Scrolling stays responsive on large and heavy documents, despite an uncancellable
  primitive.
- Peak memory per render is bounded by the tile size rather than by the page size or the
  zoom level.
- Layout cost is independent of page count.

### Negative

- Tile seams, tile-boundary artefacts, and per-tile overhead all have to be handled;
  a whole-page render would have none of these problems.
- Two coordinate systems (document points and device tiles) exist and must be kept
  consistent, especially for selection quads and annotation hit testing.
- Keeping view state out of React means some UI has to subscribe to a non-React store,
  which is less idiomatic.

### Neutral

- If `toPixmap()` becomes cancellable upstream, tiling remains worthwhile for the memory
  bound alone. This decision would not be reversed, only relaxed.

## Notes

Ceilings live in `lib/core/limits.ts` and [ADR 0014](0014-resource-ceilings.md). The
worker boundary is [ADR 0008](0008-worker-topology-and-crash-isolation.md). Text
selection over the rendered output is [ADR 0015](0015-accessibility-and-no-positioned-dom-text.md).
