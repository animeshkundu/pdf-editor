# Null-filter token diff

**Date:** 2026-08-02  
**Decision rule:** Keep C8 unchanged. Use pdf.js and qpdf as acceptance readers. Use MuPDF
only to expose decoded pre/post-filter content bytes for this diagnostic measurement.

## Instrument

`lib/engine/worker/content/token-diff.ts` scans every decoded physical page stream with the
exact ADR 0029 tokenizer, asserts gapless byte partitioning, removes whitespace and comments
from the semantic sequence, records stream boundaries, and compares token and keyword counts.
`tests/null-filter-token-diff.test.ts` runs it on the two live ADR 0020 leads.

The instrument does not grade MuPDF output. Existing C8 pdf.js renders and qpdf checks remain
the acceptance evidence and their tolerances are unchanged.

## LibreOffice

The null filter changes page 1 from three physical `/Contents` streams to one:

| Measure                                  | Before | After |
| ---------------------------------------- | -----: | ----: |
| Physical streams                         |      3 |     1 |
| Decoded bytes                            |    406 |   415 |
| Significant tokens, including boundaries |     67 |    65 |

The only keyword-count change is one `Td` removed and one `TD` added. Two stream-boundary
tokens disappear. Numeric spelling is canonicalized (`0.1` to `.1`, `0.028` to `.028`) while
the numeric values remain equal. The earlier q/Q measurement remains unchanged: graphics-state
counts are balanced and identical.

This does not yet isolate stream consolidation as the renderer-visible cause. Consolidation is
coupled to a text-position operator rewrite in the same output, so the next causal control must
preserve original `Td` semantics while consolidating, then grade that output with pdf.js and
qpdf.

## pdfTeX

Every page remains one physical stream, but every significant-token sequence is reserialized.
The filter adds one balanced `q`/`Q` pair to every page, confirming the earlier negative control.
The new signal is text positioning:

- Page 1, the only C8 pass, removes 29 `Td` operators and emits 26 `TD` plus 2 `T*`.
- Pages 2 through 28, all C8 failures, remove between 49 and 321 `Td` operators and emit
  corresponding `TD`/`T*` sequences.
- Page 2 removes 163 `Td`, emits 151 `TD` and 11 `T*`, and grows from 15,896 to 19,844 decoded
  bytes.
- Page 28 removes 194 `Td`, emits 190 `TD` and 2 `T*`, and grows from 15,159 to 18,756 decoded
  bytes.

This is stronger than the q/Q lead because its magnitude separates the passing page from every
failing page. It is not yet proof of causation: page complexity covaries with operator count.
The live causal experiment is therefore text-position preservation, not another graphics-state
count.

## Disposition

The null sanitize filter remains withdrawn as a general editing primitive. C8 is not widened,
the corpus is not reduced, and no feature is promoted.

Features previously labelled `EXCLUDED` only because Spike A was red move to `OPEN` on Spike
A-2. They are neither absent from the engine nor structurally server-bound. Spike A-2 exits only
when a text-position-preserving filter or post-filter mechanism passes both stages of the
precommitted C8 rule with pdf.js and qpdf.
