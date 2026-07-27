# PDF Editor product specification

> **Status: partial draft.** Everything except text-editing depth is drafted. That one
> section is deliberately open, because two spikes decide it and guessing the outcome
> would reproduce exactly the overclaim this project exists to avoid. See
> [Open: text-editing depth](#open-text-editing-depth).

This specification is the parity contract. It is what review is measured against and what
the build pipeline consumes. It is long on purpose: an undifferentiated "Acrobat parity"
claim is worthless, and the only way to make the claim honest is to say, feature by
feature, exactly which kind of parity is on offer.

## Contents

| Document                                               | What it holds                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| This file                                              | Classification, scope boundaries, what is open, acceptance criteria                               |
| [`spec/parity-inventory.md`](spec/parity-inventory.md) | Every feature, by Acrobat's own categories, each labelled                                         |
| [`spec/competitor-wins.md`](spec/competitor-wins.md)   | Capabilities taken from tools other than Acrobat, and why each beats Adobe's version              |
| [`spec/ui-ux.md`](spec/ui-ux.md)                       | Chrome layout, tool switching, comment workflow, Organize Pages, Prepare Form, the keyboard model |
| [`spec/a11y-rules.md`](spec/a11y-rules.md)             | The 32 accessibility rules, each with its check, verdicts, message, fixture and repair            |

Design tokens, density, motion, and focus treatment are in [`DESIGN.md`](DESIGN.md) and are
not restated here.

## The classification, and why it exists

"Adobe parity" and "100% client-side" are in direct tension. Some Acrobat features are
straightforwardly reproducible locally. Some need a different mechanism to reach the same
outcome. Some are reachable but worse. Some are impossible without a server and always
will be.

Collapsing those four into one list would be a lie of exactly the kind
[ADR 0002](adr/0002-client-side-only-zero-egress.md) already had to be corrected for. So
every feature in [`spec/parity-inventory.md`](spec/parity-inventory.md) carries one of five
labels.

### `LOCAL`, exact local parity

The feature works the same way, with the same result, entirely on the device. No disclosure
is needed and none is offered, because there is nothing to disclose.

This covers the bulk of the product: viewing, navigation, search, comment and markup,
organize pages, forms, redaction, compare, and print.

### `EQUIV`, browser-equivalent

The same user outcome through a different mechanism. The mechanism difference is
user-visible, so it is documented, but the user is not worse off. In several cases they are
better off.

The three that matter:

- **Find.** Acrobat uses the application's own find. We intercept Ctrl+F and route it to
  engine search ([ADR 0015](adr/0015-accessibility-and-no-positioned-dom-text.md)), because
  with no positioned DOM text the browser's native find has nothing to search. This is
  strictly better: native browser find would only ever see the mounted pages, while engine
  search covers the whole document, including a 10,000-page one.
- **Clipboard.** Acrobat maintains an internal clipboard alongside the system one. We use
  the system clipboard only, through the async Clipboard API. Copying a page in one
  document and pasting it into another works; the intermediate representation is ours, and
  it is not interchangeable with Acrobat's.
- **Save and Save As.** On Chromium the File System Access API gives a real Save (write
  back to the handle the user opened) and Save As (`showSaveFilePicker`). Firefox and
  Safari do not implement it, so both degrade to a download. The degradation is announced,
  not discovered: a browser without the API shows "Download" rather than a "Save" that
  silently does something else.

### `DEGRADED`, reachable but worse, and said so

The capability exists and is materially weaker than Acrobat's. It ships only with an
in-product disclosure at the point of use, not a footnote in a help page. Two cases:

- **Office export fidelity.** Producing `.docx` or `.xlsx` from a PDF means reconstructing
  a document model the PDF does not contain. Adobe's is the best in the industry and is
  server-side. Ours will be worse, and the export dialog says what is likely to be lost
  before the user commits.
- **OCR quality.** Adobe's OCR runs on their infrastructure with models we cannot match in
  a browser. Ours runs in the lazy `ocr.worker`
  ([ADR 0008](adr/0008-worker-topology-and-crash-isolation.md)) and will be worse on poor
  scans, unusual fonts, and non-Latin scripts. Confidence is surfaced rather than hidden,
  and OCR output is never silently substituted for real text.

A `DEGRADED` feature that cannot carry an honest disclosure does not ship.

### `EXCLUDED`, impossible without a server, and named

These are not gaps to be filled later. They follow from
[ADR 0002](adr/0002-client-side-only-zero-egress.md), and admitting any of them dissolves
the product. They are listed by name so a user comparing against Acrobat finds an answer
rather than silence.

- **Adobe cloud review and shared reviews.** Multi-party review requires a server to hold
  the shared comment stream.
- **Request e-signatures.** Sending a document to another party for signature is a hosted
  workflow by definition. Local signing remains `OPEN` on Spike C
  ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md)); requesting another person's
  signature is excluded regardless of that result.
- **LiveCycle and Adobe Experience Manager rights management.** Policy-protected documents
  contact a rights server on every open. That is the opposite of this product.
- **Cloud storage and cross-device sync.** Document Cloud, recent-files sync, and shared
  links. Persistence is OPFS on the device ([ADR 0017](adr/0017-persistence-via-opfs.md)).
- **XFA forms.** Different from the rest: excluded by the engine, not by the server
  decision. MuPDF has never implemented XFA and has no plan to. Adobe itself deprecated
  XFA, and no modern viewer outside Acrobat renders it. An XFA document is detected on open
  and refused with an explanation naming XFA, rather than rendering the "please update your
  reader" fallback page and letting the user believe the form is broken.

Signature-related exclusions have their own line in
[ADR 0018](adr/0018-signing-via-custom-signer-vtable.md): RFC 3161 timestamping, OCSP and
CRL revocation checking, and PAdES B-LT and B-LTA all require network access.

### `OPEN`, blocked on a spike

The feature's shape is not yet decidable. Every `OPEN` item names the spike that decides
it, and the spec-integrity gate (`scripts/check-spec-integrity.mjs`) fails if one does not,
so "blocked" cannot become a place things go to be forgotten.

Most `OPEN` items depend on one mechanism, content-stream rewriting, and so on Spikes A and
B below. That is not only text: editing an existing image, redaction, the
resource-rewriting half of optimization, and writing marked-content tags all go through the
same filter and carry the same risk.

Three further spikes were added after adversarial review found capabilities with no
demonstrated engine path, each previously labelled as though it worked. They are named
here; their detail is in the inventory item that depends on each.

| Spike | Question                                                                                                          | Blocks                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **C** | Can a synchronous `pdf_pkcs7_signer.create_digest` callback drive asynchronous WebCrypto in single-threaded WASM? | `SIGN-005`, `SIGN-006`, `SIGN-008`, part of `SIGN-007` |
| **D** | Can a `pdf_pkcs7_verifier` be added to the shim, which exports no verification surface at all?                    | `SIGN-010`                                             |
| **E** | Can we interoperate with Acrobat on PDF's public-key security handler?                                            | `SIGN-026`                                             |

Spike C is the most serious: [ADR 0018](adr/0018-signing-via-custom-signer-vtable.md) rests
entirely on that bridge and never addressed the synchrony mismatch.

## Open: text-editing depth

Two spikes were defined to decide the entire shape of text editing. Spike A has now run
under the independent-reader rule and is red. Spike B was cancelled because encoding
inversion cannot restore a write path after the semantic-null filter already perturbed
unrelated producer classes.

### Spike A: the null filter — red

Run `pdf_filter_page_contents` with a pass-through filter specified to change nothing,
across a real corpus, and compare before and after with the independent oracles
([ADR 0019](adr/0019-correctness-oracles.md)).

This was the cheapest possible question with the largest possible consequence. **If a filter
that changes nothing still perturbs the document, content-stream rewriting cannot be the
primary editing path**, and the product's text editing is an annotation-overlay backend
instead. Those are different products:

|                                        | Content-stream rewriting                  | Annotation overlay                    |
| -------------------------------------- | ----------------------------------------- | ------------------------------------- |
| What changes                           | The page's own content stream             | An overlay drawn above it             |
| Reflow                                 | Possible in principle                     | Not possible                          |
| Result in another viewer               | The document genuinely says the new words | The original text is still underneath |
| Redaction                              | Real removal                              | Not redaction at all                  |
| Risk to the untouched rest of the page | Real, and this spike measures it          | None                                  |

The honest position today is that the overlay backend is the fallback, not the plan, and
that this spike decides which one the product is.

### Spike B: the encoding-inversion hit rate — cancelled

Given content-stream rewriting were viable, the second question would have been how much of a real corpus
can be edited **in place, reusing the embedded font** (Path A in
[ADR 0012](adr/0012-content-stream-text-editing.md)) rather than by embedding a new subset
(Path B).

This is measured, not estimated, across a corpus spanning producers, font types, CID and
simple fonts, and subsetted and full embeddings. No library in any language performs this
inversion, so there is no prior art to borrow a number from.

### The corpus

Both spikes, and acceptance criteria C1, C2, C5, C8 and R5, run against one named corpus
so their results are comparable. It is assembled before either spike runs and is fixed
for the duration, because a corpus that grows during a measurement produces a number that
means nothing.

The fixed corpus contains documents from at least eight distinct producers including
Acrobat Distiller, Word, LaTeX, Ghostscript and at least one mobile scanner app; simple
and CID fonts; subsetted and fully embedded fonts; at least one Type 3 font; tagged and
untagged documents; documents with optional content groups, transparency groups, and
clipping paths; at least one right-to-left and one CJK document; linearised and
non-linearised files; and at least one document that MuPDF repairs on open. Every
document is redistributable, so the corpus can live in the repository.

Its composition is executable in `tests/fixtures/pdf-corpus/corpus.ts` and recorded with
the completed finding under
[`research/`](research/) and does not change without a note saying why.

### Spike A decision rule

The measurement: for every page of every corpus document, run the null filter, then
compare before and after.

**Result:** red. Ghostscript page 5, pdfTeX pages 2 through 28, and LibreOffice page 1
exceeded C8. The failures are diffuse across unrelated producers and font classes.
[ADR 0020](adr/0020-content-stream-rewriting-failed-stage-one.md) supersedes ADR 0012.
Stage 2 was not run because a red stage 1 is conclusive under this rule.

**A page passes** when qpdf reports the output structurally valid, extracted text is
identical, and the pdf.js render differs by no more than the C8 per-page tolerance.

| Result                                                                                                                     | Consequence                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every page passes                                                                                                          | Spike A is **green**. Content-stream rewriting is the primary editing path. Items blocked only on Spike A are promoted to their target labels.                                                                                                                                                                                               |
| Failures are confined to a characterisable class (for example, only Type 3 fonts, or only documents MuPDF repairs on open) | Spike A is **conditional**. Rewriting ships, and documents in the failing class are **detected and refused before the edit**, never edited approximately. `SIGN-031` redaction ships only if the failing class can be detected reliably, because a redaction that silently fails on an undetected class is the worst outcome available here. |
| Failures are diffuse and not characterisable                                                                               | Spike A is **red**. Content-stream rewriting is withdrawn. Text editing becomes the annotation-overlay backend, `EDIT-025` is withdrawn, and **`SIGN-031` redaction is withdrawn entirely** rather than shipped as an overlay.                                                                                                               |

**What the null filter does and does not establish.** This is a real limit of the
experiment and it is stated rather than glossed. A null filter proves that the
parse-and-rewrite round trip preserves a document it was told not to change. It does
**not** prove that a rewrite which actually changes something is safe: a real edit
perturbs resources, object numbering, and stream lengths in ways the null case never
exercises.

Spike A is therefore a **necessary condition, not a sufficient one**. A red result is
conclusive and kills the approach. A green result licenses proceeding to a second stage,
in which the same comparison runs over a _non-null_ rewrite (replace one word, delete one
run) and every changed page is inspected for collateral damage. Promotion to a shipped
label requires both stages, and the finding must report them separately.

### Spike B decision rule

This measurement was conditional on Spike A green. It was not run. A hit rate cannot make
an encoding inversion useful when the required stream rewrite already perturbs unrelated
document classes. No hit-rate copy or capability claim was promoted.

### How an OPEN item is resolved

An `OPEN` item is promoted or withdrawn only by a written finding under
[`research/`](research/) that states which rule above it satisfied. The change to its
label, and to the counts in [`spec/parity-inventory.md`](spec/parity-inventory.md), cite
that finding. No `OPEN` item is resolved by judgement alone.

### What cannot be written until both report

- Whether text editing is described as "edit the text" or "edit the text, with a new font
  embedded in some documents".
- Whether reflow within a text block is offered at all.
- Whether redaction is real removal, or is restricted to the cases where it can be.
- What proportion of documents are refused for text editing, and on what grounds.
- Every item in [`spec/parity-inventory.md`](spec/parity-inventory.md) currently labelled
  `OPEN`.

Findings land under [`research/`](research/) as `YYYY-MM-DD-null-filter-fidelity.md` and
`YYYY-MM-DD-encoding-inversion-corpus.md`, and this section is replaced by what they say.

## Prerequisites satisfied

The accessibility rule set was blocked on an authoring task rather than a spike: thirty-two
rule names are not a specification, and an implementer working from names alone would have
invented thirty-two mappings that did not match Acrobat's.

[`spec/a11y-rules.md`](spec/a11y-rules.md) settles it. Each rule states the PDF structures
inspected, the exact pass, fail, manual and unreachable conditions, the user-facing
message, a minimal failing fixture, and what the repair tools can do. `A11Y-001` to
`A11Y-032` are now implementable from this repository alone.

Writing it produced three findings worth surfacing here:

- **Two rules are `unreachable`, not manual.** Screen flicker and timed responses need
  content executed and observed over time. We report the mechanisms and say the condition
  itself cannot be determined, which is more honest than asking a user to check something
  we implied we could have checked.
- **One rule differs from Acrobat deliberately.** Table summary is advisory rather than
  failing, because `/Summary` is required by neither PDF/UA nor WCAG and flagging every
  table trains users to ignore the whole report.
- **The most common defect in the world has no available repair.** `A11Y-003` fires on
  every untagged document, and its only fix is autotagging, which needs marked-content
  writing and is `OPEN` on Spike A. Until that resolves, the report diagnoses and cannot
  fix. Stated in the report rather than discovered.

## Still unproven, beyond text editing

Two items from the original stub remain true and are recorded here so this draft does not
read as more settled than it is.

- **The fork's additions have not executed against a document.** The build environment is
  now proven: a from-source build of stock MuPDF 1.28.0 is byte-identical to Artifex's
  published artifact, and `mujs=yes` builds and links at a cost of 240,327 bytes
  ([ADR 0004](adr/0004-fork-the-mupdf-wasm-build.md)). What that establishes is that the
  build is correct and that any future byte difference is our patch. It does **not**
  establish that `js_processor`, `pdf_filter_page_contents`, or the custom
  `pdf_pkcs7_signer` work, and it does not establish that `doc.isJSSupported()` returns
  true at runtime, because no build has been loaded in a browser. Features depending on
  them are designed, not proven.
- **Real-document behaviour under the ceilings is unmeasured.** A 2,000-page scan, a
  heavily tagged government form, and a 400 MB drawing have not been run, and the point
  where iOS Safari kills the tab has not been located
  ([ADR 0014](adr/0014-resource-ceilings.md)).

Neither blocks the inventory below, because neither changes _what_ the product does, only
whether a given item is reachable on schedule.

## Fixed, and not renegotiable by this specification

- Zero egress, with the gates and their stated limits
  ([ADR 0002](adr/0002-client-side-only-zero-egress.md)).
- AGPL-3.0-only ([ADR 0003](adr/0003-mupdf-as-the-engine-and-agpl.md)).
- Chrome 95, Firefox 131, Safari 15.2 desktop; iOS under a reduced budget
  ([ADR 0013](adr/0013-supported-browser-matrix.md)).
- The ceilings in `lib/core/limits.ts` ([ADR 0014](adr/0014-resource-ceilings.md)).
- WCAG 2.2 AA chrome and no positioned DOM text
  ([ADR 0015](adr/0015-accessibility-and-no-positioned-dom-text.md)).
- Acceptance by pdf.js and qpdf, never by MuPDF
  ([ADR 0019](adr/0019-correctness-oracles.md)).
- Basic and certification signatures only
  ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md)).

## Traceability

Every item in [`spec/parity-inventory.md`](spec/parity-inventory.md) carries a stable
identifier (`VIEW-001`, `SIGN-024`). The identifier is the join key between this
specification and everything downstream.

- A plan or pull request implementing a feature **cites its identifier**.
- A test verifying a feature **names its identifier**, so the evidence for a checked box is
  findable.
- A pipeline step maps to the identifier of the operation it runs.
- Identifiers are assigned once. They are never reused and never renumbered. A withdrawn
  feature keeps its identifier, marked withdrawn, so an old reference never silently
  resolves to something else.

A box is checked only when the feature ships **at the label it carries** and the acceptance
criteria below are satisfied for it. Checking a box for a `DEGRADED` feature without its
in-product disclosure, or for an `OPEN` feature at all, is the same overclaim this document
is structured to prevent.

## Acceptance criteria

Every criterion is marked with how it is checked. **`exec`** is an executable gate that
fails CI. **`review`** is a human judgment recorded in the pull request, because no
automated check covers it. Calling a `review` item `exec` would be the same category of
overclaim this specification is structured to prevent.

### Correctness

| #   | Criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Check                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Every document the product writes is structurally valid per qpdf, including after an incremental save                                                                                                                                                                                                                                                                                                                                                             | `exec`, over the test corpus. "Every document" means every document a test produces, not every document a user could ever produce.                                                                                                                                                                                                        |
| C2  | Every document the product writes parses and renders in pdf.js                                                                                                                                                                                                                                                                                                                                                                                                    | `exec`, same corpus scope as C1.                                                                                                                                                                                                                                                                                                          |
| C3  | No acceptance assertion reads our own output back through MuPDF                                                                                                                                                                                                                                                                                                                                                                                                   | `exec`, by a lint rule over the test tree                                                                                                                                                                                                                                                                                                 |
| C4  | A save specified to change nothing produces an **equivalent** document, defined as: identical page count; per page, identical extracted text (`stext` order and content) and identical rendered raster within the C8 tolerance; identical annotation set by subtype, rect and contents; identical form field names and values; and identical outline structure. Byte equality is explicitly **not** required, because any save rewrites the cross-reference table | `exec`. The definition is enumerated so an implementer cannot satisfy it by comparing page counts alone.                                                                                                                                                                                                                                  |
| C5  | An operation that fails leaves the document byte-identical to its pre-operation state                                                                                                                                                                                                                                                                                                                                                                             | `exec` for failures a test can inject. A WASM trap kills the instance, so the guarantee there is that the on-disk document is untouched, not that the in-memory one is recoverable.                                                                                                                                                       |
| C6  | Existing signatures still validate, outside our stack, after an unrelated incremental save                                                                                                                                                                                                                                                                                                                                                                        | `exec`, but **not in the browser**. This gate runs in Node in CI and shells out to an external verifier, because chain validation needs a PKI stack and a trust store the browser does not expose to us. The shipped product's own validation is `SIGN-010`, which is `DEGRADED` for exactly this reason. See also the C7 conflict below. |
| C7  | **Applying a redaction forces a full, non-incremental rewrite**, and the redacted content is absent from the resulting file's bytes: every stream in the output is decompressed and then searched for the redacted string and for the redacted image's bytes                                                                                                                                                                                                      | `exec`. Three parts are load-bearing and none may be dropped. See the note below.                                                                                                                                                                                                                                                         |
| C8  | Rendered output matches pdf.js within a stated per-page tolerance across the corpus                                                                                                                                                                                                                                                                                                                                                                               | `exec`. The tolerance is set once the two renderers have been compared on the corpus; a tolerance chosen before measurement would be a number invented to pass.                                                                                                                                                                           |

#### C7 and C6 cannot both hold on the same save

Stated here rather than left for someone to discover.

**An incremental save appends.** The original objects remain physically present in an
earlier revision of the same file. `qpdf` and `pdf.js` both parse the latest
cross-reference table, so an oracle-extraction test reports "no trace" while the redacted
text is still sitting in the bytes, recoverable with a hex editor. An implementer could
pass a naive C7 completely legitimately and ship a product that leaks every redaction.

That is why C7 has three parts, and why none may be dropped:

1. **Full rewrite.** Applying a redaction forces a non-incremental save. There is no
   configuration in which a redaction is written incrementally.
2. **Decompress, then search.** The test decompresses every stream before searching.
   A raw byte grep over the file misses FLATE-compressed content streams, which is how
   content is stored in practice, so a grep-only test passes vacuously. This is the same
   class of false green as the oracle-extraction version it replaces.
3. **Search the whole file**, not the extractable content, so an object stranded outside
   the current cross-reference table is still caught.

**The conflict.** C6 requires existing signatures to survive an incremental save. C7
requires a redaction to force a full rewrite. A full rewrite invalidates every existing
signature, because the bytes those signatures covered no longer exist. So on a document
that is both signed and being redacted, **the two criteria cannot both be satisfied, and
redaction wins.**

This is correct rather than unfortunate. A signature attests to content; removing content
must break it. Acrobat behaves the same way. The product must therefore warn before
redacting a signed document, state that existing signatures will be invalidated, and
require confirmation. Silently invalidating a signature, or silently declining to redact
in order to preserve one, would both be worse than the warning.

**Honest limit, retained.** This proves the content is absent from the bytes we ship. It
is not a proof of unrecoverability against every technique, and the product does not claim
one.

### Resources and stability

| #   | Criterion                                                                                                                                                                                                                                                                                                                          | Check                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Every ceiling in `lib/core/limits.ts` rejects at the boundary with its documented `LimitCode`                                                                                                                                                                                                                                      | `exec`                                                                                                                                                                                                         |
| R2  | A rejection happens before any mutation                                                                                                                                                                                                                                                                                            | `exec`                                                                                                                                                                                                         |
| R3  | **Intra-session** heap stability: a repeated sequence of symmetric operations against an open document (render a tile then destroy it, add a page then undo, open a structured-text handle then release it) returns the engine heap to its pre-sequence baseline within a stated tolerance, with no upward trend across iterations | `exec`, against MuPDF's reported heap. This is the criterion that matters: the failure that kills the product is a few MB leaked per edit across a multi-hour session, crossing 2 GiB and trapping.            |
| R4  | A document worker killed mid-request rejects its in-flight promises and leaves other documents working                                                                                                                                                                                                                             | `exec`                                                                                                                                                                                                         |
| R5  | A fuzzed corpus produces contained failures, never a stuck UI                                                                                                                                                                                                                                                                      | `exec`. Proves containment over the corpus that was run, not absence of a crashing input.                                                                                                                      |
| R6  | No single `toPixmap()` call exceeds `maxRenderPixels`                                                                                                                                                                                                                                                                              | `exec`                                                                                                                                                                                                         |
| R7  | Scrolling a heavy 500-page document holds its frame budget on reference hardware                                                                                                                                                                                                                                                   | `review`, until a stable perf harness exists                                                                                                                                                                   |
| R8  | iOS Safari survives the `IOS_BUDGET` ceilings on a real device                                                                                                                                                                                                                                                                     | `review`, no automated iOS coverage                                                                                                                                                                            |
| R9  | Close-time heap return: rendering a document end to end and closing it returns the engine heap to its starting level within a stated tolerance                                                                                                                                                                                     | `exec`. Retained from the original R3, but it is the weaker of the two: destroying the whole context on close satisfies it trivially while saying nothing about a session-long leak. R3 is the one with teeth. |

### Privacy

| #   | Criterion                                                                                                                                  | Check                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | No third-party URL in shipped output                                                                                                       | `exec` (`check:egress`)                                                                                                                                                                                                                   |
| P2  | No foreign-origin request while the app runs                                                                                               | `exec` (E2E)                                                                                                                                                                                                                              |
| P3  | The CSP in `web/index.html` is unchanged                                                                                                   | `exec`                                                                                                                                                                                                                                    |
| P4  | No serverless function, edge middleware, or same-origin endpoint that could receive a document                                             | `review`, and stated as such in ADR 0002                                                                                                                                                                                                  |
| P5  | OPFS entries are evicted when a document closes, **and a startup sweep garbage-collects entries orphaned by a previously crashed session** | `exec`, both clauses. The sweep is not optional tidying: a WASM trap is uncatchable and there is no `FinalizationRegistry`, so the close-time path provably does not run in the one case where entries are most likely to be left behind. |

### Accessibility

| #   | Criterion                                                                                             | Check                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Every command in the palette is invocable by keyboard alone                                           | `exec`, driven from the command registry so the test enumerates commands rather than hard-coding a list.                                         |
| A2  | Landmarks, skip link, and a single `h1` are present                                                   | `exec`                                                                                                                                           |
| A3  | The hidden reading-order element follows the structure tree where one exists                          | `exec` against fixtures with a known-correct expected order. Whether the order is right for an arbitrary real document is A8, which is `review`. |
| A4  | `--row-height` resolves differently in each density                                                   | `exec`                                                                                                                                           |
| A5  | Every semantic token pair used as foreground on background meets WCAG 2.2 AA contrast, in both themes | `exec`, at the token level. Whether components actually pair tokens that way is `review`.                                                        |
| A6  | `touch` density resolves `--control-height` at or above the WCAG 2.2 target-size minimum              | `exec`, at the token level. Whether each rendered control honours it is `review`.                                                                |
| A7  | Reduced motion and forced colors behave correctly                                                     | `review`, driven not inferred                                                                                                                    |
| A8  | A screen reader reads a two-column page in logical order                                              | `review`                                                                                                                                         |
| A9  | Reflow at 200% zoom and 320 px loses no function                                                      | `review`                                                                                                                                         |

### Honesty

| #   | Criterion                                                                     | Check                      |
| --- | ----------------------------------------------------------------------------- | -------------------------- |
| H1  | Every `DEGRADED` feature carries an in-product disclosure at the point of use | `review`                   |
| H2  | Every `EXCLUDED` feature has a named answer where a user would look for it    | `review`                   |
| H3  | No shipped copy describes an `OPEN` or unbuilt capability as available        | `review`                   |
| H4  | The path a text edit took is surfaced to the user                             | `review`                   |
| H5  | This specification matches what shipped                                       | `review`, at every release |
