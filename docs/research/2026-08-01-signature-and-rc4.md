# Signature inspection and RC4 replacement — 2026-08-01

## Signature inspection

MuPDF 1.28.0 contains signature inspection functions that were absent from the browser export
surface. Patches 0005 and 0007 export and bind:

- `pdf_count_signatures`;
- `pdf_signature_byte_range`;
- `pdf_widget_is_signed`;
- `pdf_signature_is_signed`;
- `pdf_signature_info`;
- `pdf_signature_incremental_change_since_signing`.

The C compiled under Emscripten 4.0.8. All six names appear in the generated
`mupdf-wasm.d.ts`, and full `check:wasm:fresh` rebuilds all five artifacts byte-identically.

`lib/engine/worker/security.ts` walks the AcroForm tree, uses the new bindings for signed state,
byte ranges, and incremental-change evidence, and retains object-level parsing as a malformed
input guard. The panel lists unsigned and signed fields separately, shows every covered range,
and reports later revisions without calling that evidence cryptographic validity or a semantic
DocMDP classification.

`tests/signatures.oracle.test.ts` uses qpdf and pdf.js to accept the fixture before inspecting
it. It covers multiple nested signature fields, a later incremental revision, and malformed
`/ByteRange`. `SIGN-011` therefore ships at its existing `DEGRADED` label.

## RC4

RC4 is already readable in the core engine. The missing product behavior was identifying it,
preventing mutation, and replacing it safely.

The worker derives the standard security handler algorithm from `/Encrypt /V`, `/R`, and
crypt-filter methods. RC4 documents skip document JavaScript and every mutation request is
refused. User output is accepted only when it is full, garbage-collecting, and AES-256; RC4 is
never preserved or written as user output. Internal read-only snapshots remain local and retain
the source protection so search and recovery do not turn document bytes into an external
artifact.

`tests/encryption.oracle.test.ts` generates RC4-40 and RC4-128 inputs with the pinned qpdf
oracle, confirms the engine identifies them as read-only, writes an AES-256 replacement, and
uses qpdf plus pdf.js to verify the result opens with the new password and reports AES-256.
`SIGN-024` therefore ships at `DEGRADED`.

Timestamping, acquisition of fresh revocation evidence, and LTV remain excluded. Signature
inspection does not change those boundaries and does not implement signing.
