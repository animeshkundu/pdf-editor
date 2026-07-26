# 0004. Fork the MuPDF WebAssembly build

## Status

Accepted

## Date

2026-07-26

## Context

MuPDF's C API contains almost everything the hard features of this product need. Its
WebAssembly binding does not export it.

This was established by reading the binding source, not the documentation. MuPDF's
published reference on readthedocs documents the union of two different surfaces: the
WebAssembly build and the `mutool run` desktop JavaScript interpreter. A large number
of documented methods are marked `[mutool run only]` and simply do not exist in the
browser build. Planning against that documentation produces a design that fails at the
first integration test.

The relevant facts about the shipped binding. All of these were measured against the
vendored source at MuPDF 1.28.0, not inferred:

- The shim is `platform/wasm/lib/mupdf.c`. It is **2,944 lines with 339 `EXPORT`
  occurrences and 331 unique `wasm_` symbols**. It is small, flat, and written around a
  handful of trivially repeatable macros, so adding exports is mechanical rather than
  architectural.
- Grepping that file for `filter`, `processor`, `sanitiz`, or `clip_page` returns **zero
  matches**. The content-stream machinery is genuinely unexported, not merely undocumented.
- `pdf_processor` in the C API is a complete vtable over every content-stream operator.
  It is what MuPDF itself uses internally to interpret and to rewrite content. It is not
  exposed to JavaScript at all.
- `pdf_filter_page_contents` together with `pdf_new_sanitize_filter` is the supported
  way to rewrite a page's content stream while preserving everything the filter does not
  touch. Also not exposed.
- AcroForm JavaScript is gated behind the `mujs=yes` build feature. `tools/build.sh:18`
  reads `FEATURES=${FEATURES:-brotli=no mujs=no extract=no xps=no svg=no}` and passes it
  straight through to `make`, so the feature is one token from being on. The relevant
  exports already exist in the shim.
- `pdf_pkcs7_signer` is a struct of function pointers, not an OpenSSL type. It can be
  implemented by anyone who can supply a digest. This matters enormously and is covered
  in [ADR 0018](0018-signing-via-custom-signer-vtable.md).
- `mupdf.c:2905` already contains `wasm_new_js_device`, a vtable-to-JavaScript bridge.
  Our `js_processor` copies its shape rather than inventing one, and Artifex's own TODOs
  at lines 28 and 29 read `// TODO: WASMDevice with callbacks` and
  `// TODO: PDFPage.process with callbacks`. The addition is one upstream anticipated.

Without a fork, three headline capabilities are not merely harder, they are impossible:
editing existing text in place, preserving tagged-PDF structure through an edit, and
signing a document.

## Decision

Vendor MuPDF's source and maintain a patch set against `platform/wasm/lib/mupdf.c` plus
the WASM build configuration. Build it ourselves with Emscripten. The fork adds exactly
the following and nothing else.

### 1. A `js_processor`: `pdf_processor` bridged to JavaScript

A `pdf_processor` implementation whose operator callbacks marshal into JavaScript. The
value is in what MuPDF has already resolved by the time a callback fires:

- `op_Tf` yields a **resolved `pdf_font_desc`**, not the raw `/F3` name. The encoding
  tables, the descendant font, and the CID mapping are already loaded. Re-deriving that
  from the raw object graph in TypeScript would be a large and error-prone
  reimplementation of MuPDF's font loader.
- `op_BDC` yields the **cooked marked-content dictionary**, including the MCID, which is
  the join key between rendered content and the structure tree. Without it, tagged-PDF
  preservation across an edit is guesswork.
- `op_BI` yields a **decoded inline image**, sparing us an inline-image decoder.

This single addition is what makes the "read the page as a sequence of typed operators"
model viable, and it is the foundation of [ADR 0012](0012-content-stream-text-editing.md).

### 2. `pdf_filter_page_contents` and `pdf_new_sanitize_filter`

The write side of the same story. Rewriting a content stream by hand risks corrupting
graphics state, clipping, transparency groups, and optional content. The sanitize filter
rewrites through MuPDF's own interpreter, so operators we do not understand pass through
unchanged. This is also the correct primitive for true redaction, where content must be
removed from the stream rather than covered by a black rectangle.

### 3. `mujs=yes` in the build FEATURES

A one-token change that enables the MuJS interpreter and, with it, AcroForm JavaScript:
field format, validate, calculate, and keystroke actions. Real-world government and
enterprise forms depend on these, and a form that silently does not calculate is worse
than a form that refuses to open. The exports are already present in the shim; only the
build flag is missing.

**Measured, not estimated.** The build succeeds and the cost is known:

| Build      |               Bytes |
| ---------- | ------------------: |
| Stock      |          10,408,550 |
| `mujs=yes` |          10,648,877 |
| Difference | 240,327, about 2.3% |

Produced with:

```sh
FEATURES="brotli=no extract=no xps=no svg=no" SUFFIX="mujs" bash tools/build.sh
```

This is the cheapest capability in the whole plan: no C is written, no export is added,
and the only cost is the rebuild and 235 KB.

**Honest boundary.** This proves the build succeeds, links, and grows by the expected
amount. It does **not** prove `doc.isJSSupported()` returns true at runtime, because the
binary has not been loaded in a browser. State it as "builds and links, runtime
confirmation pending", never as "AcroForm JavaScript works".

The `SUFFIX` in that command is load-bearing. See
[the object-cache trap](#implementation-note-the-suffix-object-cache-trap).

### 4. A custom `pdf_pkcs7_signer` whose `create_digest` calls into JavaScript

See [ADR 0018](0018-signing-via-custom-signer-vtable.md). The signer is a function
pointer vtable, so the cryptography can live in WebCrypto and PKI.js while MuPDF keeps
ownership of the ByteRange, the incremental save, and the DocMDP transform parameters.

### What the fork does not do

It does not change MuPDF's own behaviour, patch its parser, or alter its rendering. Every
patch is additive surface area. That keeps rebasing onto a new upstream release
tractable, which matters because we intend to track upstream rather than diverge.

## Implementation note: the `SUFFIX` object-cache trap

`make` caches object files per `build_suffix` (`tools/build.sh:39`, and the archive paths
at lines 63 and 64 are `../../build/wasm/$BUILD$SUFFIX/`). A variant build that does not
set `SUFFIX` **silently reuses the previous build's objects** and produces a binary
identical to the one before it.

This has already caused a wrong conclusion once: a `mujs=yes` build without `SUFFIX`
produced a byte-identical binary, which reads exactly like "enabling mujs changes
nothing" rather than "the build did not actually happen".

Any automation of the fork build must set `SUFFIX` per configuration, and any result
showing "the variant is byte-identical to stock" should be treated as a suspected cache
hit until `SUFFIX` is confirmed.

## What has been verified, and what has not

Verified by building from source:

- The stock from-source build is **byte-identical to Artifex's published npm artifact**:
  sha256 `f7d39be2ea7bf8f65ffe1b11f405547d0a5b7e3b94d4c1ef59d16687411bdebf`, 10,408,550
  bytes. The build environment is therefore provably correct, which means **any byte
  difference in a future build is our patch and nothing else**. That is what makes the
  fork's diff legible.
- Reproducibility does not depend on us pinning an Emscripten version.
  `tools/build.sh:27-28` runs `emsdk install 4.0.8` and `emsdk activate 4.0.8` regardless
  of the surrounding container, so the build pins its own toolchain. The composite action
  in `.github/actions/setup-emsdk/` is a convenience, not a correctness requirement.
- `mujs=yes` builds and links, at a cost of 240,327 bytes.

Not yet verified:

- That adding an export, or the `js_processor`, produces a **working** build. Only the
  stock build's reproducibility and the `mujs` variant's size are established.
- That `doc.isJSSupported()` returns true at runtime. The binary has not been loaded in a
  browser.

The four additions above remain designed rather than proven, and
[`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) treats them that way.

## Consequences

### Positive

- The three capabilities that differentiate this product from every other browser PDF
  tool become reachable.
- The additions are exports, not behaviour changes, so upstream rebases stay cheap.
- Working from resolved MuPDF structures avoids reimplementing font, encoding, and
  inline-image handling in TypeScript.

### Negative

- The build now needs Emscripten, which contributors on a fresh machine do not have.
  [ADR 0006](0006-three-toolchain-build-and-committed-wasm.md) addresses that by
  committing the built artifacts with a freshness proof.
- Every upstream release must be rebased and re-verified rather than consumed as a
  version bump.
- A crash inside our own C code is on us, not on Artifex.
- The fork is a derivative work of an AGPL-3.0-or-later program, so the patch set is
  published with the project. That is consistent with
  [ADR 0003](0003-mupdf-as-the-engine-and-agpl.md).

### Neutral

- The stock `mupdf` 1.28.0 npm package remains a dependency for its TypeScript types and
  for the parts of the surface we did not need to change.

## Notes

Built by `scripts/build-wasm.mjs`, which names this ADR. Freshness of the committed
output is proved by `scripts/check-wasm-fresh.mjs`. The vendored upstream source tree is
gitignored; the built artifacts under `vendor/mupdf-wasm/dist/` are committed on purpose.
