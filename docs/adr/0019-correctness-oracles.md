# 0019. Never use the producer as the acceptance reader

## Status

Accepted

## Date

2026-07-26

## Context

If MuPDF writes a PDF and MuPDF reads it back and agrees, that proves the two agree. It
does not prove the file is a valid PDF, and it does not prove any other reader will
render it the way we intended.

This failure mode is not hypothetical. A producer and its matching reader share
assumptions, share a data model, and share bugs. A round trip through the same
implementation reproduces the same mistake twice and reports success. Real-world
symptoms are familiar to anyone who has worked on file formats: a document that opens
perfectly in the tool that wrote it and fails in Acrobat, a signature that validates only
in the stack that created it, a font subset that renders in one viewer and shows blank
boxes in another.

Our situation makes this sharper than usual. [ADR 0012](0012-content-stream-text-editing.md)
rewrites content streams with a bespoke encoding inversion that has no reference
implementation anywhere. If we grade that work with the same engine that performed it,
we learn nothing.

## Decision

**MuPDF is never the acceptance reader for output MuPDF produced.**

Acceptance uses independent implementations that share no lineage with the engine:

| Oracle     | Role                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pdf.js** | Independent parse and render. Different implementation, different organisation, different data model. Renders our output and compares against expectation.                                      |
| **qpdf**   | Independent structural validation. Checks the object graph, cross-reference tables, stream integrity, and linearisation, and reports damage MuPDF's tolerant parser would silently repair past. |

The rules:

1. Any test that asserts the correctness of a document we wrote reads it with pdf.js,
   qpdf, or both. Never with MuPDF.
2. A round trip through MuPDF may be used to check that an operation is
   self-consistent. It may never be presented as evidence that the output is correct.
3. Rendered-output comparisons render with pdf.js, not with MuPDF, because a rendering
   difference between the writer and an independent reader is precisely the class of bug
   this rule exists to find.
4. Text-editing tests assert the extracted text and the rendered pixels from pdf.js.
   Recovering our own bytes proves only that the inversion is invertible by itself.
5. Signature validation is checked outside our stack. A signature that only we accept is
   not a signature.
6. Structural validity of every saved document is checked with qpdf, including after
   incremental saves, so a corrupt cross-reference table is caught by the tool designed
   to catch it.
7. The oracles are **test and CI only**. They never enter the shipped bundle. They are
   recorded in the development section of [`../THIRD-PARTY.md`](../THIRD-PARTY.md).

Manual spot-checks in Adobe Acrobat are valuable and should be recorded in the release
review, but they are not automated evidence and are not a substitute for either oracle.

## Consequences

### Positive

- Corruption is caught by a tool that does not share our assumptions.
- The riskiest work in the product, the encoding inversion, gets a genuinely independent
  grade.
- Compatibility with the readers users actually have is measured rather than assumed.

### Negative

- Two additional tools in CI, with their own versions to pin and their own failure modes.
- Some failures will be oracle disagreements rather than our bugs, and telling those
  apart takes real work.
- A round trip is much easier to write than an independent acceptance check, so there is
  standing pressure to take the shortcut.

### Neutral

- The rule is one-directional. Reading a document with MuPDF in order to test our own
  reading is fine. It is only acceptance of our own **output** that requires an outside
  reader.

## Notes

Applies to every write path: text editing
([ADR 0012](0012-content-stream-text-editing.md)), signing
([ADR 0018](0018-signing-via-custom-signer-vtable.md)), redaction, form filling, page
operations, and every save. Oracles are listed in
[`../THIRD-PARTY.md`](../THIRD-PARTY.md) and enforced as a review item in
[`../qa/review-rubric.md`](../qa/review-rubric.md).
