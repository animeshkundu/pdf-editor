# Conversion and Compare: capability decisions and kernel design

**Date**: 2026-08-01  
**Track**: Conversion (CONV) and Compare (CMPR)  
**Status**: Superseded for OCR by
[`2026-08-02-ocr-engine-selection.md`](2026-08-02-ocr-engine-selection.md). Comparison
integration remains current.

---

## 1. Summary

This note records the evidence behind every capability decision made in this
track, the threshold derivations for the comparison kernel, and the driver
integration requests that remain outstanding.

Work delivered:

- `lib/compare/` — framework-free comparison kernel (fingerprint, text-diff,
  raster-diff, page-sequence)
- `lib/ocr/client.ts`, `lib/ocr/ocr.worker.ts` — honest cross-browser OCR
  availability messaging
- `entrypoints/app/tools/CompareTool.tsx` — text diff context and an explicitly
  non-comparative current-page OCR inspection control
- `entrypoints/app/tools/ConversionTools.tsx` — CONV-020 honest editable output,
  CONV-015 RTF export, CONV-003/005 refusal surfaces

---

## 2. OCR (CONV-017, CONV-018, CONV-019, CONV-020)

### TextDetector browser floor

TextDetector (Shape Detection API, W3C draft) is the only on-device text
recognition API available in a browser without a bundled model. Its availability
at the project browser floor (ADR 0013):

| Browser     | Version floor | TextDetector                                  |
| ----------- | ------------- | --------------------------------------------- |
| Chrome/Edge | 95            | Available (shipped since Chrome 74, stable)   |
| Firefox     | 131           | **Absent** — never shipped in release channel |
| Safari      | 15.2          | **Absent** — not in WebKit as of 2026-08      |

**Consequence**: CONV-017 remains DEGRADED. OCR is not LOCAL because it is
unavailable in two of the three supported browsers. Marking it LOCAL would be
false.

### No bundled OCR model

Adding a bundled WASM OCR model (Tesseract.js, etc.) would require:

1. A new npm dependency, subject to supply-chain review.
2. An increase in bundle size, requiring re-certification against size budgets.
3. A dependency or bundle change (outside this bounded track).

The zero-egress posture (ADR 0002) forbids downloading any model at runtime.
That conclusion was wrong. ADR 0002 forbids runtime third-party provisioning, not shipping a
model in the static artifact. The current build bundles its OCR engine and English trained data
and loads both lazily from the same origin.

### CONV-020: editable-text output

The parity inventory labels editable-text PDF output `EXCLUDED`. The implementation
does not offer or imply that output:

- The OCR panel downloads recognised text as plain text (CONV-019 degraded
  variant).
- It does **not** offer to write an editable-text PDF. The searchable-image
  output (invisible text layer over the original image, CONV-019 correct form)
  requires the doc worker to write a new content stream. That path is not
  plumbed in this track.
- The panel notes this as a driver integration request.

**Why not implement the searchable-image overlay here**: Writing an invisible
text layer requires `pdf_filter_page_contents` with a custom processor that
adds a text object in the page coordinate space, then saves the result through
the engine's save pipeline. This is a document mutation that goes through the
worker (ADR 0008) and must be validated with pdf.js (ADR 0019). It is a correct
scope, but it is larger than a "bounded track" item.

---

## 3. Conversion (CONV-003, CONV-005, CONV-015)

### CONV-003: HTML to PDF

**Decision: not implemented, minimal refusal surface added.**

The only available mechanism is `window.print()`, which opens the system print
dialog and cannot be driven programmatically to save a file. An alternative
approach — rendering HTML to a canvas and encoding as PDF — produces extremely
low-fidelity output for any non-trivial page.

The structural barrier is a browser security boundary: the print API is
intentionally not scriptable to file output. This is not a missing library.

**Honest scope**: Local files are in principle reachable (no third-party fetch),
but the output cannot be captured programmatically. The refusal surface explains
this and does not pretend to a capability that does not exist.

### CONV-005: Office formats to PDF

**Decision: not implemented, minimal refusal surface added.**

Production-grade Word/Excel/PowerPoint parsing requires a complete document-model
implementation for each format. The following options were considered and rejected:

| Option                       | Reason for rejection                               |
| ---------------------------- | -------------------------------------------------- |
| LibreOffice compiled to WASM | Bundle size ~50 MB compressed; exceeds size budget |
| SheetJS (xlsx)               | Only reads/writes; no PDF render path              |
| DOCX.js                      | Incomplete render fidelity, no PDF output          |
| mammoth.js                   | HTML output only, no layout preservation           |

None of these produces an independently-openable PDF of acceptable quality
without a render pipeline that is itself a browser limitation (see CONV-003).

Adding any of these as a dependency also requires supply-chain review and exact
pinning (project rules). This is outside the bounded track.

### CONV-015: PDF to RTF

**Decision: implemented as a minimal text-only export.**

RTF 1.0 is simple enough to produce from structured text without a library.
The implementation:

- Uses `getPageText()` for each page to get reading-order text.
- Produces a minimal RTF 1.0 document with font table and info group.
- Escapes backslashes, curly braces, and non-ASCII characters correctly.
- Does not preserve layout (columns, floats, precise positioning).

The output is valid RTF that can be opened in any RTF-capable word processor
(Word, LibreOffice Writer, Pages, TextEdit). The limitation is disclosed in the
UI: "Use when text content matters and layout does not."

This implementation does not add any dependency. It is fully local.

---

## 4. Comparison kernel (CMPR-001 through CMPR-009)

### 4.1 Content fingerprinting and similarity (CMPR-005)

**Algorithm**: Jaccard coefficient over unique word sets (case-insensitive,
punctuation stripped, tokens ≥ 2 characters).

**Why Jaccard**: Stable, interpretable, order-independent. A moved page with
the same words scores 1.0 whether or not the words are rearranged by
a different producer. Cosine similarity over TF-IDF would require maintaining
a corpus IDF table, which is impractical in a framework-free kernel.

#### Threshold derivation

The thresholds were calibrated against the pdf-corpus fixtures (text extracted
via MuPDF `toStructuredText().asText()`). Key measurements:

**Same-page pairs** (same text extracted from the same page twice):

- Jaccard = 1.0 (exact, by definition of Jaccard on identical sets)

**Adjacent pages of the same document** (ghostscript.pdf, 9 pages, technical
survey):

- Pages 1–2: Jaccard ≈ 0.28 (shared vocabulary: "the", "of", "figure", etc.)
- Pages 1–8: Jaccard ≈ 0.15 (more distant)
- Maximum cross-page Jaccard in this document: < 0.40

**Pages from distiller-tagged-linearized.pdf** (single page, boundary trivial).

**Pages from latex-pdftex.pdf** (28 pages, mixed LaTeX source + output):

- Consecutive pages: Jaccard ≈ 0.15–0.35 (shared LaTeX commands as tokens)
- Non-adjacent pages: Jaccard < 0.20

**mobile-camscanner.pdf** (12 pages, scanned):

- All pages produce empty text → null similarity for all pairs → raster review
  recommended for all.

**Threshold choices**:

| Threshold | Value | Justification                                                                                                                                                                       |
| --------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SAME      | 0.90  | Gap from highest observed cross-page similarity (<0.40) to same-page (1.0) is 0.60. At 0.90, the margin to nearest false-positive risk is 0.50, sufficient for OCR noise tolerance. |
| RELATED   | 0.20  | Filters stop-word coincidence (typical unrelated pages: <0.20). Retains "partially changed" pages above the stop-word floor.                                                        |

These constants are exported as `SIMILARITY_THRESHOLDS` and tested in
`tests/compare.test.ts`.

### 4.2 Text diff (CMPR-003)

**Algorithm**: LCS (longest common subsequence) over word tokens. Returns
`TextRun[]` with `type: 'equal' | 'insert' | 'delete'`.

**Why not character-level diff**: Character counts are already in the engine's
`CompareResult` (currentCharacters / incomingCharacters). The requirement
explicitly says "classify insertions/deletions, not character counts." A
word-level diff provides actionable information: which words were added or
removed, not merely how many characters changed.

**MAX_DIFF_TOKENS = 2048**: The full LCS table for n×m tokens requires n×m
cells. At 2048² = ~4M cells × 2 bytes = 8 MB per diff operation. This is
within the worker budget (DESKTOP_BUDGET.wasmSoftCeiling) but chosen
conservatively. Inputs above this limit are truncated and `truncated=true` is
set.

### 4.3 Raster difference (CMPR-004)

**Metric**: RMSE (root mean squared error) over all RGBA channels.

**Why RMSE**: It is a continuous, named, well-understood metric. It is
interpretable (RMSE of 1.0 on a 0–255 scale means a mean absolute error of
roughly ±1 per channel across the image). It is reproducible.

**The C8 oracle is not changed**. The C8_TOLERANCE in `tests/pdf-oracle.test.ts`
measures MuPDF-vs-pdf.js rendering variation for correctness testing. The
RASTER_THRESHOLDS in `lib/compare/raster-diff.ts` are independent values for
document-comparison use. The distinction matters:

- **C8 scenario**: same document, two different renderers (MuPDF and pdf.js),
  measuring rendering fidelity.
- **CMPR-004 scenario**: two different documents, same renderer (MuPDF at same
  settings), measuring whether content changed.

In the CMPR-004 scenario, identical content produces RMSE = 0.0 exactly (same
engine, same anti-aliasing). The only variation is from lossy-compressed images
embedded in the PDFs.

#### Threshold derivation

**Source data**: C8 oracle thresholds and corpus observations:

- C8_TOLERANCE.rmse = 0.1 (inter-renderer ceiling)
- Maximum observed C8 failure RMSE in corpus: 0.40851 (libreoffice.pdf, page 1)
- C8_TOLERANCE.differentPixelRatio = 0.0001
- C8_TOLERANCE.maxChannelDelta = 32

**RASTER_THRESHOLDS derivation**:

| Metric              | Value | Derivation                                                                                                                                            |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| rmse                | 1.0   | 10× the C8 inter-renderer ceiling (0.1). A same-engine RMSE of 1.0 requires a large fraction of pixels to change by ≥ 1 per channel.                  |
| differentPixelRatio | 0.002 | 20× the C8 inter-renderer ratio (0.0001). Tolerates scattered JPEG artifacts (~0.05% pixels affected).                                                |
| maxChannelDelta     | 16    | Half the C8 maxChannelDelta (32). In a same-engine comparison, there is no anti-aliasing variation, so any delta ≥ 16 on a single channel is unusual. |

A region exceeds the threshold if ANY of the three metrics is above its limit.

**CMPR-004 DEGRADED limitation**: Even with these thresholds, the kernel
detects that a region changed, not which object changed or how. The report
states this explicitly via `RASTER_LIMITS.degradedReason`.

### 4.4 Page sequence classification (CMPR-005)

**Algorithm**: Greedy bipartite matching on similarity candidates above the
RELATED threshold. Maps incoming pages to the highest-similarity current page.
Unmatched incoming = inserted; unmatched current = deleted. Matched at different
positions = moved.

**CMPR-005 DEGRADED limitation**: The greedy algorithm is not optimal.
Documents with many pages sharing vocabulary (multi-chapter books, numbered
forms) may produce sub-optimal assignments near the RELATED threshold. The
SAME threshold (0.90) is high enough that pages above it are correctly classified
in practice.

**Scanned pages**: Pages with no extractable text have null similarity and
are classified as inserted/deleted with `ocrRequired=true`. This is the honest
statement of CMPR-009: a meaningful text comparison requires OCR, and the kernel
cannot perform OCR.

---

## 5. Final integration and inventory decisions

`lib/engine/worker/doc-runtime.ts` now extracts both documents, calls
`classifyPageSequence`, computes word-level insertion/deletion runs, and renders each matched
page into an arena-owned 128 px comparison raster. `CompareResult` carries moved pages, source
indices, similarity, text-diff runs, OCR need, and the named RMSE metrics. The render size is
asserted before allocation and every pixmap/device is arena-owned and closed.

- `CMPR-004` and `CMPR-005` are checked at `DEGRADED`: the functional path ships and the
  raster/threshold limitations are disclosed.
- `CMPR-009` is `EXCLUDED`: the product can identify an OCR requirement and inspect the
  current page in Chromium, but it cannot OCR both compared documents across the browser floor.
- `CONV-015` is checked at `DEGRADED`.
- At the time of this superseded finding, `CONV-017` was checked at `DEGRADED` because
  Chromium's installed `TextDetector` was functional
  and Firefox/Safari unavailability is disclosed before use.
- `CONV-003`, `CONV-005`, and `CONV-020` are `EXCLUDED` because no accepted output writer ships.

### 5.1 Searchable-image PDF output remains absent

A future proposal would need an engine operation that writes an invisible text layer over a
scanned page, saves via the journal, and is independently accepted. It would require:

1. A new doc-runtime function that creates a text-object content stream at the
   correct coordinates.
2. Validation with pdf.js (ADR 0019).
3. A new MutationResult variant reporting the overlay status.

---

## 6. What this track does not change

- Package manifests: no new dependencies were added.
- C8 oracle thresholds: unchanged and separate from raster-diff thresholds.
- OCR output: no searchable/editable PDF is claimed.

---

## 7. Reproducibility

All threshold values in this note are derived from:

- `tests/fixtures/pdf-corpus/corpus.ts` (observed C8 values)
- `tests/pdf-oracle.test.ts` (C8_TOLERANCE constants)
- Manual text-similarity measurements against the corpus PDFs using the
  `textSimilarity` function in `lib/compare/fingerprint.ts`

The measurements are reproducible: `vitest run tests/compare.test.ts` executes
the threshold boundary tests. Any threshold change must update both this note
and the corresponding tests.
