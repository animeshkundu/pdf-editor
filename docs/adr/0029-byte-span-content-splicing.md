# 0029. Byte-span content-stream splicing for provably-scoped edits

## Status

Accepted. Supersedes [ADR 0020](0020-content-stream-rewriting-failed-stage-one.md) **only**
for the narrow byte-preserving splicing mechanism described below; ADR 0020's withdrawal of
general content-stream rewriting (filter-based re-serialization of arbitrary operators) stands
otherwise unchanged.

## Date

2026-08-01

## Supersedes (in part)

[ADR 0020](0020-content-stream-rewriting-failed-stage-one.md), for this mechanism only.

## Context

ADR 0020 withdrew content-stream rewriting after `pdf_new_sanitize_filter`, driven through
`pdf_filter_page_contents`, perturbed rendering outside C8 in Ghostscript, pdfTeX, and
LibreOffice documents even under a semantic-null rewrite
(`docs/research/2026-07-26-forked-engine-null-filter-oracle.md`). That measurement is about a
mechanism that re-serializes an entire content stream through MuPDF's own writer: it does not,
and structurally cannot, promise that every byte it does not intend to change survives
unchanged, because the writer re-emits the whole stream from its parsed representation.

ADR 0028 already reopened one adjacent question — selective content _removal_ — by using
MuPDF's own `pdf_redact_page` (a narrower native primitive) plus preflight refusal and
postcondition rollback, without touching the general-rewriting ban. This ADR reopens a second,
narrower question the same way: is there a class of content-stream _edits_ that never
re-serializes anything, and can be proven, byte for byte, not to touch anything outside an
explicit set of spans a caller already verified?

`docs/research/2026-08-01-byte-span-content-splicing.md` answers that for one specific
mechanism: an exact content-stream tokenizer that partitions a stream's decoded bytes with no
gap and no overlap (measured exactly on 12 of 13 shared-corpus documents; the 13th is refused
before tokenizing, not mis-tokenized), a byte splicer that only ever replaces explicit,
sorted, non-overlapping ranges and leaves every other byte untouched, and a forced write
through `PDFObject.writeStream()`/`writeRawStream()` whose reread — through a freshly
constructed indirect reference, not a resolved one, per a binding-level quirk the research doc
documents — proves the write actually reached the document rather than merely being called.

## Decision

A new, exclusively-owned module tree, `lib/engine/worker/content/**`, implements byte-span
content-stream splicing as a mechanism distinct from, and never invoking, the withdrawn
sanitize-filter rewrite path:

- **Exact tokenization.** `scanContentTokens` classifies every byte of a content stream —
  whitespace, comments, keywords, numbers, names, literal and hex strings, arrays,
  dictionaries, and inline-image `BI`/`ID`/data/`EI` regions — and `assertPartitionsExactly`
  checks the result accounts for every byte with no gap and no overlap. Malformed input
  (unterminated strings, arrays, or dictionaries) throws a `ContentScanError` rather than
  guessing an extent.
- **Sorted, non-overlapping byte splicing.** `spliceBytes` accepts explicit `{ start, end,
replacement }` ranges, rejects invalid ranges and overlaps (`assertSortedNonOverlapping`,
  via `ByteSpliceError`), allows ranges that merely touch at a shared boundary, and otherwise
  copies every byte outside the given ranges unchanged.
- **Forced writes with an independent reread proof.** `forceWriteContentStream` writes decoded
  bytes through `writeStream()` (which unconditionally clears `/Filter`/`/DecodeParms`, so it
  can never leave a stale filter disagreeing with the actual bytes) unless the stream already
  has no declared filter, in which case it uses `writeRawStream()` — never inventing a
  compression it did not produce — then rereads the object through a freshly constructed
  indirect reference and throws if the reread bytes do not match exactly.
- **Page-content access with cross-stream refusal.** `resolveEditableContentStream` accepts a
  bare single-stream `/Contents` or unwraps a one-element `/Contents` array, and refuses a
  missing `/Contents`, an empty array, or an array of more than one stream — the literal
  "refuse cross-stream edits" requirement, because a byte span computed from page-level text
  has no reliable way to know which physical stream, or which side of a concatenation
  boundary, it falls in.
- **Form XObject refusal.** Production preflight refuses any page whose direct operator trace
  contains `Do_form`. The diagnostic `countFormXObjectInstances` helper measures direct
  instancing for research and tests, but nested forms are not descended into, so that
  measurement is not used to admit a product edit.
- **Narrow integration into existing text editing.** `spliceExistingText`, an export in
  `lib/engine/worker/mutations/annotations.ts` alongside the guarded overlay fallback, is
  selected by `doc-runtime.ts` only when `inspectExistingTextEdit`'s preflight independently
  proves a same-length, printable-ASCII, unescaped, uniquely-occurring `Tj`-operand run exists
  in exactly one resolvable content stream. When byte-splice preflight is absent, the existing
  redact+`FreeText`-overlay path remains the fallback.

The worker response reports which mechanism committed: `content-splice` has operation-local
`LOCAL` fidelity and creates no annotation; `redaction-overlay` retains the existing
`DEGRADED` fidelity and appearance postconditions. The selection surface reports that path
after commit.

Every case this mechanism cannot prove safe is refused, not approximated: multi-stream
`/Contents`, multi-instance or zero-instance Form XObjects, escaped or ambiguous or repeated
`Tj` runs, non-ASCII/CID/multiline/multifont targets, and any range-invalid or overlapping
splice request. Non-ASCII, CID, multiline, and multifont support ship only if and when a
future measurement proves them correct against independent readers; until then they remain
refused, matching the honest-refusal posture ADR 0028 already established.

## Consequences

### Positive

- A real editing capability — direct, in-place byte replacement of a content stream — exists
  for the narrow case it can prove safe, without reopening or weakening ADR 0020's withdrawal
  of general filter-based rewriting.
- The forced-write reread proof and the corrupted-span negative control
  (`docs/research/2026-08-01-byte-span-content-splicing.md`) demonstrate that range validity
  alone is not sufficient — only a tokenizer-derived span is honest — and that this mechanism
  re-derives the span from the tokenizer immediately before writing rather than trusting a
  caller's earlier coordinate.
- The worker protocol makes the direct path reachable without weakening the overlay fallback.

### Negative

- The mechanism is narrow by design: single physical content stream, single unambiguous
  unescaped ASCII `Tj` run, no `TJ` arrays, no encoding inversion, single-page-content-stream
  Form XObject instancing measurement (no descent into nested forms).
- Non-ASCII, CID, multiline, and multifont text edits remain refused pending future measurement.

### Neutral

- General content-stream rewriting via a sanitize/rebuild filter remains withdrawn exactly as
  ADR 0020 states, for every case this ADR does not narrowly carve out.
- C8 is not loosened and no corpus document is removed; the one corpus document this mechanism
  refuses (`libreoffice.pdf`, a 3-stream `/Contents` array) is refused before any mutation is
  attempted, not excluded from the corpus or from any existing C8-gated test.

## Notes

Implemented in `lib/engine/worker/content/**` (`tokens.ts`, `splice.ts`, `stream-io.ts`,
`page-contents.ts`, `form-xobjects.ts`, `text-run.ts`) and the additive
`spliceExistingText`/`computeByteSplicePreflight` in
`lib/engine/worker/mutations/annotations.ts`. Evidence is in
`docs/research/2026-08-01-byte-span-content-splicing.md`. Acceptance is in
`tests/content-splice.oracle.test.ts`, `tests/existing-text-edit.test.ts`, and
`lib/engine/worker/doc-runtime.ts`. Saved output is read with pdf.js and qpdf, never MuPDF, as
the acceptance reader.
