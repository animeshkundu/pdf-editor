# Learnings

Durable findings, so future work does not rediscover them. Add an entry when something
cost real time to learn, especially when the obvious answer turned out to be wrong.

Use `## YYYY-MM-DD: short statement of the lesson`, then context, what happened, and what
to do next time.

## Current repository facts

- Repository: `animeshkundu/pdf-editor` (private).
- Licence: AGPL-3.0-only, which follows from MuPDF
  ([ADR 0003](adr/0003-mupdf-as-the-engine-and-agpl.md)).
- Three languages: C with Emscripten (the MuPDF fork), Rust with `wasm32-unknown-unknown`
  (`crates/pdftext`), and TypeScript (everything else).
- Node 22.13 or newer. Gate: `npm run check` (typecheck, lint, test). Additional gates:
  `check:egress`, `check:size`, `check:supply`, `check:wasm:fresh`.
- Development happens on Windows; CI runs on Linux. `.gitattributes` normalises line
  endings to LF because the WASM freshness gate compares bytes.

## 2026-07-26: MuPDF's published docs describe a superset of the WASM build

- **Context.** Planning the engine layer against the MuPDF reference on readthedocs.
- **What happened.** That reference documents the union of two different surfaces: the
  WebAssembly build and the `mutool run` desktop JavaScript interpreter. A large number of
  documented methods are marked `[mutool run only]` and simply do not exist in the browser
  build. A design derived from the documentation fails at first integration.
- **What to do next time.** Verify every engine capability against
  `platform/wasm/lib/mupdf.c` in the actual version being used. The shim is small (roughly
  2,944 lines, roughly 335 exports) and reading it is faster than debugging a wrong
  assumption. This is how ADR 0004 was written.

## 2026-07-26: `pdf_pkcs7_signer` is a vtable, not an OpenSSL type

- **Context.** Assessing whether browser-side signing was feasible at all.
- **What happened.** The name suggests a binding to a specific crypto library. It is
  actually a struct of function pointers, so anything that can produce a digest can sign.
  That single fact is the difference between "signing needs a crypto stack compiled into
  the WASM" and "signing uses WebCrypto and PKI.js while MuPDF keeps the ByteRange, the
  `/Contents` placeholder, the incremental save, and DocMDP".
- **What to do next time.** When a C API looks like it hard-codes a dependency, check
  whether it is a vtable first. See [ADR 0018](adr/0018-signing-via-custom-signer-vtable.md).

## 2026-07-26: mupdf.js has no FinalizationRegistry

- **Context.** Designing the render pipeline's memory model.
- **What happened.** All 27 wrapper classes require an explicit `.destroy()`, and garbage
  collecting the JavaScript wrapper does not free the native object. The failure mode is
  a viewer that passes every test, grows a few megabytes per rendered page in real use,
  and eventually aborts, because wasm32 memory cannot exceed 2 GiB and exceeding it aborts
  rather than throws. This is the single most common production failure in mupdf.js.
- **What to do next time.** Do not rely on review to catch a leaked handle. The two rule
  blocks at the end of `eslint.config.js` make an unowned `new mupdf.X()` a lint error.
  See [ADR 0009](adr/0009-wasm-memory-and-handle-discipline.md).

## 2026-07-26: `toPixmap()` cannot be cancelled, so tile size is a latency budget

- **Context.** Designing for responsive scrolling on heavy documents.
- **What happened.** Upstream issue #190: a render in flight cannot be abandoned, and the
  engine is single-threaded, so anything queued must be waited out. Tiling at 512 px is
  usually presented as a memory optimisation; here its real value is that it converts an
  uncancellable primitive into a pipeline cancellable at roughly 15 ms granularity.
- **What to do next time.** When a primitive cannot be cancelled, look for the granularity
  at which it effectively can be. See [ADR 0010](adr/0010-tiled-render-pipeline.md).

## 2026-07-26: check the advisory database before picking the obvious crate

- **Context.** Choosing the Rust text stack.
- **What happened.** The three most natural picks were all unusable. `rustybuzz` is
  RUSTSEC-2026-0206 (unmaintained), `ttf-parser` is RUSTSEC-2026-0192 (unmaintained), and
  RustCrypto `rsa` is RUSTSEC-2023-0071 (Marvin timing attack, still unpatched). All three
  sit on untrusted input or on the signing path. Separately, `wasm-pack` was archived when
  the rustwasm organisation was sunset in July 2025.
- **What to do next time.** Run `cargo audit` before the design, not after the
  implementation. The exclusions are enforced by `DENIED_CRATES` in
  `scripts/check-supply-chain.mjs` so a routine bump cannot silently undo them, and are
  recorded in the DENIED section of [`THIRD-PARTY.md`](THIRD-PARTY.md).

## 2026-07-26: `connect-src 'none'` is not achievable here, so prove the guarantee instead

- **Context.** Writing the CSP and the egress gate.
- **What happened.** The sibling photo-tools project can assert `connect-src 'none'` and
  grep the bundle for any outbound primitive. We cannot: the MuPDF WASM binary is fetched
  from our own origin at runtime, so `fetch` legitimately appears in the bundle. A claim of
  "no network primitives" would be false.
- **What to do next time.** State the narrower guarantee and prove it.
  `scripts/check-no-egress.mjs` fails on any absolute URL that is not same-origin, with an
  `INERT_HOST` allowlist where every entry carries a reason, and
  `tests/e2e/shell.e2e.ts` fails if the running application contacts a foreign origin. See
  [ADR 0002](adr/0002-client-side-only-zero-egress.md).
