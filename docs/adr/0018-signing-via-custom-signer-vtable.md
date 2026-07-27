# 0018. Signing through a custom signer vtable, with WebCrypto and PKI.js

## Status

Accepted

## Date

2026-07-26

## Context

Digital signatures are the feature that makes a PDF editor usable for the documents
people actually care about, and they are the feature most likely to be implemented
wrongly in a way nobody notices until a signature fails validation in Acrobat.

The critical, easily missed fact: **`pdf_pkcs7_signer` is a struct of function pointers,
not an OpenSSL type.** MuPDF does not require a particular crypto library. It requires
something that can produce a digest and describe a certificate. Anyone who can supply
those can sign.

That matters because MuPDF owns the parts that are genuinely hard to get right and easy
to get subtly wrong:

- Computing the ByteRange so the signature covers the correct spans of the file.
- Reserving the `/Contents` placeholder at the right size before the digest exists.
- Performing the incremental save so existing signatures remain valid.
- Writing DocMDP transform parameters for certification signatures.

Reimplementing those in TypeScript would produce signatures that look right and fail
validation.

On the cryptography side, the Rust options were rejected:

- **RustCrypto `rsa`** is subject to RUSTSEC-2023-0071, the Marvin timing attack. It is
  **still unpatched**. Shipping it in a signing path would be indefensible.
- **RustCrypto `cms`** is pre-release, and its support for detached signatures, which is
  exactly what PDF signing needs, is unverified. A pre-release CMS implementation on the
  signing path is not a risk worth taking when a mature alternative exists.

The browser already ships an audited, constant-time, hardware-backed-where-available
crypto implementation: WebCrypto. PKI.js is the mature JavaScript library for building
the CMS SignedData structure around it.

## Decision

Implement a custom `pdf_pkcs7_signer` in the fork
([ADR 0004](0004-fork-the-mupdf-wasm-build.md)) whose `create_digest` callback calls into
JavaScript. MuPDF keeps the PDF structure; JavaScript does the cryptography.

The division of responsibility:

| Concern                                                      | Owner                            |
| ------------------------------------------------------------ | -------------------------------- |
| ByteRange, `/Contents` placeholder, incremental save, DocMDP | MuPDF, through the signer vtable |
| Message digest and signature operation                       | WebCrypto (`SubtleCrypto`)       |
| CMS SignedData, certificate and attribute encoding           | PKI.js                           |
| Key material                                                 | The user's device, never ours    |

### Constraints

- **RustCrypto `rsa` is on the denylist** in `scripts/check-supply-chain.mjs` alongside
  `rustybuzz` and `ttf-parser`, so it cannot be reintroduced by a routine bump
  ([ADR 0005](0005-rust-font-module-scope.md)).
- Private keys never leave the device and never enter a request. This follows from
  [ADR 0002](0002-client-side-only-zero-egress.md) and is stronger than most desktop
  tools manage.
- Signing is an incremental save. A document with existing signatures must still validate
  after ours is added. `assertSaveFlags()` in `lib/core/limits.ts` already refuses the
  combinations that would silently invalidate them: incremental save on a repaired
  document, incremental save with garbage collection, and incremental save with an
  encryption change.
- **Verification is not asserted from our own output.** Signature validity is checked with
  an independent reader, per [ADR 0019](0019-correctness-oracles.md). A signature that
  only our stack accepts is worthless.

### Honest scope

Timestamping (RFC 3161), full revocation checking (OCSP, CRL), and long-term validation
(PAdES B-LT and B-LTA) all require network access, which
[ADR 0002](0002-client-side-only-zero-egress.md) forbids. The product will therefore
support basic and certification signatures and must **say plainly** what it does not do.
Claiming LTV without providing it would be exactly the kind of misleading capability
claim this project treats as a merge blocker.

## Unresolved: the callback is synchronous, WebCrypto is not

**This ADR's central mechanism has an unaddressed problem, found in adversarial review of
the product specification, and it is recorded here rather than left in a review thread.**

`pdf_pkcs7_signer.create_digest` is synchronous. Its signature
(`include/mupdf/pdf/form.h:226`) is:

```c
typedef int (pdf_pkcs7_create_digest_fn)(fz_context *ctx, pdf_pkcs7_signer *signer,
                                         fz_stream *in, unsigned char *digest,
                                         size_t digest_len);
```

It returns an `int` and writes into a caller-supplied buffer. MuPDF calls it and expects
the bytes to be there when it returns.

`SubtleCrypto` is asynchronous. Every operation returns a promise. The engine is
single-threaded WebAssembly with no pthreads
([ADR 0013](0013-supported-browser-matrix.md)), so there is no second thread to block on,
and no `SharedArrayBuffer` plus `Atomics.wait` arrangement available to synchronise
against. **There is no obvious way to await a promise inside a synchronous C callback that
was itself called from WASM.**

The C API comment above that typedef says the callback creates "a signature based on
ranges of bytes", not merely a digest, so the whole CMS operation may need to complete
synchronously. That makes the problem larger, not smaller.

Evidence now available:

- **Asyncify** suspends and resumes a reduced synchronous-shaped C call, but MuPDF's real
  signer dispatch, output stream, stack depth, CMS construction, failure propagation, and
  runtime costs remain untested. The full binary's measured size increase is not a cost
  bound. See the amended Spike C finding.
- **JSPI**, the JavaScript Promise Integration proposal. Cleaner, but its availability
  across our browser floor needs checking and would likely raise that floor.
- **Two phase** was evaluated against MuPDF 1.28.0 source. The private
  `complete_signatures` writer locates `/ByteRange` and `/Contents`, writes the final
  ranges, calls `pdf_write_digest`, and destroys unsaved-signature state in one save call.
  There is no public prepare/install boundary. A two-phase design therefore needs a new
  fork-owned state object that keeps the partially written output and exact ranges alive
  across JavaScript re-entry. That is preferred to Asyncify but is not implemented.
- **Precompute the digest** is not possible before save because the final byte ranges are
  only known after the output and placeholders have been written.

Until one is demonstrated, **signing is `OPEN` on Spike C** in
[`../spec/parity-inventory.md`](../spec/parity-inventory.md), and this ADR should be read
as a design whose feasibility is unproven at its most important joint. The same problem
affects the verifier vtable, whose callbacks are equally synchronous, so Spike D inherits
it.

Nothing else in this ADR changes. The division of responsibility, the reasons for avoiding
RustCrypto `rsa` and `cms`, and the exclusions around timestamping and LTV all stand. What
is unproven is the bridge.

## Consequences

### Positive

- Signing uses audited, constant-time browser cryptography rather than a library with an
  open timing advisory.
- MuPDF handles the PDF-structural parts that are hardest to get right.
- Private keys stay on the device, which is a genuine improvement on the hosted
  alternatives.

### Negative

- The signer vtable lives in our fork, so a signing bug is our bug.
- WebCrypto's algorithm support constrains which signature algorithms we can offer.
- Timestamping and LTV are out of reach without breaking the zero-egress posture, and
  some users genuinely need them. That is a stated limitation, not a gap to paper over.

### Neutral

- If a user needs LTV, the honest answer is to name a tool that can do it, not to
  approximate it.

## Notes

Depends on [ADR 0004](0004-fork-the-mupdf-wasm-build.md). Enforced in part by
`assertSaveFlags()` in `lib/core/limits.ts` and by `scripts/check-supply-chain.mjs`.
Acceptance is [ADR 0019](0019-correctness-oracles.md).
