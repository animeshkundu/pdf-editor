# 2026-07-26 Redaction and editing on the forked engine

**Question.** [ADR 0020](../adr/0020-content-stream-rewriting-failed-stage-one.md) withdrew
content-stream rewriting after the null filter perturbed three corpus documents. Two things
were left untested, and both bear directly on whether redaction and in-place editing can
ship:

1. The null-filter run used `recurse=1, instance_forms=0`. MuPDF's own `pdf_redact_page`
   configures the same filter with `recurse=0, instance_forms=1`. Redaction's actual
   configuration was never exercised, so the withdrawal might have been over-broad for
   redaction specifically.
2. Nobody had run a real redaction, or checked what the shipped trace API delivers for
   editing.

All verdicts below come from pdf.js, raw bytes, or inflated streams. MuPDF is used only to
locate text and to perform the operation, never to grade it, per
[ADR 0019](../adr/0019-correctness-oracles.md).

Run on Windows (Node 24.18.0) and re-run in full on Linux x86_64 (WSL Ubuntu, same Node,
`npm ci` from the committed lockfile), against the engine built on the
`fast-feature/land-the-forked-mupdf-webassembly-engine-96bd1eb2e4883547` branch (`b3d5ecc`).
**Every number in this document is identical on both hosts**, which is what allows the
host to be ruled out as a variable in section 1.

## 1. Redaction's filter flags change nothing

Both configurations were run over the three failing documents, comparing pre/post renders
with pdf.js at 144 dpi against the C8 tolerance.

| Document           | Flags  | Pages | Pages failing C8 | Worst ratio | maxΔ |  RMSE | C8       |
| ------------------ | ------ | ----: | ---------------: | ----------: | ---: | ----: | -------- |
| `ghostscript.pdf`  | oracle |     9 |                0 |    0.000032 |    7 | 0.009 | pass     |
| `ghostscript.pdf`  | redact |     9 |                0 |    0.000032 |    7 | 0.009 | pass     |
| `latex-pdftex.pdf` | oracle |    28 |               27 |    0.005845 |   45 | 0.166 | **fail** |
| `latex-pdftex.pdf` | redact |    28 |               27 |    0.005845 |   45 | 0.166 | **fail** |
| `libreoffice.pdf`  | oracle |     1 |                1 |    0.009585 |   66 | 0.409 | **fail** |
| `libreoffice.pdf`  | redact |     1 |                1 |    0.009585 |   66 | 0.409 | **fail** |

**The two rows of each pair are identical to the digit**, and so are the per-page
differing-pixel counts. `recurse` and `instance_forms` do not change what the filter does to
these documents. ADR 0020's withdrawal is not over-broad for redaction on the strength of
the flag difference, and that question is now closed.

`latex-pdftex.pdf` exceeds the ratio tolerance by 58x and `libreoffice.pdf` by 96x. These are
not marginal.

### The ghostscript row does not reproduce anywhere

The corpus records `expectedC8Failures: [5]` for `ghostscript.pdf`, and the pipeline's
oracle table reports page 5 exceeding. It does not reproduce.

Three independent runs, and they agree with each other rather than with the record:

| Run                                              | ghostscript C8 failures |
| ------------------------------------------------ | ----------------------- |
| This probe, Windows                              | none                    |
| This probe, Linux x86_64 (WSL, Node 24.18.0)     | none                    |
| The repo's own `tests/pdf-oracle.test.ts`, Linux | none                    |

The oracle's own output for page 5 is 38 differing pixels, ratio 0.0000189, against a
0.0001 limit. It is a factor of five under the threshold, not near it. Every per-page
differing-pixel count in the probe matches the oracle's own JSON exactly, on both hosts:
65, 22, 0, 6, 38, 2, 4, 0, 0.

**An earlier draft of this document blamed a Windows-versus-Linux rasterizer difference.
That was wrong and is withdrawn.** The Linux run settles it: the two hosts produce
identical numbers, so the host is not the variable. `useSystemFonts` is not the variable
either, ruled out separately by running it both ways.

What the Linux oracle run does show, from 11 passes and 3 failures:

- `latex-pdftex.pdf` and `libreoffice.pdf` fail on **exactly** the recorded pages, with
  exactly the pixel counts recorded. ADR 0020's evidence reproduces.
- Both nonetheless fail their `expectedFilteredRenderSha256` assertion. The absolute
  render hash differs while every derived metric matches, which is what you would expect
  if antialiasing or hinting shifts the before and after renders together: the delta is
  stable, the absolute pixels are not.
- `ghostscript.pdf` fails its `expectedC8Failures` assertion with `expected [] to deeply
equal [5]`.

The simplest explanation consistent with all of it is that **the recorded expectations were
captured against a different engine build than the one committed**, and the ghostscript row
was wrong when written. That should be resolved before the PR merges, because the corpus
expectations are the gate.

Two separate defects in the gate design are visible regardless of that:

- **`expectedFilteredRenderSha256` pins an absolute rasterization** and cannot survive a
  font, canvas or pdf.js change. The C8 metrics it sits beside are stable across two hosts;
  the hash is not. It should be dropped or demoted to advisory.
- **`useSystemFonts: true`** makes the oracle depend on the host's installed fonts for no
  benefit. It happens not to matter for `ghostscript.pdf`, which is the only document it was
  tested against here, but it is an uncontrolled input in a fidelity gate.

## 2. Redaction works, with two leaks

Method: locate a uniquely-occurring word on page 1 with MuPDF's own `search`, place a
`Redact` annotation on the returned quad, `applyRedactions(true, REMOVE, 0, REMOVE)`, full
save. Then verify with pdf.js and with inflated streams.

| Document                          | Word            | pdf.js extraction | Inflated streams | Δpx inside | Δpx outside |
| --------------------------------- | --------------- | ----------------- | ---------------- | ---------: | ----------: |
| `libreoffice.pdf`                 | `Characters`    | gone              | gone             |      3,020 |      19,224 |
| `apache-fop.pdf`                  | `embedded`      | gone              | **present**      |      3,605 |           3 |
| `distiller-tagged-linearized.pdf` | `ItalicLine`    | gone              | gone             |      2,259 |           0 |
| `ghostscript.pdf`                 | `questionnaire` | gone              | gone             |      1,873 |          65 |
| `latex-pdftex.pdf`                | `Mathematical`  | gone              | see below        |      2,105 |          90 |
| `ocg-acrobat.pdf`                 | `AlignmentTest` | gone              | **present**      |      2,313 |           0 |

"Δpx inside" is the positive control. A rendered page confirms it visually: apache-fop reads
"What follows is a PDF file ███████ as a Form XObject using Apache FOP:" with the tiger
image intact.

**Collateral damage is exactly the null-filter perturbation, not more.** The outside-box
counts match the Q1 per-page numbers to the pixel: libreoffice 19,224, latex-pdftex page 1
90, ghostscript page 1 65. Redaction adds nothing of its own. The filter damage is the whole
story, which is what ADR 0020 predicted.

`latex-pdftex` is a false positive of my own making: every surviving hit is inside an embedded
Type1 font program, in the string `Copyright (C) 1997 American Mathematical Society`. That is
font metadata, not document text, and the word picker simply chose badly. It is listed here
because the first version of this measurement counted it as a leak.

### Leak 1: a non-collecting save keeps the pre-redaction stream

`saveToBuffer('compress')` does not garbage-collect, so the original content stream survives
as an orphaned object. It is unreachable by pdf.js, which is what makes it dangerous: the
document looks redacted and anyone who inflates the file recovers the text verbatim.

| Save mode                               | apache-fop plaintext | Bytes  |
| --------------------------------------- | -------------------- | ------ |
| `compress`                              | **present**          | 81,898 |
| `compress,garbage`                      | gone                 | 32,890 |
| `compress,garbage=compact`              | gone                 | 32,544 |
| `compress,garbage=deduplicate`          | gone                 | 32,544 |
| `garbage=deduplicate,compress,sanitize` | gone                 | 32,543 |

The file more than halves once the orphan is collected, which is the orphan's size showing up
directly.

**Product rule: a redacting save must garbage-collect.** This is not a preference. A default
`save` after redaction publishes the text it was asked to remove. It should not be possible to
express a redacting save without collection in the engine port.

### Leak 2: redaction does not reach outside the content stream

`ocg-acrobat.pdf` retains `AlignmentTest` under **every** save mode above, including
`garbage=deduplicate,compress,sanitize`. This is not an orphan and collection does not help.
The surviving copies are in three places redaction never touches:

- **Marked-content property dictionaries** —
  `/Artifact <</Contents (AlignmentTest) /Subtype /Header /Type /Pagination>> BDC`, present in
  two content streams (objects 124 and 245).
- **XMP metadata** — `<Header><Center>AlignmentTest</Center></Header>` in objects 217, 220
  and 222.
- **Form XObject content** — object 127 draws `BT /Arial,Bold 8 Tf 0 -6.316 Td
(AlignmentTest) Tj ET`.

pdf.js extracts none of it, so every reader-based check passes while the bytes sit in the
file. This is the same shape as Leak 1 and the same reason it matters: **a redaction oracle
that only asks a reader is not an oracle.** The check must be over inflated bytes.

Redaction that only rewrites page content streams is not redaction. Before the feature can be
labelled anything better than `DEGRADED`, the engine needs to also sweep marked-content
property dictionaries, document and object metadata, and form content, or refuse documents
where it cannot.

## 3. Editing: the trace delivers, except through forms

`processContents()` returns a buffered operator trace. Measured over 12 corpus documents:

- **Resolved fonts on every `Tf`, without exception.** `getName()` returns
  `BAAAAA+NotoSans-Regular`, `IPVHQJ+TTBC1504B8t00`, `JZDCCA+CMR7`; `isEmbedded()` and
  `getWritingMode()` both work. This is the claim the whole encoding-inversion design rests
  on, and it holds.
- **Cooked `BDC` property dictionaries on every `BDC`**, 14/14 on the tagged document. The
  tagged-PDF path has the input it needs.
- **Broad operator coverage** — up to 29 distinct operators on one page, including the
  graphics-state group (`gs_begin`, `gs_OP`, `gs_op`, `gs_OPM`, `gs_end`), `sc_pattern`,
  inline images (`BI`), `Do_image` and `Do_form`.
- **`TJ` arrays arrive through `handles[0]`** as a PDF array, not in `payload`. My first read
  of this reported the text missing; that was a probe bug, not an engine gap. Reading the
  array gives text coverage of 1.00 to 1.38 against pdf.js character counts on seven of eight
  documents. `word-cid.pdf` reads 2.00 because Identity-H codes are two bytes per glyph,
  which is correct.

### The limit: `processContents()` does not descend into Form XObjects

`libreoffice.pdf` page 1 is the counter-example, at 0.02 coverage. The trace reports **1** `TJ`
record. The page's `/Resources /XObject /Form1` stream is 31,961 bytes and contains **1,210**
`TJ` operators.

About 98% of that page's text is invisible to the analysis layer as shipped. Documents that
wrap their content in a form are not a rare shape; LibreOffice does it by default.

Note the asymmetry with redaction, which handled the same document correctly: `pdf_redact_page`
sets `instance_forms=1`, so forms are instanced and filtered. The trace has no equivalent, so
**redaction sees text that the editing analysis cannot.**

### The write path exists, but it is not the designed one

`pdf_new_buffer_processor` is **absent from the built engine**. A scan of all 508 `wasm_*`
exports in `mupdf-wasm.wasm` finds no operator-level re-serializer, so the designed edit path
(trace, modify the operator stream, write it back through a buffer processor) cannot be
expressed.

`wasm_pdf_update_stream` did land, exposed as `PDFObject.writeStream`, which permits replacing
a content stream's bytes wholesale. That is enough for an end-to-end edit, and one was run
rather than assumed. Rewriting the `Tj` string `Line 1` to `EDITED` in
`distiller-tagged-linearized.pdf` and saving with `compress,garbage=deduplicate`:

| Check                                | Result |
| ------------------------------------ | ------ |
| pdf.js extracted the old text before | yes    |
| pdf.js extracts the new text after   | yes    |
| pdf.js still finds the old text      | no     |
| Pixels changed on page 1             | 388    |
| Page count                           | 1 → 1  |

**An in-place text edit reaches an independent reader intact.** Scope that narrowly. The
replacement was byte-length-preserving and ASCII, into a simple-font `Tj` on a document whose
content stream is uncompressed enough to locate the literal. It exercises none of the hard
parts: encoding inversion through `/Differences` or `/ToUnicode`, width and advance
correction, subset fonts missing the needed glyph, `TJ` kerning arrays, or an edit that
changes the string's length. It establishes that the write path works, not that editing works.

## What this changes

1. **Closed.** Redaction's filter flags do not rescue it from ADR 0020. The withdrawal stands
   as written, and its two load-bearing failures reproduce exactly under the repo's own oracle
   on Linux.
2. **The committed corpus expectations do not match the committed engine.** `ghostscript.pdf`
   is recorded as failing C8 on page 5 and passes on every host tested, including under the
   repo's own harness. Two more documents fail their pinned render hashes while every derived
   metric matches. This must be resolved before the PR merges, since these expectations are
   the gate. Separately, `expectedFilteredRenderSha256` should be dropped or demoted, and
   `useSystemFonts` set to `false`.
3. **A redacting save must garbage-collect**, enforced in the engine port rather than left to
   the caller.
4. **Redaction is `DEGRADED`, not `LOCAL`**, until it also clears marked-content properties,
   metadata and form content. The gap is specific and testable, so this is ordinary
   implementation work rather than an open question.
5. **Redaction verification must read inflated bytes**, never a reader's extraction. Both
   leaks here pass every pdf.js-based check.
6. **`processContents()` needs form recursion or instancing** before the editing analysis can
   claim page coverage. Until then any document with a `Do_form` on the page is only partly
   analysable, and the badge must say so.
7. **The operator-level write path did not land.** `pdf_new_buffer_processor` is absent, so
   editing currently means whole-stream byte replacement via `pdf_update_stream`. That works
   end to end on a trivial case and is not a substitute for the designed path.

Three claims in this document were wrong in their first form and are corrected above rather
than quietly dropped: the latex-pdftex "leak" was a font copyright notice; the "missing `TJ`
text" was my probe calling a method that does not exist; and the ghostscript discrepancy was
blamed on a rasterizer difference that the Linux run then disproved. Each was caught by
running the control rather than by reasoning about the summary.

## Reproducing

Probes live in `tests/probes/`. Each is standalone and prints its own table:

| Script                        | Question                                        |
| ----------------------------- | ----------------------------------------------- |
| `redact-flags.probe.mjs`      | Section 1: do redaction's flags change anything |
| `gs-discrepancy.probe.mjs`    | Section 1: does `useSystemFonts` explain it     |
| `redaction.probe.mjs`         | Section 2: does redaction remove the text       |
| `redaction-leak.probe.mjs`    | Section 2: which stream retains it              |
| `redaction-garbage.probe.mjs` | Section 2: does a collecting save fix it        |
| `editing-trace.probe.mjs`     | Section 3: what the trace delivers              |
| `tj-coverage.probe.mjs`       | Section 3: is all the shown text present        |
| `form-recurse.probe.mjs`      | Section 3: where libreoffice's text actually is |
| `inplace-edit.probe.mjs`      | Section 3: does an edit reach an outside reader |

On Linux, `npx vitest run tests/pdf-oracle.test.ts` reproduces the section 1 discrepancy
directly; it needs `unzip` on PATH for the pinned qpdf download.
