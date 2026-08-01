# Byte-span content-stream splicing: measured evidence — 2026-08-01

## Scope

ADR 0020 withdrew _general_ content-stream rewriting after a semantic-null
`pdf_new_sanitize_filter` rewrite perturbed rendering outside C8 in Ghostscript, pdfTeX, and
LibreOffice documents (`2026-07-26-forked-engine-null-filter-oracle.md`). That withdrawal was
about a filter that re-serializes an entire content stream through MuPDF's own writer, which
does not preserve byte spans it does not touch.

This finding is about a different, narrower mechanism: splicing an explicit, sorted,
non-overlapping set of byte ranges directly into a content stream's own decoded bytes, leaving
every other byte in the stream untouched, and forcing the write through
`pdf_update_stream` (`source/pdf/pdf-xref.c`) with an independent reread proving it actually
happened. It answers one question: for the narrow case where a byte span can be proven correct
(a tokenizer-derived, length-preserving ASCII `Tj` run, or a whole-buffer null splice), does a
direct splice reach independent readers intact without producing the rendering perturbation
ADR 0020 measured? It does not reopen ADR 0020's broader question about filter-based rewriting
of arbitrary operators, and it does not claim to invert `/ToUnicode`, decode non-ASCII/CID
fonts, or handle multiline/multifont selections.

## Journaling behaviour (source read, not measured)

`pdf_update_stream`'s own comment states the mechanism this module depends on:

```c
/* Write the Length first, as this has the effect of moving the
 * old object into the journal for undo. This also moves the
 * stream buffer with it, keeping it consistent. */
pdf_dict_put_int(ctx, obj, PDF_NAME(Length), fz_buffer_storage(ctx, newbuf, NULL));
...
fz_drop_buffer(ctx, x->stm_buf);
x->stm_buf = fz_keep_buffer(ctx, newbuf);
if (!compressed)
{
    pdf_dict_del(ctx, obj, PDF_NAME(Filter));
    pdf_dict_del(ctx, obj, PDF_NAME(DecodeParms));
}
```

Writing `/Length` first is what moves the _prior_ object (and, with it, the prior stream
buffer) into the journal for undo, before the buffer pointer is swapped. A forced write inside
`document.beginOperation()`/`endOperation()` is therefore a real, undoable journal entry, not a
side-channel mutation ADR 0011's undo history cannot see. `writeStream()` (`compressed = 0`)
unconditionally deletes `/Filter` and `/DecodeParms`, so calling it with fully decoded bytes can
never leave a stale filter declaration disagreeing with the actual bytes. `writeRawStream()`
(`compressed = 1`) does not touch `/Filter` at all, so it is only used when the stream had no
declared filter to begin with — decoded and raw bytes are then the same bytes by definition,
and no compression is ever claimed that was not produced.

The rollback consequence was also measured rather than left at the source-reading claim. An
end-to-end test performs a valid forced byte splice inside a real MuPDF journal operation, injects
a failing post-write text condition, and lets `abandonOperation()` run. A subsequent full save is
accepted by qpdf, pdf.js extracts the original `Prefix Original Suffix`, and no annotation remains.
This proves the already-written stream buffer is restored on abandonment for this mutation path.

A second binding-level fact, discovered while building the reread proof rather than read from
source: `PDFObject.resolve()` (`_wasm_pdf_resolve_indirect`) returns a dictionary view that has
lost the reference's own identity — `isStream()` and `readStream()` on the _resolved_ object
both report false/empty even immediately after `writeStream()` succeeded, on both freshly
created in-memory documents and documents that were saved and reopened from bytes. A freshly
constructed `document.newIndirect(objectNumber)` reference (not resolved) reads back correctly.
The forced-write reread proof therefore rereads through an unresolved fresh indirect reference,
not `.resolve()` of one; every module and test in this mechanism follows that rule.

## Tokenizer exactness (measured)

`scanContentTokens` classifies whitespace, comments, keywords, numbers, names, literal and hex
strings, arrays, dictionaries, and inline-image `BI`/`ID`/data/`EI` regions, and
`assertPartitionsExactly` checks the returned tokens partition the input with no gap and no
overlap. Run against the first page's content stream of every document in the shared corpus
(`tests/fixtures/pdf-corpus/corpus.ts`, 13 documents from real producers — Acrobat Distiller,
Ghostscript, pdfTeX, Word/Adobe PDF Services, LibreOffice, Apache FOP, and others):

- **12 of 13** resolved to exactly one physical content stream and tokenized with an exact
  byte partition.
- **1 of 13** (`libreoffice.pdf`) was refused before tokenizing even ran, because its page's
  `/Contents` is an array of 3 separate physical streams. See "Page-content access" below —
  this is the documented cross-stream refusal, not a tokenizer failure.

Every document the tokenizer accepted, it accounted for exactly. No document produced a
partition gap, an overlap, or a silent truncation.

## Inline images

The tokenizer does not parse an inline image's dictionary keys; it scans forward from `ID` for
a whitespace-delimited `EI` that is not itself inside the image data (the same heuristic
ambiguity every PDF content-stream reader has for uncompressed inline image data, since there
is no length-prefixed form). `tests/content-splice.oracle.test.ts` exercises this with a
synthetic `BI ... ID <raw bytes with an embedded 0x45 0x49 lookalike avoided> EI` stream and
confirms the returned `inline-image-data` token's span matches the known data exactly. This
mechanism never splices inside an inline image's data region; it only needs the region's
bytes accounted for so a splice elsewhere in the same stream still partitions exactly.

## Forced-write proof (measured)

Three independent-reader proofs were run, all on `document.addPage`'s own unfiltered content
stream (no declared `/Filter`, so the `writeRawStream` path is what actually executes):

1. **Null splice.** The whole buffer, spliced with itself, is byte-identical to the original.
   After `forceWriteContentStream`, a second, independently constructed fresh indirect
   reference (distinct from the one the write function used internally) rereads the exact
   same bytes. pdf.js still extracts `"Prefix Original Suffix"` from the saved output, and
   `qpdf --check` passes.
2. **Non-null splice.** Replacing the tokenizer-located `Original` run (8 bytes) with
   `REVISED!` (8 bytes) leaves every byte strictly outside the spliced span byte-identical to
   the original (checked on both sides of the span independently). pdf.js extracts
   `"Prefix REVISED! Suffix"` from the saved output and no longer contains `"Original"`.
   `qpdf --check` passes.
3. **No invented compression.** The unfiltered stream's `/Filter` is absent both before and
   after a forced write of its own unchanged bytes, confirming `writeRawStream` was used (the
   only stream state in which this mechanism will use it) and that no filter declaration was
   fabricated.

## Corrupted-span negative control (measured)

A byte span that is range-valid but not derived from the tokenizer — one byte short of the
real `Original` run, chosen by hand rather than computed — was spliced and forced-written for
comparison against the honest, tokenizer-derived span on the same source document. The honest
span produces the intended `"Prefix REVISED! Suffix"`. The corrupted span produces
`"Prefix REVISED!l Suffix"`: neither the original text (something changed) nor the intended
replacement (the change is wrong), because it silently stitches one original byte into the
result. `assertSortedNonOverlapping` cannot catch this — the range is valid and does not
overlap anything — which is the point: range validation is necessary but not sufficient, and
only a tokenizer-derived span is honest. This is why `spliceExistingText` re-derives the run
from the tokenizer immediately before writing, rather than trusting a coordinate computed
earlier by a caller.

## Page-content access (measured)

`resolveEditableContentStream` accepts a bare single-stream `/Contents` or a one-element
`/Contents` array (unwrapping it), and refuses: a missing `/Contents`, an empty `/Contents`
array, and (the literal "refuse cross-stream edits" requirement) a `/Contents` array of more
than one stream. The corpus measurement above exercised the multi-stream refusal on a real
document (`libreoffice.pdf`, 3 streams); the other four cases are covered by synthetic
documents built the same way `tests/redaction.oracle.test.ts` already builds streams via
`document.addStream`.

The reason for refusing a multi-stream `/Contents` array rather than approximating it: a
content processor concatenates the array's streams with an implied whitespace separator to
form one logical stream (ISO 32000-2 §7.7.3.3), but a byte span computed from page-level text
extraction has no reliable way to say which physical stream, or which side of a concatenation
boundary, it falls in without re-deriving that concatenation logic itself — and getting that
wrong would silently splice the wrong physical stream at the wrong offset.

## Form XObject instancing (measured)

`countFormXObjectInstances` counts `Do_form` records MuPDF's own resolved operator trace
(`PDFPage.processContents()`, ADR 0004's `js_processor`) reports for a given indirect object
number, across every page in the document. `proveSingleFormInstance` refuses unless that count
is exactly 1: zero means the form is never actually drawn (editing it would change nothing a
reader sees), and more than one means the shared stream has multiple placements a direct splice
would silently edit together.

Measured on synthetic documents: a Form XObject drawn once is proven safe
(`{ referenceCount: 1, provenSingleInstance: true }`); one drawn twice from the same page is
refused with the measured count in the message. Measured on a real corpus document tagged
`form-xobject` (`apache-fop.pdf`): scanning every indirect object for a stream whose `/Subtype`
is `/Form` finds exactly one Form XObject (object 15), and `countFormXObjectInstances` measures
it as drawn exactly once — a real, not merely synthetic, single-instance case this mechanism
can prove safe.

**Known limitation, stated rather than hidden:** the count comes from each page's own content
stream trace. A form drawn only from inside another form (nested `Do`) is not descended into
and would be undercounted (falsely reported as fewer instances than actually exist, i.e. this
mechanism could wrongly _permit_ an edit it should refuse). No document in the shared corpus
exercises nested-form `Do` invocations, so this is a stated gap rather than a measured one; a
document that does would need to be added to the corpus before this mechanism could claim
correctness for that case.

Because of that unresolved nested-form case, this helper is diagnostic only. Production
`inspectExistingTextEdit` refuses every page whose direct trace contains `Do_form`; it does not
use a single-instance result to admit an edit.

## Integration into existing text editing (measured)

`spliceExistingText`, an export in `lib/engine/worker/mutations/annotations.ts` alongside the
guarded overlay fallback, is offered only when `inspectExistingTextEdit`'s
preflight independently proves: the replacement is same-length printable ASCII containing no
PDF string-reserved characters (`(`, `)`, `\`), `resolveEditableContentStream` finds exactly
one physical content stream, and `findSingleAsciiShowTextRun` finds the target text occurring
exactly once as an unescaped run inside a `Tj` string operand anywhere in that stream (not
necessarily the operand's entire content — `(Prefix Original Suffix) Tj` contains `Original`
as a strict, uniquely-occurring substring). Any ambiguity — zero or multiple candidate
occurrences, an escaped string, a `TJ` array, a length-changing replacement, a non-ASCII
replacement, an unresolvable or multi-stream `/Contents` — leaves `byteSplice` undefined on the
preflight, and the existing redact+`FreeText`-overlay path (`editExistingText`) remains the
fallback for that input.

When offered, `spliceExistingText` re-verifies the exact same run against a freshly read copy
of the stream immediately before writing (the corrupted-span negative control above is why),
splices and forced-writes it, then reloads the page fresh and re-verifies both the extracted
text and the annotation set are exactly what was predicted, throwing — which the caller's
`journalOperation` rolls back — on any mismatch. This is the same postcondition-or-rollback
discipline ADR 0028 established for `editExistingText`, applied to a direct byte write instead
of a redact-and-overlay sequence. Measured end-to-end on `tests/existing-text-edit.test.ts`'s
own fixture: pdf.js extracts the spliced text, `pdfJsAnnotations` finds no annotation was
created (unlike `editExistingText`, there is no overlay because the original bytes now
directly encode the replacement text), and `qpdf --check` passes on the saved output.

The worker RPC selects `spliceExistingText` first inside the same journal operation and falls
back only when its preflight reports no provable splice. The response reports
`mechanism: content-splice | redaction-overlay`; the application surfaces that committed path.

## Non-ASCII, CID, multiline, and multifont text

Not shipped. `findSingleAsciiShowTextRun` refuses any target containing a byte outside
printable ASCII, any string operand containing an escape (`\`), and — because it only ever
inspects `Tj` operands — any `TJ`-array-driven text run, any target spanning more than one
`Tj` operator, and any target that is not uniquely present. No corpus document or synthetic
test proves a non-ASCII, CID, multiline, or multifont byte splice is correct, so none of those
cases are claimed here; they remain refused, which is the same honest-refusal posture ADR
0028 already established for `editExistingText`.

## Does not reopen ADR 0020

ADR 0020's withdrawal targeted `pdf_new_sanitize_filter`-based rewriting of arbitrary
operators across an entire content stream, which necessarily re-serializes bytes it does not
need to touch and was measured to perturb rendering outside C8 on real documents. Nothing in
this mechanism uses that filter, or any full-stream re-serialization: every write here is
either a null splice (the exact original bytes, byte for byte) or a splice confined to a
tokenizer-verified span, leaving every other byte in the stream — including the bytes ADR
0020's failure came from perturbing — completely untouched. The measured evidence above (null
splice byte identity, non-null untouched-byte preservation, corpus tokenizer exactness) is
what supports treating this as a narrower, provably-scoped mechanism rather than a re-run of
the same experiment.

## Acceptance readers

As required by ADR 0019: MuPDF/pdf.js/pdf.js-adjacent reads inside the mechanism itself (reread
proofs, structured-text re-verification) are self-consistency interlocks, not acceptance. Every
claim about a saved PDF's correctness above is checked with pdf.js (text and annotation
extraction) and qpdf (`--check`) — MuPDF is never used as the acceptance reader for a saved
document.
