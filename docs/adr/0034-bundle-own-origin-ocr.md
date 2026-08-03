# 0034. Bundle a lazy own-origin OCR engine

## Status

Accepted

## Date

2026-08-02

## Context

The Chromium-only `TextDetector` path told Firefox and Safari users to switch browsers and
incorrectly claimed a bundled model would violate zero egress. Shipping an own-origin model is
not egress. The separate OCR worker also cannot spawn Tesseract's worker on Safari 15.2 because
that browser does not support nested workers.

Tesseract.js and Paddle OCR are Apache-compatible options. The measured ONNX runtime alone is
137.52 MB unpacked before Paddle's detection and recognition models. Tesseract's selected
runtime artifacts fit comfortably inside the existing total ceiling.

## Decision

Use exact-pinned Tesseract.js 7.0.0 and English trained data 1.0.0. Load the API, direct worker,
selected LSTM core, and model only on invocation. Ship baseline, SIMD, and relaxed-SIMD cores
under versioned own-origin paths so each floor browser chooses a compatible core.

Remove `TextDetector`; it had no measured advantage worth a divergent result path. Disable
Tesseract's IndexedDB cache. Render OCR input through 512-pixel engine tiles and assemble them on
a local canvas. Surface per-word confidence and offer Tesseract's searchable-image PDF, accepted
with pdf.js and qpdf.

## Consequences

Firefox and Chromium share one output path. The common path makes no OCR request. English is the
only bundled language in this release, quality remains `DEGRADED`, and editable layout
reconstruction remains `OPEN`. Safari uses floor-compatible primitives but remains manually
verified under ADR 0013.

## Notes

Evidence and package costs are in
[`2026-08-02-ocr-engine-selection.md`](../research/2026-08-02-ocr-engine-selection.md).
