# Security Policy

This project parses untrusted PDF files, untrusted embedded fonts, and untrusted embedded
images, entirely in the browser, and it handles documents people care about: contracts,
medical records, tax filings, signed agreements. Reports that help protect users and their
documents are very welcome.

## Report a vulnerability

Please use GitHub's private security advisory form to
[report a vulnerability](https://github.com/animeshkundu/pdf-editor/security/advisories/new).
Do not disclose a suspected vulnerability in a public issue before a coordinated fix is
available.

Include the affected version or commit, reproduction steps or a proof of concept, the
expected and observed behaviour, and the potential impact where you can. Please avoid
sending real documents that contain personal or confidential data; a minimal synthetic
reproduction is more useful and safer for everyone.

## Scope

Reports in scope include:

- **Anything that could exfiltrate a document.** The product's central claim is that the
  document never leaves the device. A path that breaks that is the most serious class of
  report here, including a regression in the default-deny CSP in `web/index.html` or a way
  to defeat the checks in `scripts/check-no-egress.mjs`.
- **Parser and engine safety.** The forked MuPDF WebAssembly build handles untrusted input.
  Out-of-bounds access, memory exhaustion, decompression bombs, cyclic object graphs, and
  parser differentials are all in scope. Note that a WASM trap on a malformed file is a
  known and contained condition: document workers are isolated and respawnable by design
  ([ADR 0008](docs/adr/0008-worker-topology-and-crash-isolation.md)). A report is
  interesting when the containment fails, when the crash is reachable in a way that costs
  the user data, or when it is exploitable beyond a denial of service.
- **Font handling.** `crates/pdftext` parses fonts taken directly out of a user's PDF.
- **Document integrity.** A path that silently corrupts a document, produces output that is
  invalid but appears to save successfully, or invalidates existing signatures without
  saying so.
- **Signing.** Anything that produces a signature that misrepresents what was signed,
  weakens the ByteRange, or leaks key material
  ([ADR 0018](docs/adr/0018-signing-via-custom-signer-vtable.md)).
- **Redaction.** Redaction is required to remove content from the content stream. Content
  recoverable from a document we redacted is a serious report.
- **Persistence.** OPFS content that leaks across origins, survives when it should not, or
  can be read by something that should not read it
  ([ADR 0017](docs/adr/0017-persistence-via-opfs.md)).

Generally out of scope:

- Issues requiring an already-compromised browser or operating system.
- Self-XSS.
- Missing best-practice headers with no demonstrated security impact.
- Resource exhaustion that stays within the documented ceilings in `lib/core/limits.ts`
  and fails with a `LimitError`. That is the ceiling working.
- iOS Safari terminating the tab on a large document. This is a documented platform
  behaviour with no catchable error
  ([ADR 0013](docs/adr/0013-supported-browser-matrix.md)). A report showing it happens well
  below `IOS_BUDGET` is useful, because that means the budget is wrong.

## What this product does not claim

Being precise here saves everyone time.

- Signing supports basic and certification signatures. It does **not** do RFC 3161
  timestamping, OCSP or CRL revocation checking, or PAdES long-term validation, because all
  three require network access and this product has none.
- The resource ceilings are defence in depth plus graceful refusal. They are **not** a
  guarantee that the browser cannot run out of memory.
- `connect-src` is `'self'` rather than `'none'`, because the WebAssembly binary is fetched
  from our own origin at runtime. The guarantee we make and prove is that no request
  reaches a third party.

## Supported versions

The current `main` branch is supported. Once releases are published, the latest release is
supported as well.

## What to expect

We aim to acknowledge reports within a few days, assess impact, and keep reporters informed
as a fix is developed. Please allow time for coordinated disclosure before publishing
details. Credit is available on request, unless you prefer anonymity.
