# 0020. Do not use content-stream rewriting as an editing path

## Status

Accepted

## Date

2026-07-26

## Supersedes

[ADR 0012](0012-content-stream-text-editing.md)

## Context

ADR 0012 made `pdf_filter_page_contents` plus `pdf_new_sanitize_filter` the write side of
in-place text and page-object editing. That decision was explicitly conditional on Spike A:
a null filter had to preserve the shared corpus under pdf.js and qpdf.

The completed independent-reader measurement is
[`2026-07-26-forked-engine-null-filter-oracle.md`](../research/2026-07-26-forked-engine-null-filter-oracle.md).
Every output was structurally valid and retained the same extracted text, but pdf.js found
render differences outside C8 in Ghostscript, pdfTeX, and LibreOffice documents. The
failures cover unrelated producers and font classes, so there is no reliable class to
detect and refuse before mutation.

This is the red outcome in the decision table fixed before the experiment.

## Decision

Content-stream rewriting is withdrawn as a product editing path.

- Existing text is not rewritten in place. Any future text-editing surface uses a clearly
  disclosed PDF annotation/overlay mechanism and does not claim the original content was
  replaced.
- The overlay is an independent annotation mechanism, not the superseded ADR 0012 Path B.
  `PDFObject.writeStream()` remains diagnostic-only and is not a product editing path.
- Existing image/object move, replace, delete, crop, arrange, recompression, and font
  subsetting are withdrawn.
- Redaction that removes existing content is withdrawn. A black overlay is never presented
  as redaction.
- Reading-order and autotag tools that require inserting marked-content operators are
  withdrawn.
- The processor export remains useful for read-side analysis. The filter export remains an
  engine diagnostic and regression surface, not an application mutation path.

Stage 2 is not run. Stage 1 red is conclusive by the precommitted rule; changing words after
a semantic-null rewrite already failed would add risk without changing the decision.

## Consequences

The forked engine still lands because resolved operator access is independently useful and
the failed filter result must remain reproducible. The product loses the most ambitious
editing, true redaction, and tagging capabilities rather than silently perturb documents.

Additive operations and document-dictionary operations that do not rewrite an existing
content stream are unaffected. Any future proposal to restore rewriting needs a new
mechanism and a superseding ADR; widening C8 or shrinking the corpus is not a valid route.
