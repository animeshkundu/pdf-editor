# 0028. Guard content removal and existing-text replacement with transactional proof

## Status

Accepted

## Date

2026-07-30

## Supersedes

[ADR 0020](0020-content-stream-rewriting-failed-stage-one.md) in part and
[ADR 0024](0024-redaction-marking-and-content-removal-gating.md).

## Context

ADR 0020 correctly rejected the sanitize filter as a general editing primitive after a
semantic-null rewrite perturbed pdfTeX and LibreOffice pages outside the C8 tolerance. It
incorrectly made that result an unconditional ban on operations for which MuPDF already
provides a narrower native mutation and for which the product can refuse unsafe document
structures.

Selective redaction is such an operation. The engine removes marked text, image, and line-art
content through `pdf_redact_page`, while preflight can detect Form XObjects, marked-content
property dictionaries, and metadata copies that the operation cannot prove it clears. A full,
garbage-collecting save prevents the replaced stream from surviving as an orphan.

Existing-text replacement has a second failure mode. An earlier path removed a CJK run and
then failed to write its replacement, while reporting success. Encoding checks before
mutation could not prove the compound operation completed. The journal can: any postcondition
that throws before `endOperation()` abandons both removal and replacement.

## Decision

Selective apply-redaction ships as `DEGRADED`. It refuses documents carrying unsupported
recoverable copies, uses named engine removal constants, verifies that every mark was applied,
and produces only full garbage-collecting output. The disclosure names the measured null-filter
render perturbation. MuPDF never grades the saved file; pdf.js and qpdf do.

Existing-text replacement ships only for a unique, axis-aligned, single-font, single-line
selection whose replacement is printable ASCII and fits the original bounds in standard
Helvetica at no less than 4 points. It refuses Form XObjects, Type 3 fonts, marked-content
property dictionaries, metadata copies, existing redaction marks, overlapping annotations,
repeated text, unsupported scripts, rotation, skew, multiline input, and non-fitting output.
It does not invert `/ToUnicode` and does not claim reflow or embedded-font reuse.

The replacement is one journal operation:

1. Project and assert the mutation and output cost.
2. Remove the exact engine-search quadrilaterals through MuPDF's redaction implementation.
3. Assert from structured-character callbacks that only the selected occurrence disappeared.
4. Assert every pre-existing annotation is unchanged.
5. Create a printable, borderless `FreeText` replacement with a Helvetica appearance.
6. Assert its exact contents and rectangle, its presence in the page annotation set, and a
   non-empty normal appearance stream.

Any failed assertion throws before journal commit and restores the original glyphs. These
MuPDF reads are a self-consistency safety interlock permitted by ADR 0019 rule 2, not an
acceptance oracle. Saved-output tests independently assert page text and annotation appearance
with pdf.js and structure with qpdf.

## Consequences

### Positive

- Existing-text editing no longer refuses every document, while the CJK data-loss path remains
  impossible.
- A failure after glyph removal is atomic and test-covered rather than success-shaped.
- Selective redaction is available without weakening the full-save or independent-reader
  requirements.

### Negative

- The text path is visibly narrower than Acrobat: standard Helvetica, printable ASCII, one
  axis-aligned line, no reflow.
- Both operations inherit the measured sanitize-filter rendering perturbation and must remain
  disclosed as `DEGRADED`.
- Many real documents are refused before mutation.

### Neutral

- General content-stream rewriting, raw `PDFObject.writeStream()` editing, `/ToUnicode`
  inversion, object movement, image replacement, and marked-content authoring remain
  withdrawn.

## Notes

Implemented in `lib/engine/worker/mutations/annotations.ts` and
`lib/engine/worker/mutations/redaction.ts`. Acceptance is in
`tests/existing-text-edit.test.ts` and `tests/redaction.oracle.test.ts`.
