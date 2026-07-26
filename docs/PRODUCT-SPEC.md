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
  workflow by definition. Note the asymmetry that matters: we can _sign_ a document
  ([ADR 0018](adr/0018-signing-via-custom-signer-vtable.md)); we cannot _ask someone else
  to_.
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

All ten `OPEN` items depend on the same mechanism, content-stream rewriting, and so on the
same two spikes below. That is not only text: editing an existing image, and the
resource-rewriting half of optimization, go through the same filter and carry the same
risk.

## Open: text-editing depth

Two spikes decide the entire shape of text editing. Neither has run. The outcome is not
guessed here.

### Spike A: the null filter

Run `pdf_filter_page_contents` with a pass-through filter specified to change nothing,
across a real corpus, and compare before and after with the independent oracles
([ADR 0019](adr/0019-correctness-oracles.md)).

This is the cheapest possible question with the largest possible consequence. **If a filter
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

### Spike B: the encoding-inversion hit rate

Given content-stream rewriting is viable, the second question is how much of a real corpus
can be edited **in place, reusing the embedded font** (Path A in
[ADR 0012](adr/0012-content-stream-text-editing.md)) rather than by embedding a new subset
(Path B).

This is measured, not estimated, across a corpus spanning producers, font types, CID and
simple fonts, and subsetted and full embeddings. No library in any language performs this
inversion, so there is no prior art to borrow a number from.

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

| #   | Criterion                                                                                                                              | Check                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Every document the product writes is structurally valid per qpdf, including after an incremental save                                  | `exec`, over the test corpus. "Every document" means every document a test produces, not every document a user could ever produce.                                                  |
| C2  | Every document the product writes parses and renders in pdf.js                                                                         | `exec`, same corpus scope as C1.                                                                                                                                                    |
| C3  | No acceptance assertion reads our own output back through MuPDF                                                                        | `exec`, by a lint rule over the test tree                                                                                                                                           |
| C4  | A save specified to change nothing produces a document the oracles find equivalent                                                     | `exec`                                                                                                                                                                              |
| C5  | An operation that fails leaves the document byte-identical to its pre-operation state                                                  | `exec` for failures a test can inject. A WASM trap kills the instance, so the guarantee there is that the on-disk document is untouched, not that the in-memory one is recoverable. |
| C6  | Existing signatures still validate, outside our stack, after an unrelated incremental save                                             | `exec`                                                                                                                                                                              |
| C7  | Redaction removes the content from the content stream: text and image extraction from the saved bytes, by both oracles, finds no trace | `exec`. Honest limit: this proves absence from what the oracles reach, not unrecoverability against every technique.                                                                |
| C8  | Rendered output matches pdf.js within a stated per-page tolerance across the corpus                                                    | `exec`. The tolerance is set once the two renderers have been compared on the corpus; a tolerance chosen before measurement would be a number invented to pass.                     |

### Resources and stability

| #   | Criterion                                                                                                              | Check                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Every ceiling in `lib/core/limits.ts` rejects at the boundary with its documented `LimitCode`                          | `exec`                                                                                                                                                             |
| R2  | A rejection happens before any mutation                                                                                | `exec`                                                                                                                                                             |
| R3  | Rendering a document end to end and closing it returns the engine heap to its starting level within a stated tolerance | `exec`, against MuPDF's reported heap. Allocator fragmentation means exact return is not expected, which is why the criterion says tolerance rather than equality. |
| R4  | A document worker killed mid-request rejects its in-flight promises and leaves other documents working                 | `exec`                                                                                                                                                             |
| R5  | A fuzzed corpus produces contained failures, never a stuck UI                                                          | `exec`. Proves containment over the corpus that was run, not absence of a crashing input.                                                                          |
| R6  | No single `toPixmap()` call exceeds `maxRenderPixels`                                                                  | `exec`                                                                                                                                                             |
| R7  | Scrolling a heavy 500-page document holds its frame budget on reference hardware                                       | `review`, until a stable perf harness exists                                                                                                                       |
| R8  | iOS Safari survives the `IOS_BUDGET` ceilings on a real device                                                         | `review`, no automated iOS coverage                                                                                                                                |

### Privacy

| #   | Criterion                                                                                      | Check                                                                                                |
| --- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P1  | No third-party URL in shipped output                                                           | `exec` (`check:egress`)                                                                              |
| P2  | No foreign-origin request while the app runs                                                   | `exec` (E2E)                                                                                         |
| P3  | The CSP in `web/index.html` is unchanged                                                       | `exec`                                                                                               |
| P4  | No serverless function, edge middleware, or same-origin endpoint that could receive a document | `review`, and stated as such in ADR 0002                                                             |
| P5  | OPFS entries are evicted when a document closes, and are clearable by the user                 | `exec`. Browser-initiated eviction under storage pressure is outside our control and is not claimed. |

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
