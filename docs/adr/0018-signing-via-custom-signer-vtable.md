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
