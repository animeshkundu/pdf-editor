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

All verdicts come from pdf.js, raw bytes, or inflated streams. MuPDF locates text and
performs the operation but never grades it, per
[ADR 0019](../adr/0019-correctness-oracles.md). Two exceptions are named where they occur:
locality counts and the trace's own font and BDC data are read from MuPDF handles, because
no independent reader exposes them.

Run on Windows (Node 24.18.0) and re-run in full on Linux x86_64 (WSL Ubuntu, same Node,
`npm ci` from the committed lockfile), against the engine on the
`fast-feature/land-the-forked-mupdf-webassembly-engine-96bd1eb2e4883547` branch (`b3d5ecc`).
**All 120 lines of probe output are byte-identical on both hosts**, checked by diffing the
two captures, which is what lets the host be ruled out as a variable in section 1.

**An earlier version of this document overstated three of its four sections.** The
measurements were repaired and re-run; [what was wrong](#what-this-document-got-wrong) is
listed at the end rather than quietly removed, because the failure mode is the one this
project keeps hitting.

## 1. Redaction's filter flags change nothing

Both configurations were run over the three failing documents, comparing pre/post renders
with pdf.js at 144 dpi. `max ratio`, `maxΔ` and `max RMSE` are independent per-metric
maxima across pages, matching how `tests/pdf-oracle.test.ts` computes them.

| Document           | Flags  | Pages | Failing C8 | max ratio | maxΔ | max RMSE | Output bytes |    C8    |
| ------------------ | ------ | ----: | ---------: | --------: | ---: | -------: | -----------: | :------: |
| `ghostscript.pdf`  | oracle |     9 |          0 |  0.000032 |    7 |    0.009 |      196,097 |   pass   |
| `ghostscript.pdf`  | redact |     9 |          0 |  0.000032 |    7 |    0.009 |      196,280 |   pass   |
| `latex-pdftex.pdf` | oracle |    28 |         27 |  0.005845 |   66 |    0.235 |      390,638 | **fail** |
| `latex-pdftex.pdf` | redact |    28 |         27 |  0.005845 |   66 |    0.235 |      390,298 | **fail** |
| `libreoffice.pdf`  | oracle |     1 |          1 |  0.009585 |   66 |    0.409 |      240,366 | **fail** |
| `libreoffice.pdf`  | redact |     1 |          1 |  0.009585 |   66 |    0.409 |      246,320 | **fail** |

**Every rendered metric is identical between the pairs, while the output bytes differ.** The
byte difference is the control that makes the result meaningful: the flags are genuinely
wired through to the filter and produce materially different files (libreoffice differs by
5,954 bytes), and those different files still rasterise identically. Without that column the
table would be indistinguishable from the flags being ignored.

`latex-pdftex.pdf` exceeds the ratio tolerance by 58x and `libreoffice.pdf` by 96x, and both
exceed the channel-delta tolerance by 2x. ADR 0020's withdrawal is not over-broad for
redaction, and that question is closed.

Stated precisely: this compares two _packages_ of settings, `{recurse, instanceForms,
newlines} = {1,0,1}` against `{0,1,0}`. It does not isolate any single flag. It also
reproduces only the `pdf_filter_options` half of `pdf_redact_page`; the shim passes a zeroed
`pdf_sanitize_filter_options`, which real redaction configures. The supportable claim is that
redaction's filter-options configuration does not rescue the three prior failures, which is
the claim that was in question.

### The ghostscript row does not reproduce, and the metric matters

The corpus records `expectedC8Failures: [5]` for `ghostscript.pdf` with
`observedCeilings: { differentPixelRatio: 0.000027, maxChannelDelta: 64, rmse: 0.057 }`.

Against C8's limits, **only `maxChannelDelta` failed**: 0.000027 passes the 0.0001 ratio
limit and 0.057 passes the 0.1 RMSE limit, while 64 is double the 32 limit. Page 5 failed on
channel delta alone. Locally, per page:

| Page     |      1 |      2 |   3 |      4 |      5 |      6 |      7 |   8 |   9 |
| -------- | -----: | -----: | --: | -----: | -----: | -----: | -----: | --: | --: |
| ratio    | 3.2e-5 | 1.1e-5 |   0 | 3.0e-6 | 1.9e-5 | 1.0e-6 | 2.0e-6 |   0 |   0 |
| **maxΔ** |  **7** |  **7** |   0 |  **6** |  **4** |  **1** |  **4** |   0 |   0 |
| RMSE     |  0.009 |  0.007 |   0 |  0.005 |  0.006 |  0.001 |  0.003 |   0 |   0 |

Page 5's channel delta is **4 against a recorded 64**, a factor of 16. The global maximum
across all nine pages is 7, still a factor of 9 below the recorded value. Meanwhile the local
ratio (0.000032) is _higher_ than the recorded ratio ceiling (0.000027), and a different page
changes than the pipeline reported. That is not one document sitting near a threshold: the
renders differ in kind.

Three independent runs agree with each other and disagree with the record:

| Run                                              | ghostscript C8 failures |
| ------------------------------------------------ | ----------------------- |
| This probe, Windows                              | none                    |
| This probe, Linux x86_64                         | none                    |
| The repo's own `tests/pdf-oracle.test.ts`, Linux | none                    |

`useSystemFonts` is not the variable: the per-page table above is byte-identical with it on
and off. The host is not the variable either; Windows and Linux agree exactly.

From the Linux oracle run, 11 passes and 3 failures:

- `latex-pdftex.pdf` and `libreoffice.pdf` fail on **exactly** the recorded pages with
  exactly the recorded pixel counts. ADR 0020's evidence reproduces.
- Both still fail `expectedFilteredRenderSha256`. An absolute render hash differing while
  every derived metric matches is what you expect when antialiasing shifts before and after
  together: the delta is stable, the absolute pixels are not.
- `ghostscript.pdf` fails `expectedC8Failures` with `expected [] to deeply equal [5]`.

**What explains it is not established.** A different engine build, a different
`@napi-rs/canvas` native binary, or a different pdf.js would all fit. What is established is
that the committed expectations do not reproduce against the committed engine on two hosts
including under the repo's own harness, and that the gap in the failing metric is 9x to 16x
rather than marginal. That must be resolved before the PR merges, since these expectations
are the gate.

Two gate-design defects are visible regardless:

- **`expectedFilteredRenderSha256` pins an absolute rasterization** and cannot survive a font,
  canvas or pdf.js change. The C8 metrics beside it are stable across two hosts; the hash is
  not. Drop it or demote it to advisory.
- **`useSystemFonts: true`** makes a fidelity gate depend on the host's installed fonts. It
  demonstrably does not matter for `ghostscript.pdf`, the only document tested here, so this
  is a principled recommendation rather than a measured one.

## 2. Redaction removes the text; two documents leak

Method: locate a uniquely-occurring word on page 1 with MuPDF's `search`, place a `Redact`
annotation on the returned quad, `applyRedactions` with the named `REDACT_IMAGE_REMOVE`,
`REDACT_LINE_ART_REMOVE_IF_COVERED`, `REDACT_TEXT_REMOVE` constants, full save. Then verify
with pdf.js and by searching every inflated stream.

**The stream column only reports a verdict where one is possible.** A word that was never in
an inflated stream _before_ redaction cannot be shown to have been removed by it, so those
rows read `n/a` rather than `gone`.

| Document                          | Word            | Pages with it | pdf.js | Inflated streams      | Δpx inside | Δpx outside |
| --------------------------------- | --------------- | ------------: | ------ | --------------------- | ---------: | ----------: |
| `libreoffice.pdf`                 | `Characters`    |             1 | gone   | n/a (absent pre)      |      3,020 |      19,224 |
| `apache-fop.pdf`                  | `embedded`      |             1 | gone   | **leaks (latin1)**    |      3,605 |           3 |
| `distiller-tagged-linearized.pdf` | `ItalicLine`    |             1 | gone   | n/a (absent pre)      |      2,259 |           0 |
| `ghostscript.pdf`                 | `questionnaire` |             1 | gone   | n/a (absent pre)      |      1,873 |          65 |
| `latex-pdftex.pdf`                | `Mathematical`  |         **2** | gone   | leaks, unattributable |      2,105 |          90 |
| `ocg-acrobat.pdf`                 | `AlignmentTest` |             1 | gone   | **leaks (latin1)**    |      2,313 |           0 |

**The pdf.js column is a real measurement** on all six: each word was confirmed extractable
before redaction and absent after. "Δpx inside" is the positive control that the redaction
fired, and a rendered page confirms it visually: apache-fop reads "What follows is a PDF file
███████ as a Form XObject using Apache FOP:" with the tiger image intact.

`latex-pdftex` is excluded from the leak count: the word appears as live text on **2** of its
28 pages, and only page 1 was redacted, so a surviving occurrence is expected. It is also
present in embedded Type1 font programs, in `Copyright (C) 1997 American Mathematical
Society`. Neither the probe nor this document can attribute its survivor, so it counts for
nothing either way.

That leaves **two genuine leaks, both on single-page documents where no other occurrence can
explain the survivor.**

### Collateral damage matches the null filter, by count

The outside-box counts equal the section 1 per-page numbers exactly: libreoffice 19,224,
ghostscript page 1 65, latex-pdftex page 1 90.

Equal counts are not proof of equal pixels; two disjoint sets of 19,224 pixels would produce
the same number, the two runs are different operations, and the equality additionally
requires the filter to have changed exactly zero pixels inside the redaction box. Treat this
as a strong consistency signal, not an identity proof. Comparing the changed-pixel coordinate
masks would settle it and has not been done.

### Leak 1: a non-collecting save keeps the pre-redaction stream

`saveToBuffer('compress')` does not garbage-collect, so the original content stream survives
as an orphan. It is unreachable by pdf.js, which is exactly what makes it dangerous: the
document looks redacted and inflating it recovers the text verbatim.

| Save mode                               | `apache-fop.pdf` |  Bytes | `ocg-acrobat.pdf` |   Bytes |
| --------------------------------------- | ---------------- | -----: | ----------------- | ------: |
| `compress`                              | **present**      | 81,898 | **present**       | 977,433 |
| `compress,garbage`                      | gone             | 32,890 | **present**       | 975,132 |
| `compress,garbage=compact`              | gone             | 32,544 | **present**       | 974,832 |
| `compress,garbage=deduplicate`          | gone             | 32,544 | **present**       | 972,252 |
| `garbage=deduplicate,compress,sanitize` | gone             | 32,543 | **present**       | 971,091 |

**Only `apache-fop` demonstrates the transition, so this is n=1.** The other three documents
in the earlier version of this table never had the word in a stream to begin with and are
excluded. The mechanism is not in doubt, but one document is one document, and the file more
than halving on this one is not attributable to the orphan without checking what else
collection removed: the same collection drops ghostscript 7%, distiller 9% and libreoffice
0.4%.

**Recommendation, at n=1 confidence: a redacting save should garbage-collect**, enforced in
the engine port rather than left to the caller, because the failure is silent and the cost of
being wrong is publishing the text. Widening the corpus before writing it into the port is
cheap and should be done.

### Leak 2: redaction does not clear text outside the page content stream

`ocg-acrobat.pdf` retains `AlignmentTest` under **every** save mode above, including
`garbage=deduplicate,compress,sanitize`. It is a single-page document and the word occurs on
that one page, so nothing else explains the survivor. Collection does not help because this
is not an orphan. Surviving copies sit in:

- **Marked-content property dictionaries** —
  `/Artifact <</Contents (AlignmentTest) /Subtype /Header /Type /Pagination>> BDC`, in objects
  124 and 245.
- **XMP metadata** — `<Header><Center>AlignmentTest</Center></Header>` in objects 217, 220
  and 222.
- **Form XObject content** — object 127 draws `BT /Arial,Bold 8 Tf 0 -6.316 Td
(AlignmentTest) Tj ET`.

pdf.js extracts none of it, so every reader-based check passes while the bytes sit in the
file. **A redaction oracle that only asks a reader is not an oracle.**

Note the third bullet is inside a content stream, so the section heading is a simplification:
what redaction misses here is a form's stream plus two non-stream categories. One document
shows that this redaction did not scrub these categories; it does not establish that MuPDF
never does.

### The instrument's own limits, which bound both leaks

The stream scanner finds `stream`/`endstream` by byte search and inflates. Every failure mode
ends in searching un-inflated bytes for plaintext, which reports a leak as absence:

- `endstream` occurring inside compressed data truncates the slice; `/Length` is available and
  not used.
- Non-FLATE filters and multi-filter chains (`/LZWDecode`, `[/ASCII85Decode /FlateDecode]`)
  fail to inflate. **On `ocg-acrobat.pdf`, 36 of 82 streams fail and are searched as
  compressed bytes**, so Leak 2's three categories are a lower bound on that file.
- Encrypted documents would be searched as ciphertext.
- Needles are searched as Latin-1, UTF-16BE and lowercase hex. Octal escapes, subset-font
  custom encodings and 2-byte Identity-H CIDs still evade it. All current hits are Latin-1.
- Occurrences outside any stream are now searched separately and reported; there are none.

The direction of every one of these is the same: **the leaks reported here are a floor, not a
ceiling.**

## 3. Editing: the trace delivers, except through forms

`processContents()` returns a buffered operator trace. Measured over 12 corpus documents,
**page 1 only**:

| Signal                    | Result                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Fonts resolved at `Tf`    | every `Tf` on all 11 documents that have one; `ocg-acrobat.pdf` has none                           |
| `getName()`               | real names: `BAAAAA+NotoSans-Regular`, `IPVHQJ+TTBC1504B8t00`, `JZDCCA+CMR7`, `Type3 (10 0 R)`     |
| `isEmbedded()`            | discriminates: 57/57 on ghostscript, **0/14** on distiller, 0/26 on mobile-camscanner              |
| `getWritingMode()`        | 0 on every document; **no vertical-writing document in the corpus**, so untested for ≠ 0           |
| Cooked `BDC` dictionaries | every `BDC` on the 4 documents that have any: 14/14, 10/10, 3/3, 2/2                               |
| Operator coverage         | up to 29 distinct on one page: `gs_begin/OP/op/OPM/end`, `sc_pattern`, `BI`, `Do_image`, `Do_form` |

`isEmbedded()` returning 0/14 on a document whose fonts really are non-embedded Arial is the
evidence that these accessors report rather than assert. Fonts resolve on every `Tf`, which is
the claim the encoding-inversion design rests on, and it holds.

`TJ` arrays arrive through `handles[0]` as a PDF array, not in `payload`.

### The limit: `processContents()` does not descend into Form XObjects

| Document                          | Trace bytes | Space codes | pdf.js chars | bytes/chars |
| --------------------------------- | ----------: | ----------: | -----------: | ----------: |
| `libreoffice.pdf`                 |      **33** |           0 |    **2,360** |    **0.01** |
| `ghostscript.pdf`                 |       1,282 |         183 |        1,219 |        1.05 |
| `latex-pdftex.pdf`                |         961 |           0 |        1,117 |        0.86 |
| `rtl-quartz.pdf`                  |         163 |          15 |          166 |        0.98 |
| `apache-fop.pdf`                  |          71 |          13 |           71 |        1.00 |
| `mobile-camscanner.pdf`           |          39 |           3 |           67 |        0.58 |
| `distiller-tagged-linearized.pdf` |          62 |          17 |           51 |        1.22 |
| `word-cid.pdf`                    |           8 |           4 |            4 |        2.00 |

**This ratio cannot establish completeness and is not offered as doing so.** The numerator is
raw character _codes_ and the denominator is pdf.js _Unicode characters_; ligature expansion,
`/ToUnicode` remapping and 2-byte Identity-H codes move the two sides independently, and a
document can sit at 1.0 while a form supplies half its text invisibly. Four of the eight
samples are under 75 characters. It is a smoke test.

What it does support is the outlier, because a 70x gap is robust to any of that:
`libreoffice.pdf` page 1 yields **33 bytes** of trace text against **2,360** extracted
characters. The cause is direct: the page's `/Form1` XObject is 31,961 bytes and contains
**1,210** `TJ` substrings, and the trace reports **1** `TJ` record. About 98% of the page's
text is invisible to the analysis layer, and LibreOffice wraps content in a form by default.

Note the asymmetry with redaction, which handled the same document: `pdf_redact_page` sets
`instance_forms=1`, so forms are instanced and filtered. The trace has no equivalent, so
**redaction sees text the editing analysis cannot.**

### The write path exists, but not the designed one

`pdf_new_buffer_processor` is **absent from the build**. None of the 508 `wasm_*` exports in
`mupdf-wasm.wasm` is an operator-level re-serializer, so the designed edit path (trace,
modify the operator stream, write it back through a buffer processor) cannot be expressed.

`wasm_pdf_update_stream` did land, exposed as `PDFObject.writeStream`, which replaces a
content stream's bytes wholesale. An edit was run rather than assumed: rewriting the `Tj`
string `Line 1` to `EDITED` in `distiller-tagged-linearized.pdf`, saved with
`compress,garbage=deduplicate`.

| Check                                | Result |
| ------------------------------------ | ------ |
| pdf.js extracted the old text before | yes    |
| pdf.js extracts the new text after   | yes    |
| pdf.js still finds the old text      | no     |
| Pixels changed on page 1             | 388    |
| Page count                           | 1 → 1  |

**An in-place text edit reaches an independent reader intact.** Scope that narrowly. The
replacement was ASCII, byte-length-preserving, into a simple-font `Tj` on a document whose
stream contains the literal. It exercises none of the hard parts: encoding inversion through
`/Differences` or `/ToUnicode`, width and advance correction, subset fonts missing a glyph,
`TJ` kerning arrays, or a length-changing edit. It establishes that the write path works, not
that editing works.

## What this changes

1. **Closed.** Redaction's filter configuration does not rescue it from ADR 0020, and the
   differing output sizes prove the flags were live. ADR 0020's two load-bearing failures
   reproduce exactly under the repo's own oracle on Linux.
2. **The committed corpus expectations do not reproduce against the committed engine.**
   `ghostscript.pdf` is recorded as failing on `maxChannelDelta 64`; the local maximum across
   all nine pages is 7 and page 5's is 4. Two more documents fail their pinned render hashes
   while every derived metric matches. Resolve before merge. Separately, drop or demote
   `expectedFilteredRenderSha256` and set `useSystemFonts: false`.
3. **A redacting save should garbage-collect**, enforced in the engine port. Held at n=1;
   widen the corpus before writing it in.
4. **Redaction is `DEGRADED`, not `LOCAL`**, until it clears marked-content properties,
   metadata and form content, or refuses documents where it cannot.
5. **Redaction verification must read inflated bytes and must assert the needle was present
   before it was absent.** Both leaks here pass every pdf.js-based check, and half the
   original table's byte-level verdicts were printed on a check with nothing to find.
6. **`processContents()` needs form recursion or instancing.** Until then any page with a
   `Do_form` is only partly analysable and the badge must say so.
7. **The operator-level write path did not land.** Editing currently means whole-stream byte
   replacement through `pdf_update_stream`. That works end to end on a trivial case and is not
   a substitute for the designed path.
8. **The corpus has no vertical-writing document**, so `getWritingMode()` is untested for any
   value but 0.

## What this document got wrong

Every one of these was in the published first version and was found by adversarial review
plus the controls that review prompted. They are listed because the pattern matters more than
the individual errors.

| Claim                                                       | Reality                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six documents show redaction removing text from streams     | Three never had the word in a stream. The check could not fail; it printed `gone` on the untouched original too.                                           |
| A 5-document garbage-collection experiment                  | Three contributed nothing. The product rule rests on n=1.                                                                                                  |
| ghostscript sits near the C8 ratio threshold                | It failed on `maxChannelDelta`, which the document never mentioned. The gap is 9x-16x, not marginal.                                                       |
| A Windows-vs-Linux rasterizer difference explains it        | The Linux run produced identical numbers. Withdrawn; no explanation is established.                                                                        |
| `getName()`, `isEmbedded()`, `getWritingMode()` all work    | The probe read `r.font?.name`, which does not exist, so the column was unconditionally 0. The quoted names came from an uncommitted dump. Now measured.    |
| `latex-pdftex`'s survivor is font copyright metadata        | The word is live text on 2 of 28 pages and only page 1 was redacted. Unattributable.                                                                       |
| Text coverage of 1.00-1.38 shows the trace carries the text | The ratio compares character codes to Unicode characters with whitespace stripped. Corrected, the band is 0.58-2.00 and proves nothing about completeness. |
| maxΔ 45 and RMSE 0.166 on `latex-pdftex`                    | Those were the worst-_ratio_ page's values. The true independent maxima are 66 and 0.235.                                                                  |
| `applyRedactions(true, 1, 0, 0)` was described as safe      | The positional `0` set `REDACT_LINE_ART_NONE`, disabling line-art redaction. Now uses named constants.                                                     |

The common thread is a verdict computed without its negative control. The one section that
holds up unchanged, section 1, is the one that had a control built in from the start: two
configurations compared against each other rather than a single measurement against an
expectation.

## Reproducing

Probes live in `tests/probes/`. Each is standalone and prints its own table.

| Script                        | Question                                         |
| ----------------------------- | ------------------------------------------------ |
| `redact-flags.probe.mjs`      | §1: do redaction's flags change the render       |
| `gs-discrepancy.probe.mjs`    | §1: per-page metrics vs the recorded expectation |
| `redaction.probe.mjs`         | §2: does redaction remove the text               |
| `redaction-leak.probe.mjs`    | §2: which stream retains it                      |
| `redaction-garbage.probe.mjs` | §2: does a collecting save fix it                |
| `editing-trace.probe.mjs`     | §3: what the trace delivers                      |
| `tj-coverage.probe.mjs`       | §3: how much shown text the trace carries        |
| `form-recurse.probe.mjs`      | §3: where libreoffice's text actually is         |
| `inplace-edit.probe.mjs`      | §3: does an edit reach an outside reader         |

On Linux, `npx vitest run tests/pdf-oracle.test.ts` reproduces the §1 discrepancy directly. It
needs `unzip` on PATH for the pinned qpdf download.
