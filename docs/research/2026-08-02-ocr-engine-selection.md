# OCR engine selection

**Date:** 2026-08-02

## Correction

The earlier statement that zero egress prevented an OCR fallback conflated runtime model
provisioning with shipping an asset. ADR 0002 permits static same-origin assets; the MuPDF
WebAssembly binary already uses that path. The code and product copy now state the narrower,
correct rule.

## Costed options

| Option                                               |                                                               Measured npm unpacked cost | Runtime shape                                          | Decision                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------: | ------------------------------------------------------ | ------------------------- |
| Tesseract.js 7.0.0 plus English data 1.0.0           | 1.41 MB API, 30.61 MB core package, 13.88 MB language package before selecting artifacts | One worker, one LSTM core, one language model          | Selected                  |
| onnxruntime-web 1.27.0 plus Paddle OCR model package |                                                 137.52 MB runtime before model artifacts | Runtime plus separate detection and recognition models | Rejected for this release |

Only selected artifacts ship. The production size gate measures 3,394.1 kB brotli across the
baseline, SIMD, and relaxed-SIMD LSTM cores and worker, plus a 2,952.9 kB gzipped English
`best_int` model. Total unpacked output is 26.4 MB against the 80 MB ceiling. MuPDF remains in
its unchanged 4.5 MB brotli bucket; OCR has separate engine and model buckets so neither can hide
growth in the other.

## Browser and privacy shape

- The Tesseract API chunk, worker, core, and language model load only after the user invokes OCR.
- Every URL is rooted at the app's public same-origin base. The dependency's CDN defaults are
  replaced at build time with relative fail-closed paths, and `check:egress` scans the emitted
  worker and core.
- Tesseract's IndexedDB language cache is disabled (`cacheMethod: 'none'`). Document persistence
  remains OPFS; IndexedDB is not introduced as a document store.
- Tesseract's worker is created directly from the main thread. Nesting it inside the former OCR
  wrapper worker would fail on Safari 15.2. The wrapper worker and Chromium-only `TextDetector`
  branch were removed because no measured speed advantage justified a divergent output path.
- The core path is a directory containing baseline, SIMD, and relaxed-SIMD LSTM variants.
  Firefox did not load a single-file core path reliably; the documented directory contract lets
  each browser select its supported local core.

## Acceptance

`tests/e2e/ocr.e2e.ts` recognizes page 1 of the real CamScanner corpus fixture in Chromium and
Firefox, asserts the cold path requests no OCR asset, asserts every OCR request is same-origin,
surfaces per-word confidence, downloads a searchable-image PDF, and accepts that PDF with qpdf
and pdf.js. Safari remains a manual browser-floor check per ADR 0013; no automated Safari claim
is made.
