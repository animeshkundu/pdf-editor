# 0033. Cache a manifest-versioned offline app shell

## Status

Accepted

## Date

2026-08-02

## Context

The application and its 10.7 MB MuPDF binary are static same-origin assets. Repeat loads should
work offline, but an HTML/worker/engine version mismatch would be silent and catastrophic.
Document storage already belongs in OPFS under ADR 0017; moving it to IndexedDB would add
structured-clone cost and regress large-file access.

The public document path is `/pdf/app/` while files live in the internal
`/pdf-editor/app/` mount. A first implementation kept asset URLs in the internal space. The page
was controlled, but a document worker outside the service-worker scope fetched WASM from the
network and stalled offline.

## Decision

Emit an unhashed `/pdf/app/sw.js` that always revalidates and controls only `/pdf/app/`. Build
asset URLs under that public scope; Build Output API continues rewriting them into the internal
static mount. The cache name derives from the SHA-256 digest of `vendor/wasm-manifest.json`, the
exact precached bundle bytes, the public base, and the service-worker build logic. An app-only or
worker-logic release therefore installs beside the live cache rather than deleting it in place.

Installation estimates available quota where the browser exposes that API, fetches only an
enumerated same-origin app shell with redirects refused, verifies the fetched response's own
origin, deletes only the new partial cache on any failure, and reports a visible error. The
existence of a cache is not evidence of successful installation: every expected key is checked,
and a cache left partial by worker termination is rebuilt on the next install. Activation deletes
every older
Papertrail cache before claiming clients. Updates follow the normal waiting-worker lifecycle, so
an old client retains its matching old shell and engine until it closes; `skipWaiting()` is not
used. Fetch handling ignores unknown requests. A missing enumerated entry is fetched from the
current same-origin publication with redirects refused, its response origin is verified, and the
entry is restored before it is served. This preserves the no-stale-engine guarantee by fetching
the current asset rather than by refusing to serve: no older cache is consulted. A loud 503 is
returned only when that network recovery also fails. OCR assets remain lazy and are not precached.

No web app manifest is added because doing so would require changing the exact app CSP. Offline
operation is claimed; installability is not. IndexedDB earns no document role, and Tesseract's
optional language cache is disabled.

## Consequences

The app and engine render a real PDF offline after one successful install, and a manifest change
evicts the previous engine cache. Storage-pressure eviction of an individual app-shell entry
self-heals while online, including the application document itself; offline recovery still fails
loudly rather than mixing versions. Cold installation spends storage and bandwidth once. The
landing remains a zero-JavaScript surface and is outside the worker scope.

## Notes

Implemented by `vite.web.config.ts`, `lib/persistence/service-worker.ts`, mounted publication
routes, and `tests/e2e/service-worker.e2e.ts`.
