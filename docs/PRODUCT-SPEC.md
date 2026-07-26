# PDF Editor product specification

> **Status: stub. Deliberately not written yet.**
>
> This document will state exactly what the product does: every supported operation, its
> inputs and outputs, its failure modes, and its limits. It is authored **after** the
> de-risking spikes, not before.

## Why this document is empty

A product specification is a promise. This project has three open questions whose answers
determine what can honestly be promised, and writing the specification first would mean
committing to capabilities before knowing whether they are achievable.

### 1. The font encoding inversion

[ADR 0012](adr/0012-content-stream-text-editing.md) describes going from a Unicode
codepoint back to the character code an embedded font uses, reconciling `/Encoding` and
`/Differences`, `/ToUnicode`, `/W`, and `/CIDToGIDMap`. **No library in any language does
this.** Until a spike measures how often Path A (in-place, reusing the embedded font)
succeeds across a real corpus, we cannot say whether text editing is "edit any text" or
"edit text, usually preserving the original font, sometimes embedding a new subset". Those
are different products and the difference matters to the user.

### 2. The fork's four additions

[ADR 0004](adr/0004-fork-the-mupdf-wasm-build.md) is based on reading MuPDF's WASM
binding source and its C API. The reasoning is sound and the exports exist, but no line of
the fork has been built and run yet. Until `js_processor`,
`pdf_filter_page_contents`, `mujs=yes`, and the custom `pdf_pkcs7_signer` are working
against real documents, the features that depend on them (in-place text editing, tagged
structure preservation, form JavaScript, signing) are designed rather than proven.

### 3. Real-document behaviour under the ceilings

[ADR 0014](adr/0014-resource-ceilings.md) sets the ceilings from platform limits and
reasoning. What has not been measured is how a 2,000-page scanned document, a heavily
tagged government form, or a 400 MB engineering drawing actually behaves inside them, and
in particular where iOS Safari kills the tab.

## What is already fixed

These are settled and will not be renegotiated by the specification.

- Zero egress, proved by an executable gate
  ([ADR 0002](adr/0002-client-side-only-zero-egress.md)).
- AGPL-3.0-only, following from MuPDF
  ([ADR 0003](adr/0003-mupdf-as-the-engine-and-agpl.md)).
- Chrome 95, Firefox 131, Safari 15.2 desktop; iOS under a reduced budget
  ([ADR 0013](adr/0013-supported-browser-matrix.md)).
- The exact ceilings in `lib/core/limits.ts`
  ([ADR 0014](adr/0014-resource-ceilings.md)).
- WCAG 2.2 AA chrome and no positioned DOM text
  ([ADR 0015](adr/0015-accessibility-and-no-positioned-dom-text.md)).
- Acceptance by pdf.js and qpdf, never by MuPDF
  ([ADR 0019](adr/0019-correctness-oracles.md)).
- Basic and certification signatures only. No timestamping, no revocation checking, no
  LTV ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md)).

## When this document gets written

After the spikes in [`ROADMAP.md`](ROADMAP.md) report. Each spike ends with a written
finding under [`research/`](research/), and this specification is assembled from those
findings.

Until then, do not treat any capability described in the ADRs as a shipped feature, and do
not write user-facing copy that implies otherwise. Misleading capability claims are a
merge blocker under [`qa/review-rubric.md`](qa/review-rubric.md).
