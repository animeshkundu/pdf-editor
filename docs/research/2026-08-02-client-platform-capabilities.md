# Client platform capabilities

**Date:** 2026-08-02

## Answer

Service workers, local storage APIs, and WebAssembly cover the application shell, local state,
and compute substrate. They do not turn a browser into a server-backed document service or give
it hardware and document-model APIs the platform does not expose.

## Service worker

This was a real missing win. The app now precaches its exact same-origin shell and 10.7 MB MuPDF
engine. The cache key derives from the WASM-manifest digest, exact app-shell bytes, public base,
and worker build logic. Any release activates a new cache and deletes the old one before claiming
clients. Installation checks quota where supported and deletes only the new partial cache on
failure. An exact-cache miss returns a loud error instead of using an older engine.

The worker controls `/pdf/app/` only. A production test reloads offline and renders a real PDF in
Chromium and Firefox. The landing page remains zero JavaScript and outside the worker scope.

Offline operation is shipped. PWA installability is not claimed: a web app manifest would require
adding `manifest-src` to the exact default-deny app CSP, and that policy is not weakened for a
marketing label.

## OPFS, IndexedDB, and localStorage

ADR 0017 remains correct. Documents up to hundreds of megabytes stay in OPFS and are written from
the document worker through `createSyncAccessHandle()`. Moving them to IndexedDB would add
structured-clone and whole-value costs and would be a regression.

IndexedDB earns no new role in this delivery. Tesseract's optional IndexedDB language cache is
explicitly disabled. Preference-sized state and shortcut/panel settings already fit localStorage.
Recent-file metadata could use either localStorage or IndexedDB later, but neither should hold the
document bytes.

## WebAssembly

WebAssembly remains the right load-bearing foundation: MuPDF owns PDF parsing, repair, rendering,
mutation, and save; Tesseract's selected LSTM core owns local OCR. Both stay single-threaded and
need neither SharedArrayBuffer nor COOP/COEP.

WebAssembly supplies compute, not missing browser authority:

- **OCR:** now works through a bundled own-origin engine and model. Quality remains degraded and
  English-only in this release.
- **HTML to PDF (`CONV-003`):** `window.print()` exposes a user-controlled system dialog and no API
  returns the generated file. A custom document writer could rasterize or reconstruct HTML but
  would not be the browser's faithful print pipeline. The capability remains excluded on that
  semantic requirement, not because WASM cannot emit PDF bytes.
- **Office to PDF (`CONV-005`):** requires separate Word, spreadsheet, and presentation document
  models plus layout. The measured LibreOffice-WASM route is about 50 MB compressed before an
  accepted browser write path; lightweight readers do not supply faithful PDF layout. It remains
  excluded pending a format-by-format costed renderer.
- **Scanner input (`CONV-004`):** no browser API reaches document scanners. Camera capture is the
  honest mobile substitute.
- **Timestamping, fresh revocation acquisition, and LTV:** structurally require TSA, OCSP, or CRL
  network services. They remain excluded under zero egress. Offline evidence already embedded in
  a PDF is a separate OPEN implementation spike and must report absent evidence as unknown.

## Supply-chain and size result

Tesseract.js and its selected English data are exact-pinned and AGPL-compatible. The ONNX runtime
alternative measured 137.52 MB unpacked before Paddle's detection and recognition models, so it
was not selected. The shipped app is 26.4 MB unpacked against the 80 MB ceiling. MuPDF, OCR cores,
and the OCR model each retain independent budgets.
