# 2026-07-26 Forked engine landing and null-filter oracle

## Questions

1. Can the fork expose a real `pdf_processor` without a JavaScript callback per operator?
2. Do the resolved `Tf`, `BDC`, and `BI` values survive the WASM ownership boundary?
3. Does a sanitize filter specified to make no semantic change preserve the shared corpus
   when an independent reader judges it?
4. Does MuPDF 1.28.0 already expose a two-phase signing API that can return before
   WebCrypto runs?

## Engine result

The fork builds from MuPDF 1.28.0 with Emscripten 4.0.8 and emits five committed
artifacts. The WASM binary is 10,659,894 bytes. The processor bridge writes a 32-byte
header, fixed 64-byte little-endian records, and one payload section into an `fz_buffer`.
JavaScript copies that buffer once. There is no operator-by-operator JS trampoline.

The processor trace retains every borrowed font, PDF object, image, colorspace, pattern,
and shade it records, and releases those references in reverse order when the trace is
destroyed. Runtime tests over one real page established:

- `Tf` returned a non-null resolved `pdf_font_desc`; its font name, embedded flag, writing
  mode, resource name, and point size were readable after `pdf_process_contents` returned.
- `BDC` returned the cooked dictionary and its `MCID` value of 7.
- `BI` returned a decoded 1 by 1, three-component image.
- The bridge installs buffered record callbacks for all 85 processor operator types. The
  runtime fixture also confirmed terminal `EOD` and `END` records.

The generalized `wasm_pdf_filter_page_contents` export always constructs
`pdf_new_sanitize_filter`; JavaScript controls the existing recurse, form-instancing,
ASCII, no-update, and newline flags through a bit field.

## Corpus

The corpus is fixed in `tests/fixtures/pdf-corpus/corpus.ts`. Its hashes, source revisions,
licences, producers, page counts, and feature assignments are executable test data. It has
13 documents and more than eight distinct producers:

- Acrobat Distiller, Microsoft Word through Adobe PDF Services, GPL Ghostscript, pdfTeX,
  LibreOffice Writer, Quartz/Pages, Apache FOP, CamScanner, Adobe Acrobat, iText, and
  purpose-built Apache PDFBox and veraPDF regression fixtures.
- Simple, CID, subsetted, fully embedded, and Type 3 fonts.
- Tagged and untagged PDFs.
- Optional content, a transparency group, clipping paths, RTL, and CJK.
- Linearized and non-linearized files.
- A one-page derivative with an invalid `startxref` that MuPDF repairs on open and pdf.js
  independently reconstructs.

Apache PDFBox fixtures are from revision
`17d5266a909a7631b08e0a3b4c8c6af08c5f0381` under Apache-2.0. The Type 3 fixture is from
veraPDF corpus revision `49de56cd987929932c9e4fbbbe67d052bf44ef83` under CC BY 4.0.
The CamScanner document is Internet Archive item `EducomBulletinApr1967`, marked public
domain.

## Oracle method

For every page:

1. pdf.js 6.1.200 rendered the original at 144 dpi and extracted its text items.
2. MuPDF applied the null sanitize filter and performed a full compressed save.
3. qpdf 12.3.2 checked the saved object graph, xref, and streams.
4. pdf.js rendered and extracted the saved file.

MuPDF never read its output as acceptance evidence.

The C8 page tolerance was fixed after retaining the raw first measurement and before
classifying the result:

- viewport drift at 144 dpi: at most 0.001 pixel;
- changed-pixel ratio: at most 0.0001 (0.01 percent);
- maximum channel delta: at most 32 of 255;
- channel RMSE: at most 0.1.

All four bounds must pass. This accepts the three changed antialiasing pixels in the FOP
fixture but rejects the broader or higher-amplitude changes below. The test records the
known failing page numbers and the measured ceilings; a new failure or larger perturbation
fails CI instead of widening C8.

## Per-document result

| Document                          | qpdf | Text | pdf.js at 144 dpi                                                                                       | C8       |
| --------------------------------- | ---- | ---- | ------------------------------------------------------------------------------------------------------- | -------- |
| `distiller-tagged-linearized.pdf` | pass | same | pixel-exact                                                                                             | pass     |
| `word-cid.pdf`                    | pass | same | pixel-exact                                                                                             | pass     |
| `ghostscript.pdf`                 | pass | same | pages 1, 2, 5, 6, and 7 changed; max 54 pixels, ratio 0.000027, delta 64, RMSE 0.057; page 5 exceeds C8 | **fail** |
| `latex-pdftex.pdf`                | pass | same | every page changed; pages 2-28 exceed C8; max 11,399 pixels, ratio 0.005684, delta 103, RMSE 0.333      | **fail** |
| `libreoffice.pdf`                 | pass | same | page 1 changed by 19,481 pixels, ratio 0.009714, delta 66, RMSE 0.408; viewport drift 0.000086 pixel    | **fail** |
| `rtl-quartz.pdf`                  | pass | same | pixel-exact                                                                                             | pass     |
| `apache-fop.pdf`                  | pass | same | 3 pixels changed, ratio 0.0000015, delta 28, RMSE 0.019                                                 | pass     |
| `mobile-camscanner.pdf`           | pass | same | all 12 pages pixel-exact                                                                                | pass     |
| `type3-font.pdf`                  | pass | same | pixel-exact                                                                                             | pass     |
| `transparency-group.pdf`          | pass | same | pixel-exact                                                                                             | pass     |
| `ocg-acrobat.pdf`                 | pass | same | pixel-exact                                                                                             | pass     |
| `cjk-itext.pdf`                   | pass | same | pixel-exact                                                                                             | pass     |
| `repaired-bad-startxref.pdf`      | pass | same | pixel-exact after independent reconstruction of the input                                               | pass     |

The failures span Ghostscript, pdfTeX, and LibreOffice, with simple and CID fonts and both
small antialiasing changes and a 0.97-percent changed-pixel result. They are not confined to
a reliably detectable document class. Under the precommitted decision table in
`PRODUCT-SPEC.md`, **Spike A stage 1 is red**. Content-stream rewriting is not the primary
editing path. A red stage 1 is conclusive, so stage 2 was not run.

## Two-phase signer evaluation

MuPDF 1.28.0 has no public two-phase signing API.

`pdf_signature_set_value` allocates `/ByteRange` and `/Contents` placeholders and stores an
unsaved signer. During save, the private `complete_signatures` function locates those
placeholders in the already-written output, writes the final byte ranges, immediately calls
`pdf_write_digest`, and then destroys the unsaved-signature records. `pdf_write_digest`
opens the byte-range stream, calls the synchronous `signer->create_digest`, seeks back, and
writes CMS bytes into `/Contents`.

A two-phase design is feasible only with additional fork work that splits
`complete_signatures`, owns the partially written output and unsaved-signature state across
calls, returns exact byte ranges to JavaScript, and validates the CMS length before
re-entering to install it. No such state object or boundary exists today. Asyncify remains
proven only for the reduction in the earlier Spike C finding. No signer or Asyncify
instrumentation was added.

## Verified

- Fresh-clone patches apply to MuPDF 1.28.0.
- The C bridge, all new low-level exports, and high-level TypeScript bindings compile.
- `mupdf.js` and `mupdf.d.ts` are emitted and included in the artifact manifest.
- The runtime processor values named above are resolved and owned correctly.
- Every filtered output is structurally accepted by qpdf 12.3.2.
- Every filtered output has identical pdf.js text items.
- The per-page render differences above are measured by pdf.js, not MuPDF.
- Full source and tracked patch/build-input digests pass the WASM freshness gate, and a
  fresh engine rebuild is byte-identical to all five committed artifacts.

## Not verified

- Null-filter visual fidelity did **not** pass across the corpus.
- A non-null replacement or deletion was not attempted because red stage 1 makes it
  unnecessary under the decision rule.
- AcroForm JavaScript still lacks a browser runtime test; `mujs=yes` is only known to build
  and link.
- No signing callback, CMS construction, WebCrypto operation, independent signature
  validation, cancellation path, or two-phase signer state machine was implemented.
- Timestamping, OCSP, CRL, and LTV remain excluded by zero egress.
