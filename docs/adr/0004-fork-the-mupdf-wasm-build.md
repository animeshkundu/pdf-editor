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

The relevant facts about the shipped binding:

- The shim is `platform/wasm/lib/mupdf.c`. It is roughly 2,944 lines with roughly 335
  exported functions. It is small, flat, and written around a handful of trivially
  repeatable macros, so adding exports is mechanical rather than architectural.
- `pdf_processor` in the C API is a complete vtable over every content-stream operator.
  It is what MuPDF itself uses internally to interpret and to rewrite content. It is not
  exposed to JavaScript at all.
- `pdf_filter_page_contents` together with `pdf_new_sanitize_filter` is the supported
  way to rewrite a page's content stream while preserving everything the filter does not
  touch. Also not exposed.
- AcroForm JavaScript is gated behind the `mujs=yes` build feature. The relevant
  exports already exist in the shim; the feature is simply off in the stock build.
- `pdf_pkcs7_signer` is a struct of function pointers, not an OpenSSL type. It can be
  implemented by anyone who can supply a digest. This matters enormously and is covered
  in [ADR 0018](0018-signing-via-custom-signer-vtable.md).

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

### 4. A custom `pdf_pkcs7_signer` whose `create_digest` calls into JavaScript

See [ADR 0018](0018-signing-via-custom-signer-vtable.md). The signer is a function
pointer vtable, so the cryptography can live in WebCrypto and PKI.js while MuPDF keeps
ownership of the ByteRange, the incremental save, and the DocMDP transform parameters.

### What the fork does not do

It does not change MuPDF's own behaviour, patch its parser, or alter its rendering. Every
patch is additive surface area. That keeps rebasing onto a new upstream release
tractable, which matters because we intend to track upstream rather than diverge.

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
