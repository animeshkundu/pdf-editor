# Parity inventory

Every feature, organised by Acrobat's own categories, each carrying one of the five labels
defined in [`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#the-classification-and-why-it-exists):

| Label      | Meaning                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `LOCAL`    | Exact local parity. Same mechanism, same result, on the device.             |
| `EQUIV`    | Same outcome, different mechanism. Documented, and often better.            |
| `DEGRADED` | Materially weaker than Acrobat's. Ships only with an in-product disclosure. |
| `EXCLUDED` | Impossible without a server, or absent from the engine. Named, not hidden.  |
| `OPEN`     | Blocked on a spike. The spike is named.                                     |

Each item carries a **stable identifier** (`VIEW-001`, `SIGN-024`) and a checkbox. The
identifier is the join key: it is what a plan, a pull request, a test name, or a pipeline
step cites when it claims to implement or verify a feature. Identifiers are assigned once
and never reused or renumbered. A feature that is removed keeps its identifier, marked
withdrawn, so an old reference never silently resolves to a different feature.

Prefixes match the section numbers below: `VIEW`, `FIND`, `MARK`, `CMNT`, `EDIT`, `PAGE`,
`FORM`, `SIGN`, `CONV`, `CMPR`, `A11Y`, `PRNT`, `AUTO`.

A checked box means the feature ships **at the label it carries**, verified against the
acceptance criteria in [`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#acceptance-criteria). It
does not mean code exists.

Acrobat behaviour described here is from Adobe's published documentation and from ordinary
use of the product. Items where the exact Acrobat behaviour was not verified directly are
marked **(unverified)**. Nothing in this document is a benchmark or a measurement.

---

## 1. Viewing and navigation

### Page layout

- [ ] `VIEW-001` **Single page** `LOCAL`
- [ ] `VIEW-002` **Single page continuous** `LOCAL`, the default
- [ ] `VIEW-003` **Two-page view** `LOCAL`
- [ ] `VIEW-004` **Two-page continuous** `LOCAL`
- [ ] `VIEW-005` **Show cover page in two-page view** `LOCAL`. Without it, a document with a cover
      pairs every spread wrongly, which is the single most common complaint about two-up
      viewers.
- [ ] `VIEW-006` **Right-to-left page order** `LOCAL`, honouring the document's own reading direction
      where declared rather than a global preference.

### Zoom

- [ ] `VIEW-007` **Zoom in, zoom out, and a zoom percentage field** `LOCAL`
- [ ] `VIEW-008` **Fit page, fit width, fit visible** `LOCAL`. "Fit visible" fits the page's content
      rather than its media box, which is what makes a scanned page with wide margins
      usable.
- [ ] `VIEW-009` **Zoom to selection (marquee zoom)** `LOCAL`
- [ ] `VIEW-010` **Dynamic zoom** (drag to scale continuously) `LOCAL`
- [ ] `VIEW-011` **Actual size (100%)** `LOCAL`, calibrated against the device pixel ratio so 100%
      means physical size, not CSS pixels.
- [ ] `VIEW-012` **Pan and Zoom window** `LOCAL`
- [ ] `VIEW-013` **Loupe** `LOCAL`
- [ ] `VIEW-014` **Zoom follows the pointer, not the viewport centre** `LOCAL`. Acrobat's zoom
      anchoring is inconsistent between mechanisms (unverified which are intended); ours
      anchors on the pointer for wheel and pinch, and on the viewport centre for keyboard.

### Rotation and view modes

- [ ] `VIEW-015` **Rotate view clockwise and counter-clockwise** `LOCAL`. View-only, distinct from
      the document rotation in Organize Pages, and clearly labelled as such: conflating
      the two is a classic source of "my rotation did not save".
- [ ] `VIEW-016` **Full screen** `LOCAL`
- [ ] `VIEW-017` **Read mode** `LOCAL`, chrome collapses to a floating minimal bar.
- [ ] `VIEW-018` **Reflow** `LOCAL` where the document is tagged, refused with an explanation where
      it is not. Reflow on an untagged document produces scrambled output in every tool
      that attempts it, so refusing is the better behaviour.
- [ ] `VIEW-019` **Night-reading view mode** `LOCAL`, and explicitly opt-in. `--page-paper` is never
      tinted by the dark theme ([ADR 0016](../adr/0016-density-aware-design-tokens.md)),
      so a user always knows whether they are seeing the document or a transform of it.

### Navigation panels

- [ ] `VIEW-020` **Page thumbnails**, virtualized, with drag to reorder `LOCAL`
- [ ] `VIEW-021` **Bookmarks (outline)**, including nesting, expand and collapse, and jump to
      destination `LOCAL`
- [ ] `VIEW-022` **Attachments panel**, list, open, save out, add, delete `LOCAL`. Attachment
      extraction is a known malware vector, so an attachment is never auto-opened and its
      declared type is never trusted over its bytes.
- [ ] `VIEW-023` **Layers (optional content groups)**, show, hide, and honour the document's default
      configuration `LOCAL`
- [ ] `VIEW-024` **Signatures panel** `LOCAL`, see [section 8](#8-sign-and-security).
- [ ] `VIEW-025` **Tags panel** `LOCAL`, see [section 11](#11-accessibility).
- [ ] `VIEW-026` **Destinations** `LOCAL`
- [ ] `VIEW-027` **Content panel** (the raw object tree) `LOCAL`

### Links and destinations

- [ ] `VIEW-028` **Follow internal links** `LOCAL`
- [ ] `VIEW-029` **Follow external links** `LOCAL`, with the target URL shown and confirmed before
      navigation. A PDF is an untrusted document and a link in one is an untrusted link.
- [ ] `VIEW-030` **Named destinations** `LOCAL`
- [ ] `VIEW-031` **Page labels** honoured throughout the UI `LOCAL`. A document whose front matter is
      numbered i, ii, iii shows those labels in the page field, the thumbnails, and the
      print range, not raw indices. Acrobat does this and most web viewers do not.
- [ ] `VIEW-032` **Navigation history**, previous and next view `LOCAL`. Distinct from browser
      history: it tracks view changes within the document.
- [ ] `VIEW-033` **Go to page**, accepting either a page label or an index `LOCAL`

### Multi-document

- [ ] `VIEW-034` **Multiple documents open at once** `LOCAL`, one `doc.worker` each
      ([ADR 0008](../adr/0008-worker-topology-and-crash-isolation.md)).
- [ ] `VIEW-035` **Split view of two documents side by side** `LOCAL`
- [ ] `VIEW-036` **Recover a document after its worker crashes** `LOCAL`, from OPFS
      ([ADR 0017](../adr/0017-persistence-via-opfs.md)). Acrobat has no equivalent because
      it has no equivalent failure mode; this is a cost of the architecture paid back as a
      feature.
- [ ] `VIEW-037` **Save, Save As, and announced Download fallback** `EQUIV`. Chromium writes
      back to an opened File System Access handle and offers Save As. Browsers without that
      API label the action Download before invocation; OPFS crash insurance remains separate
      and never substitutes for explicit output
      ([ADR 0023](../adr/0023-save-command-and-file-system-access.md)).

---

## 2. Search and text selection

- [ ] `FIND-001` **Find in document** `EQUIV`. Ctrl+F is intercepted and routed to engine search.
      Better than the browser's native find, which could only ever see mounted pages;
      engine search covers the whole document
      ([ADR 0015](../adr/0015-accessibility-and-no-positioned-dom-text.md)).
- [ ] `FIND-002` **Find next and previous, with a match count and position** `LOCAL`
- [ ] `FIND-003` **Whole words only, case sensitive, include bookmarks, include comments** `LOCAL`
- [ ] `FIND-004` **Search across multiple open documents** `LOCAL`, in the shared read-only
      `search.worker`.
- [ ] `FIND-005` **Results list with surrounding context, grouped by page** `LOCAL`
- [ ] `FIND-006` **Text selection** `LOCAL`, from `stext` quads. No positioned DOM text; hit testing
      is arithmetic in document space.
- [ ] `FIND-007` **Word, line, and paragraph selection by multi-click** `LOCAL`
- [ ] `FIND-008` **Rectangular (column) selection** `LOCAL`. Essential for tables and two-column
      papers, where linear selection produces interleaved nonsense.
- [ ] `FIND-009` **Selection across pages** `LOCAL`
- [ ] `FIND-010` **Copy to clipboard** `EQUIV`, system clipboard only. Ligatures are decomposed and
      soft hyphens dropped so that pasted text is what the page reads, not what the glyph
      stream contains.
- [ ] `FIND-011` **Copy as table** where the selection covers a tagged table `LOCAL`
- [ ] `FIND-012` **Snapshot (copy a region as an image)** `LOCAL`
- [ ] `FIND-013` **Contextual action bar on selection** `LOCAL`, see
      [`competitor-wins.md`](competitor-wins.md#edge-the-selection-action-bar).
- [ ] `FIND-014` **Copy prevented when the document's permissions forbid it** `LOCAL`, with the
      restriction stated plainly rather than the control silently doing nothing.

---

## 3. Comment and markup

Every annotation is a real PDF annotation, written to the document, interoperable with
Acrobat. None of these is a private overlay format.

### Text markup

- [ ] `MARK-001` **Sticky note** (`Text`) `LOCAL`
- [ ] `MARK-002` **Highlight** (`Highlight`) `LOCAL`
- [ ] `MARK-003` **Underline** (`Underline`) `LOCAL`
- [ ] `MARK-004` **Strikethrough** (`StrikeOut`) `LOCAL`
- [ ] `MARK-005` **Squiggly underline** (`Squiggly`) `LOCAL`
- [ ] `MARK-006` **Insert text at cursor** (`Caret`) `LOCAL`
- [ ] `MARK-007` **Replace text** (`StrikeOut` plus `Caret`) `LOCAL`

### Drawing and shapes

- [ ] `MARK-008` **Text box** (`FreeText`) `LOCAL`
- [ ] `MARK-009` **Callout** (`FreeText` with a callout line) `LOCAL`
- [ ] `MARK-010` **Line** (`Line`) `LOCAL`
- [ ] `MARK-011` **Arrow** (`Line` with endings) `LOCAL`
- [ ] `MARK-012` **Rectangle** (`Square`) `LOCAL`
- [ ] `MARK-013` **Oval** (`Circle`) `LOCAL`
- [ ] `MARK-014` **Polygon** (`Polygon`) `LOCAL`
- [ ] `MARK-015` **Connected lines** (`PolyLine`) `LOCAL`
- [ ] `MARK-016` **Cloud** (`Polygon` with a cloudy border effect) `LOCAL`
- [ ] `MARK-017` **Pencil** (`Ink`) `LOCAL`, pressure-aware where the pointer reports it.
- [ ] `MARK-018` **Pencil eraser** `LOCAL`, erasing ink strokes rather than painting white.

### Content annotations

- [ ] `MARK-019` **Stamp**, from a built-in set `LOCAL`
- [ ] `MARK-020` **Custom stamp from an image or a PDF page** `LOCAL`
- [ ] `MARK-021` **Dynamic stamps** carrying name, date, and time `LOCAL`
- [ ] `MARK-022` **Attach a file as a comment** (`FileAttachment`) `LOCAL`
- [ ] `MARK-023` **Record audio comment** (`Sound`) `EXCLUDED`. Not a server issue: the `Sound`
      annotation is deprecated in PDF 2.0 and support across viewers is poor enough that
      shipping it would create documents most readers cannot play. Attaching an audio file
      as a `FileAttachment` covers the need.
- [ ] `MARK-024` **Paste an image as a stamp from the clipboard** `LOCAL`

### Measuring

- [ ] `MARK-025` **Distance** `LOCAL`
- [ ] `MARK-026` **Perimeter** `LOCAL`
- [ ] `MARK-027` **Area** `LOCAL`
- [ ] `MARK-028` **Measurement scale and units, read from the document where declared** `LOCAL`
- [ ] `MARK-029` **Snap to paths, endpoints, midpoints, and intersections** `LOCAL`. This is what
      makes measuring usable on a drawing rather than a novelty.

### Annotation properties

- [ ] `MARK-030` **Colour, opacity, line weight, line style, and endings** `LOCAL`
- [ ] `MARK-031` **Font, size, and alignment for `FreeText`** `LOCAL`
- [ ] `MARK-032` **Author and subject** `LOCAL`
- [ ] `MARK-033` **Set as default for the tool** `LOCAL`
- [ ] `MARK-034` **Locked and read-only flags** `LOCAL`
- [ ] `MARK-035` **Appearance stream regenerated on change** `LOCAL`. An annotation whose appearance
      stream disagrees with its properties renders differently in every viewer, which is
      the most common annotation interoperability bug.

---

## 4. Comment management

- [ ] `CMNT-001` **Comments list** `LOCAL`, and specifically as a **sortable, filterable data table**
      rather than a flat list. See
      [`competitor-wins.md`](competitor-wins.md#bluebeam-markups-as-a-data-table).
- [ ] `CMNT-002` **Filter by type, author, status, colour, page, and date** `LOCAL`
- [ ] `CMNT-003` **Sort by page, author, date, type, and status** `LOCAL`
- [ ] `CMNT-004` **Reply to a comment, with threading** `LOCAL`
- [ ] `CMNT-005` **Set status**: accepted, rejected, cancelled, completed, none `LOCAL`
- [ ] `CMNT-006` **Checkmark a comment** (a private per-user marker, not written as status) `LOCAL`
- [ ] `CMNT-007` **Comment summary**, as a printable document and as a data export `LOCAL`
- [ ] `CMNT-008` **Export comments to XFDF and FDF** `LOCAL`
- [ ] `CMNT-009` **Import comments from XFDF and FDF** `LOCAL`
- [ ] `CMNT-010` **Export comments to CSV** `LOCAL`, beyond Acrobat. See
      [`competitor-wins.md`](competitor-wins.md#bluebeam-markups-as-a-data-table).
- [ ] `CMNT-011` **Delete all comments** `LOCAL`
- [ ] `CMNT-012` **Migrate comments to a revised document** `EXCLUDED` in Acrobat's collaborative
      sense. The single-document mechanics could exist; the workflow it serves is shared
      review, which is server-bound.
- [ ] `CMNT-013` **Shared review, tracker, and comment sync** `EXCLUDED`

---

## 5. Edit content

Spike A is red. [ADR 0020](../adr/0020-content-stream-rewriting-failed-stage-one.md)
supersedes the in-place rewrite design; the labels below record the disclosed overlay
fallbacks and the capabilities withdrawn with that path.

### Text

- [x] `EDIT-001` **Edit existing text in place** `DEGRADED`. A byte-length-preserving,
      uniquely occurring printable-ASCII `Tj` run is replaced directly through the byte-span
      splicer in ADR 0029, preserving every byte outside the verified span. Other supported
      inputs use the earlier guarded overlay path: a unique, axis-aligned, single-font line
      can be replaced with printable ASCII
      when no Form XObject, marked-content dictionary, metadata copy, redaction mark, or
      overlapping annotation makes the operation ambiguous. MuPDF's redaction filter removes
      the selected glyphs and a standard Helvetica `FreeText` appearance carries the
      replacement. Before the journal commits, the worker verifies that only the selected
      structured-text characters disappeared, every pre-existing annotation is unchanged,
      and the replacement annotation has the exact contents, rectangle, and a non-empty
      appearance stream. Any mismatch rolls the whole operation back. pdf.js and qpdf grade
      the saved output; MuPDF's in-transaction checks are safety interlocks, not acceptance
      oracles. CJK, right-to-left, rotated, skewed, multiline, repeated, and non-fitting edits
      refuse before mutation. This replaces the earlier universal refusal without reviving
      the unsound `/ToUnicode` inversion that destroyed `cjk-itext.pdf`.
- [ ] `EDIT-002` **Reflow within a text block after an edit** `EXCLUDED` from the guarded
      replacement path. Reflow needs shaped text and a general content-stream writer; the
      current path preserves one line's original bounds and refuses a replacement that cannot
      fit at a readable size.
- [ ] `EDIT-003` **Change font, size, colour, spacing, and alignment of existing text**
      `DEGRADED`, on the disclosed overlay only.
- [ ] `EDIT-004` **Add a new text block** `LOCAL`. Adding text does not require inverting an existing
      font's encoding, so it is not blocked on either spike.
- [ ] `EDIT-005` **Delete a text run** `EXCLUDED`, withdrawn after Spike A red. Covering
      text is not deletion.
- [ ] `EDIT-006` **Surface which path an edit took** (in place, or with a new subset embedded)
      `LOCAL`, and required by acceptance criterion H4.

### Images and objects

- [ ] `EDIT-007` **Select, move, resize, and rotate an image** `EXCLUDED`, withdrawn after
      Spike A red.
- [ ] `EDIT-008` **Replace an image** `EXCLUDED`, withdrawn after Spike A red.
- [ ] `EDIT-009` **Delete an image** `EXCLUDED`, withdrawn after Spike A red.
- [ ] `EDIT-010` **Crop an image in place** `EXCLUDED`, withdrawn after Spike A red.
- [ ] `EDIT-011` **Extract an image to a file** `LOCAL`. Read-only, so no spike dependency.
- [ ] `EDIT-012` **Arrange: bring forward, send backward, align, distribute** `EXCLUDED`,
      withdrawn after Spike A red.
- [ ] `EDIT-013` **Add an image** `LOCAL`

### Document-level content

- [ ] `EDIT-014` **Add, update, and remove a header and footer**, with page numbering and date
      formats `LOCAL`
- [ ] `EDIT-015` **Add, update, and remove a watermark**, text or image, with opacity, rotation,
      position, and page range `LOCAL`
- [ ] `EDIT-016` **Add, update, and remove a background** `LOCAL`
- [ ] `EDIT-017` **Bates numbering**, add and remove, with prefix, suffix, and digit count, across a
      set of documents `LOCAL`
- [ ] `EDIT-018` **Add, edit, and delete links** `LOCAL`
- [ ] `EDIT-019` **Create links from URLs detected in the text** `LOCAL`
- [ ] `EDIT-020` **Create, rename, reorder, nest, and delete bookmarks** `LOCAL`
- [ ] `EDIT-021` **Generate bookmarks from the structure tree's headings** `LOCAL`. Reads
      structure via `stext`, and writes through the exported outline iterator
      (`wasm_outline_iterator_insert`), so unlike the tagging tools in section 11 this
      one needs no raw-dictionary work.
- [ ] `EDIT-022` **Edit document properties**: title, author, subject, keywords, and custom metadata
      `LOCAL`
- [ ] `EDIT-023` **Edit XMP metadata** `LOCAL`
- [ ] `EDIT-024` **Optimize: object deduplication and unused-object removal** `LOCAL`, via
      MuPDF's own garbage collection on save. Ships with a before-and-after size report
      that names which categories actually ran, and per-category control rather than a
      single slider.
      **Conflicts with `SIGN-009` and must handle it.** Garbage collection and
      deduplication renumber and rewrite objects, which requires a full save and therefore
      invalidates every existing byte-range signature. On a signed document this operation
      detects the signatures and either refuses, or warns and writes a separately named
      unsigned output. It never silently invalidates a signature. Same conflict, same
      resolution, as
      [C7 and C6](../PRODUCT-SPEC.md#c7-and-c6-cannot-both-hold-on-the-same-save).
- [ ] `EDIT-025` **Optimize: image downsampling and recompression, and font subsetting**
      `EXCLUDED`, withdrawn after Spike A red. Both rewrite the page's resources and the
      content stream that references them. Split from `EDIT-024` so the safe
      garbage-collection half does not carry the withdrawn rewrite half.

**Adding** any of the above is independent of the content-stream spikes. **Updating or
removing** one is not, and the earlier blanket claim that "these document-level items are
all additive or annotation-based" was simply false: `EDIT-014` through `EDIT-017` write
page content rather than annotations, and changing or removing a header, watermark,
background or Bates number means identifying existing content and rewriting it. `EDIT-025`
sitting `OPEN` in this same section should have made that obvious.

The resolution is a scope split, not a spike dependency:

- **Artifacts this application created** carry durable private metadata identifying them,
  so update and remove locate their own output exactly and rewrite only what they wrote.
  That is `LOCAL`, and it is what the items above promise.
- **Updating or removing an artifact some other producer created** requires finding
  arbitrary content by inference and rewriting it, which is Spike A work with Spike A's
  risk. It is not promised. The UI says it cannot find a header it did not write, rather
  than removing something that looks like one and damaging the page.

---

## 6. Organize pages

- [ ] `PAGE-001` **Reorder by drag in the thumbnail view** `LOCAL`
- [ ] `PAGE-002` **Insert pages from another file** `LOCAL`
- [ ] `PAGE-003` **Insert a blank page** `LOCAL`
- [ ] `PAGE-004` **Insert from the clipboard** `LOCAL`
- [ ] `PAGE-005` **Extract pages** (as a new document, optionally deleting the originals) `LOCAL`
- [ ] `PAGE-006` **Drag pages out to extract** `LOCAL`, beyond Acrobat. See
      [`competitor-wins.md`](competitor-wins.md#preview-drag-to-extract-and-drag-to-merge).
- [ ] `PAGE-007` **Drag pages between two open documents to merge** `LOCAL`, likewise.
- [ ] `PAGE-008` **Replace pages** `LOCAL`
- [ ] `PAGE-009` **Delete pages** `LOCAL`
- [ ] `PAGE-010` **Rotate pages** (written to the document, distinct from rotating the view) `LOCAL`
- [ ] `PAGE-011` **Crop pages** `LOCAL`, editing the media, crop, bleed, trim, and art boxes
      individually rather than only "the crop".
- [ ] `PAGE-012` **Split by page count, by top-level bookmark, or by file size** `LOCAL`
- [ ] `PAGE-013` **Split by text** `LOCAL`, beyond Acrobat. See
      [`competitor-wins.md`](competitor-wins.md#sejda-split-by-text-split-in-half-and-alternate-and-mix).
- [ ] `PAGE-014` **Split in half** `LOCAL`, likewise.
- [ ] `PAGE-015` **Alternate and mix two documents** `LOCAL`, likewise.
- [ ] `PAGE-016` **Merge documents**, with per-file page ranges and a preview of the result `LOCAL`
- [ ] `PAGE-017` **Edit page labels**, per range, with style and start number `LOCAL`
- [ ] `PAGE-018` **Reverse page order** `LOCAL`
- [ ] `PAGE-019` **Duplicate pages** `LOCAL`
- [ ] `PAGE-020` **Undo any of the above** `LOCAL`, on MuPDF's journal
      ([ADR 0011](../adr/0011-undo-on-the-mupdf-journal.md)).

Page operations move whole page objects rather than rewriting content streams, so this
whole section is independent of the text-editing spikes. It is the largest block of
unambiguous parity in the product.

---

## 7. Forms

### Field types

- [ ] `FORM-001` **Text field**, including multiline, password, and comb `LOCAL`
- [ ] `FORM-002` **Check box** `LOCAL`
- [ ] `FORM-003` **Radio button**, including grouping `LOCAL`
- [ ] `FORM-004` **Dropdown (combo box)**, editable and fixed `LOCAL`
- [ ] `FORM-005` **List box**, single and multiple selection `LOCAL`
- [ ] `FORM-006` **Button**, with icon and label layouts `LOCAL`
- [ ] `FORM-007` **Digital signature field** `LOCAL`
- [ ] `FORM-008` **Barcode field** `EXCLUDED`. The built engine exposes no verified barcode
      authoring surface and no independently decodable encoder is bundled. A field that only
      this writer could interpret would not be interoperable
      ([finding](../research/2026-08-01-form-capabilities.md)).

### Filling

- [x] `FORM-009` **Fill every field type** `DEGRADED`. Saved scalar values for text, checkbox,
      radio, combo, and single-select list fields can be entered from the field
      list, but page-widget click targeting is not wired to the editor.
- [x] `FORM-010` **Tab between fields in tab order** `DEGRADED`. The authored PDF tab order and
      keyboard-accessible field list follow the same sequence, but page-coordinate hit testing
      is not wired and no positioned DOM inputs are introduced.
- [x] `FORM-011` **Highlight fields**, with a toggle `DEGRADED`. The toggle highlights rows in the
      field list; page-widget highlighting is not available.
- [x] `FORM-012` **Required-field indication and validation on submit** `DEGRADED`. Required fields
      are indicated and list-entered values can be checked, but there is no interactive page submit
      flow.
- [ ] `FORM-013` **Auto-complete from previous entries** `OPEN`. The opt-in, clearable,
      document-scoped history kernel exists, but the current port exposes no stable document
      identity and the product stores no entries rather than risk crossing document boundaries.
      Spike: add an opaque content fingerprint to `DocumentInfo`, then prove history remains
      isolated across two same-named PDFs. This is ordinary client-side work, not permanently
      excluded ([finding](../research/2026-08-01-form-capabilities.md)).
- [ ] `FORM-014` **Reset form** `LOCAL`
- [ ] `FORM-015` **Save a partially filled form and resume** `LOCAL`

### Authoring

- [ ] `FORM-016` **Add, move, resize, align, and distribute fields** `LOCAL`
- [ ] `FORM-017` **Field properties**: general, appearance, options, and actions `LOCAL`
- [ ] `FORM-018` **Format**: number, percentage, date, time, special, and custom `LOCAL`
- [ ] `FORM-019` **Validate**, by range or by script `LOCAL`
- [ ] `FORM-020` **Calculate**: sum, product, average, minimum, maximum, and simplified field
      notation `LOCAL`
- [x] `FORM-021` **Custom JavaScript for format, validate, calculate, and keystroke** `LOCAL`, via
      `mujs=yes` in the fork ([ADR 0004](../adr/0004-fork-the-mupdf-wasm-build.md)).
      Real-world government and enterprise forms depend on these, and a form that silently
      does not calculate is worse than one that refuses to open.
- [ ] `FORM-022` **Set and edit tab order**, including a visual order view `LOCAL`
- [ ] `FORM-023` **Auto-detect fields on an unstructured document** `OPEN`. A proposal-only
      heuristic has a labelled kernel fixture, but the engine port does not expose page text
      geometry needed to scan a real unstructured document. No detection result is claimed or
      applied. Spike: expose bounded text-line geometry through the engine port and measure the
      existing proposal kernel against labelled real-page fixtures. This is ordinary client-side
      work, not permanently excluded ([finding](../research/2026-08-01-form-capabilities.md)).
- [ ] `FORM-024` **Duplicate a field across pages** `LOCAL`

### Data

- [ ] `FORM-025` **Export form data to FDF, XFDF, XML, and CSV** `LOCAL`
- [ ] `FORM-026` **Import form data from FDF, XFDF, XML, and CSV** `LOCAL`
- [ ] `FORM-027` **Merge a data set into a form to produce many filled documents** `LOCAL`
- [ ] `FORM-028` **Flatten fields into page content** `LOCAL`
- [ ] `FORM-029` **Submit form to a URL** `EXCLUDED`. The document's own submit action targets a
      remote endpoint. Rather than silently doing nothing, a submit action is detected, the
      target URL is shown, and the user is offered the exported data file so they can
      submit it themselves.
- [ ] `FORM-030` **XFA forms** `EXCLUDED`. MuPDF has never implemented XFA. Detected on open and
      refused by name.

---

## 8. Sign and security

### Fill and Sign

- [ ] `SIGN-001` **Add free text anywhere** `LOCAL`
- [ ] `SIGN-002` **Checkmark, cross, dot, line, and rectangle marks** `LOCAL`
- [ ] `SIGN-003` **Draw, type, or import a signature and initials** `LOCAL`
- [ ] `SIGN-004` **Save signatures for reuse** `LOCAL`, in OPFS, never transmitted.

### Digital signatures

- [ ] `SIGN-005` **Sign with a certificate** `OPEN`, **Spike C (the synchronous signer
      bridge)**. `pdf_pkcs7_signer.create_digest` is synchronous: it returns `int` and
      writes into a caller-supplied buffer (`include/mupdf/pdf/form.h:226`). WebCrypto's
      `SubtleCrypto` is asynchronous, and the engine is single-threaded WASM with no way
      to await a promise inside a synchronous C callback. The whole design in
      [ADR 0018](../adr/0018-signing-via-custom-signer-vtable.md) rests on a bridge that
      has not been shown to exist. Spike C must demonstrate the bridge, `/Contents`
      placeholder sizing, correct incremental output, and both RSA and ECDSA, before any
      signing item can carry a shipped label. Was `LOCAL`, through the custom
      `pdf_pkcs7_signer` vtable
      with WebCrypto and PKI.js
      ([ADR 0018](../adr/0018-signing-via-custom-signer-vtable.md)).
- [ ] `SIGN-006` **Certify (DocMDP), visible and invisible** `OPEN`, Spike C. Inherits
      the synchronous-bridge dependency from `SIGN-005`.
- [ ] `SIGN-007` **Signature appearance**: name, date, reason, location, and logo `LOCAL`
      for composing and previewing the appearance stream, which is ordinary annotation
      work. Producing it as part of a real signature is `OPEN` on Spike C with
      `SIGN-005`.
- [ ] `SIGN-008` **Sign an existing signature field** `OPEN`, Spike C. Inherits from
      `SIGN-005`.
- [ ] `SIGN-009` **Incremental save preserves the byte ranges existing signatures cover**
      `LOCAL`. Stated as the mechanical fact rather than as "signatures stay valid",
      which is not something a save can promise: a later revision can violate DocMDP or a
      field lock, and a validator will then correctly report a disallowed change. The
      guarantee is that we do not rewrite the signed bytes; whether the resulting document
      still satisfies its own policy is a question for `SIGN-010`.
- [ ] `SIGN-010` **Validate signatures** `OPEN`, **Spike D (the verifier bridge)**. Was
      `DEGRADED`, which was wrong: `DEGRADED` means shipped but weaker, and a verifier that
      does not exist is an unimplemented feature. The WASM shim exports no verification
      surface at all. `pdf_check_digest` and `pdf_check_certificate` exist in the C API
      (`include/mupdf/pdf/form.h:268-269`) and `pdf_pkcs7_verifier` is a four-function
      vtable (`form.h:244-250`), but grepping `platform/wasm/lib/mupdf.c` for `pkcs7` or
      `signer` returns zero matches. Spike D must add that verifier, and it inherits the
      same synchronous-callback problem as Spike C.
      When it ships, it reports **six separate statuses rather than one verdict**, because
      collapsing them is how validators mislead people:
      cryptographic integrity of the digest; ByteRange completeness, including whether
      later revisions exist outside it; chain construction to the selected trust anchor;
      certificate validity at signing time; DocMDP and field-lock compliance of every
      later revision; and revocation, which is reported as `unknown` unless the document
      itself carries the evidence (see `SIGN-015`). A signature is never summarised as
      simply "valid".
- [x] `SIGN-011` **Signature panel** `DEGRADED`. Showing which byte ranges each signature
      covers is `LOCAL` work, readable from the ByteRange array alone. Showing **what
      changed after it** is not: that needs parsing each later incremental revision and
      classifying the changes semantically against DocMDP and field locks. We report the
      revisions that exist after each signature and which objects they touch; we do not
      claim to characterise every change the way Acrobat does. The panel says which of the
      two it is showing
      ([finding](../research/2026-08-01-signature-and-rc4.md)).
- [ ] `SIGN-012` **Import certificates and build a trust list** `LOCAL`
- [ ] `SIGN-013` **Private keys never leave the device** `LOCAL`, stronger than most desktop tools.
- [ ] `SIGN-014` **RFC 3161 timestamping** `EXCLUDED`, requires a network call to a TSA.
- [ ] `SIGN-015` **Revocation checking** `DEGRADED`, not `EXCLUDED`. The earlier label was
      factually wrong: revocation evidence already inside the file is checkable offline.
      A DSS dictionary, an OCSP response stapled into the document, and a user-imported CRL
      are all usable without a network call, and refusing to read data sitting in the
      document would be a self-inflicted limitation. What is `EXCLUDED` is **acquiring
      fresh revocation data**: contacting an OCSP responder or fetching a CRL by URL
      requires a network call
      ([ADR 0002](../adr/0002-client-side-only-zero-egress.md)). So: evidence in the file
      is used and reported with its own timestamp; absent evidence is reported as
      `unknown`, never as `good`.
- [ ] `SIGN-016` **PAdES B-LT and B-LTA (long-term validation)** `EXCLUDED`, requires both of the
      above. Where a user needs LTV, the honest answer is to name a tool that can do it.
- [ ] `SIGN-017` **Request e-signatures from others** `EXCLUDED`, a hosted workflow by definition.

### Passwords, permissions, and encryption

- [ ] `SIGN-018` **Open an encrypted document with a user password** `LOCAL`
- [ ] `SIGN-019` **Open with an owner password** `LOCAL`
- [ ] `SIGN-020` **Set, change, and remove a document open password** `LOCAL`
- [ ] `SIGN-021` **Set a permissions password and the permission flags**: printing, high-resolution
      printing, changes, copying, accessibility extraction, form filling, commenting, page
      extraction, and assembly `LOCAL`
- [ ] `SIGN-022` **AES-256 encryption** `LOCAL`
- [ ] `SIGN-023` **AES-128 encryption** `LOCAL`, for compatibility.
- [x] `SIGN-024` **RC4 encryption**, read-only `DEGRADED`. It is broken, so a document
      using it opens and can be re-saved with AES-256, but a new document is never written
      with it. The document's weak encryption is stated on open rather than silently
      accepted ([finding](../research/2026-08-01-signature-and-rc4.md)).
- [ ] `SIGN-025` **Honour permission flags in the UI** `LOCAL`, with the restriction stated rather
      than the control silently failing.
- [ ] `SIGN-026` **Certificate-based encryption (recipient lists)** `OPEN`, **Spike E
      (public-key security handler)**. Was `LOCAL` with no demonstrated engine path.
      PDF's public-key security handler is a specific construction, not something WebCrypto
      plus a certificate parser provides for free, and no export for it has been located in
      the shim. Spike E must show a document we encrypt this way opens in Acrobat, and one
      Acrobat encrypts opens in ours. If that interoperability cannot be shown, this
      becomes `EXCLUDED` rather than shipping a format only we can read.
- [ ] `SIGN-027` **LiveCycle and AEM rights management** `EXCLUDED`, contacts a rights server on every
      open.

### Redaction

- [ ] `SIGN-028` **Mark text, images, or a region for redaction** `LOCAL`
- [ ] `SIGN-029` **Search and mark all occurrences of a term or pattern** `LOCAL`
- [ ] `SIGN-030` **Redaction properties**: fill colour, overlay text, and repeat overlay `LOCAL`
- [ ] `SIGN-031` **Apply redaction, removing the content from the content stream**
      `DEGRADED`. Previously `EXCLUDED`, which was the wrong label: `EXCLUDED` means
      "impossible without a server, or absent from the engine", and this is neither.
      `applyRedactions` is present in the engine, exercised, and now wired. It was
      withdrawn by decision after Spike A, and the vocabulary had no code for
      "engine-capable, withdrawn by policy", so `EXCLUDED` was made to carry a meaning it
      does not have — while erasing the fact a maintainer most needs, that re-enabling was
      a wiring change rather than an engine port.
      **What makes it `DEGRADED` and not `LOCAL`** is measured, not assumed. Redaction
      writes through `pdf_filter_page_contents`, and that filter perturbs rendering on
      documents it should leave alone: pdfTeX misses the C8 tolerance by 58x and
      LibreOffice by 96x
      ([the research](../research/2026-07-26-redaction-and-editing-on-the-forked-engine.md),
      [ADR 0020](../adr/0020-content-stream-rewriting-failed-stage-one.md)). Redaction adds
      no collateral damage of its own — the changed-pixel counts outside the redacted box
      match the null filter exactly — but it inherits all of the filter's.
      Two categories the engine does **not** clear, and which are therefore swept or
      refused rather than silently left: marked-content property dictionaries carrying the
      text as `/Artifact <</Contents (…)>> BDC`, and XMP metadata. Form XObject content is
      the third. A document that cannot be swept is refused with the category named, which
      is honest; leaving recoverable text is not.
      **Applying a redaction always forces a full, non-incremental save.** An incremental
      save appends, leaving the original unredacted objects physically present in an
      earlier revision of the same file, where a hex editor recovers them even though every
      extraction tool reports them gone. There is no configuration in which a redaction is
      written incrementally. The save must also garbage-collect: a non-collecting full save
      leaves the pre-redaction content stream as an orphan, from which inflating the file
      recovers the text verbatim. Measured on `apache-fop.pdf`, which more than halved once
      collected.
- [ ] `SIGN-035` **Warn before redacting a signed document, and require confirmation**
      `LOCAL`. The full rewrite that `SIGN-032` and `SIGN-033` require invalidates every existing
      signature, because the bytes those signatures covered no longer exist. That is
      correct behaviour and Acrobat does the same. The user is told before it happens.
      Silently invalidating a signature, or silently declining to redact in order to
      preserve one, would both be worse than the warning. See
      [the C7 and C6 conflict](../PRODUCT-SPEC.md#c7-and-c6-cannot-both-hold-on-the-same-save).
- [ ] `SIGN-032` **Redact page ranges wholesale** `LOCAL`
- [ ] `SIGN-033` **Sanitize** `LOCAL`, against an **enumerated scope**. "Remove scripts and
      hidden content" is not a specification, because each category hides in several
      places and a sanitizer that misses one is worse than none: it produces a document
      the user believes is clean. The scope is fixed here.
      **Scripts**: catalog `/OpenAction` and `/AA`, page `/AA`, annotation `/A` and `/AA`,
      form field and widget `/A` and `/AA`, and document-level JavaScript in
      `/Names/JavaScript`. **Embedded files**: `/Names/EmbeddedFiles`, `FileAttachment`
      annotations, and file specifications referenced from anywhere else.
      **Metadata**: the document information dictionary, XMP at document and stream level,
      and per-object private data. **Form values**: `/V`, `/DV`, and the appearance streams
      that may still render a value after the field is cleared. **Hidden content**:
      optional content groups set non-visible, content outside the crop box, and
      annotations with the hidden flag. **Previously deleted content**: objects surviving
      in earlier incremental revisions, which is why sanitize forces a full save exactly as
      redaction does. **XFA** is removed wholesale, since `FORM-030` refuses those
      documents anyway.
- [ ] `SIGN-034` **Report exactly what sanitizing removed** `LOCAL`, per category from the
      scope above, with counts and object references. The report is only meaningful because
      the scope is enumerated; without `SIGN-033`'s list, "exactly" could not be claimed.
      Beyond Acrobat's summary (unverified how much detail Acrobat's report gives).

---

## 9. Convert

### Create a PDF

- [ ] `CONV-001` **From images**: PNG, JPEG, WebP, and GIF `LOCAL`
- [ ] `CONV-002` **From plain text and Markdown** `LOCAL`
- [ ] `CONV-003` **From HTML** `EXCLUDED`. The browser print pipeline is the only faithful local
      renderer and cannot be scripted to produce a file; rasterizing HTML would not preserve
      document semantics. URL capture remains forbidden by zero egress
      ([finding](../research/2026-08-01-conversion-and-compare.md)).
- [ ] `CONV-004` **From a scanner** `EXCLUDED`. No browser API reaches a document scanner. Camera
      capture on a mobile device is the substitute, and is named as such.
- [ ] `CONV-005` **From Office formats** `EXCLUDED`. No Office document-model renderer is
      bundled, and the measured LibreOffice-WASM alternative exceeds the current bundle budget
      without providing an accepted browser write path
      ([finding](../research/2026-08-01-conversion-and-compare.md)).
- [ ] `CONV-006` **From the clipboard** `LOCAL`
- [ ] `CONV-007` **From a web page by URL** `EXCLUDED`, requires fetching a third-party origin.

### Export

- [ ] `CONV-008` **To PNG, JPEG, and WebP**, per page or as a range, at a chosen resolution `LOCAL`
- [ ] `CONV-009` **To plain text**, in logical reading order `LOCAL`
- [ ] `CONV-010` **To Markdown** `LOCAL`, beyond Acrobat. See
      [`competitor-wins.md`](competitor-wins.md#ilovepdf-pdf-to-markdown).
- [ ] `CONV-011` **To HTML**, preserving structure where the document is tagged `LOCAL`
- [ ] `CONV-012` **To Word (`.docx`)** `DEGRADED`. Reconstructing a document model the PDF does not
      contain. Adobe's is server-side and the best available; ours will be worse. The export
      dialog says what is likely to be lost before the user commits.
- [ ] `CONV-013` **To Excel (`.xlsx`)** `DEGRADED`, strongest on tagged tables, weakest on visually
      inferred ones, and it says which case it is in.
- [ ] `CONV-014` **To PowerPoint (`.pptx`)** `DEGRADED`. PDF has no slide model, no speaker
      notes and no shape grouping, so each page becomes a slide of positioned text boxes and
      images. Editable, but not the deck it came from.
- [x] `CONV-015` **To RTF** `DEGRADED`. A largely linear format: columns, floats, and precise
      positioning flatten into reading order. Useful when the text matters and the layout
      does not.
- [ ] `CONV-016` **To CSV from a detected table** `LOCAL` for tagged tables, `DEGRADED` for inferred
      ones.

### OCR

- [x] `CONV-017` **Recognize text in a scanned document** `DEGRADED`. Runs in the lazy
      `ocr.worker` through the installed on-device `TextDetector` in Chromium. Firefox 131 and
      Safari 15.2 do not implement that API and no model is downloaded; the unavailable state is
      shown before use. Quality is worse on poor scans, unusual fonts, and non-Latin scripts.
- [ ] `CONV-018` **Per-word confidence surfaced, not hidden** `LOCAL`
- [ ] `CONV-019` **Searchable-image output** (invisible text layer over the original image) `LOCAL`,
      the default, because it never alters what the user sees.
- [ ] `CONV-020` **Editable-text output** `EXCLUDED`. Recognised text can be downloaded, but the
      build has no independently accepted searchable/editable PDF text-layer writer. Substituting
      recognised text for a scan is not offered
      ([finding](../research/2026-08-01-conversion-and-compare.md)).
- [ ] `CONV-021` **Language selection** `LOCAL`
- [ ] `CONV-022` **Deskew, despeckle, and background removal on scans** `LOCAL`

### Standards

- [ ] `CONV-023` **Convert to PDF/A** `LOCAL`
- [ ] `CONV-024` **Validate PDF/A conformance as a first-class tool** `LOCAL`, beyond Acrobat's
      burial of it inside Preflight. See
      [`competitor-wins.md`](competitor-wins.md#xodo-pdfa-validation-as-a-first-class-tool).
- [ ] `CONV-025` **Convert to PDF/X** `LOCAL`
- [ ] `CONV-026` **Full Preflight profile authoring** `EXCLUDED` for now, not on server grounds but on
      scope. Acrobat's Preflight is a product in itself. Listed so its absence is a stated
      boundary rather than an oversight.

---

## 10. Compare

- [ ] `CMPR-001` **Compare two documents and report the differences** `LOCAL`. Written
      by us over `stext` and rendered output; MuPDF has no comparison API. `LOCAL` means
      it needs nothing the engine cannot supply, not that the engine supplies it.
- [ ] `CMPR-002` **Side-by-side view with synchronised scrolling** `LOCAL`
- [ ] `CMPR-003` **Text differences at word granularity** `LOCAL`
- [x] `CMPR-004` **Image and graphic differences** `DEGRADED`. Detected by comparing
      rendered tiles, so it reports that a region changed, not which object changed or
      how. Anti-aliasing and resampling differences have to be tolerated, which means a
      threshold, which means both false positives and missed subtle changes. The report
      says it is raster-based rather than implying object-level understanding.
- [x] `CMPR-005` **Page insertions, deletions, and moves detected as such** `DEGRADED`,
      by content similarity rather than identity, since a moved page is rarely
      byte-identical after a round trip through another producer. Still far better than
      reporting "everything after page 4 changed", but similarity needs a threshold, and a
      threshold misclassifies at the margin.
- [ ] `CMPR-006` **A navigable difference list** `LOCAL`
- [ ] `CMPR-007` **Filter by change type** `LOCAL`
- [ ] `CMPR-008` **Compare report as a document** `LOCAL`
- [ ] `CMPR-009` **Compare a scanned document against a digital one** `EXCLUDED`. The comparison
      reports that OCR is required and can inspect the current page in Chromium, but it cannot
      OCR both documents across the supported browser floor. It does not call that a comparison
      result ([finding](../research/2026-08-01-conversion-and-compare.md)).

---

## 11. Accessibility

Adobe's Accessibility Checker publishes 32 rules in seven groups. All 32 are implemented.
Two of them (logical reading order, colour contrast) are manual checks in Acrobat because
they cannot be decided mechanically; ours are marked the same way rather than reported as
passing.

**A rule name is not a specification.** `A11Y-001` to `A11Y-032` below are identifiers
and outcomes; the buildable detail lives in
[`a11y-rules.md`](a11y-rules.md), which states per rule the PDF structures inspected, the
exact pass, fail, manual and unreachable conditions, the message the user sees, a minimal
failing fixture, and what the repair tools can and cannot do. Implement from that
document, not from this list.

Three results from writing it are worth carrying here, because they change what these
labels mean:

- **Two rules are `unreachable` rather than merely manual.** Screen flicker (`A11Y-014`)
  and timed responses (`A11Y-016`) require executing and observing content over time. We
  report the mechanisms that could cause them and say plainly that the condition itself
  cannot be determined.
- **One rule deliberately differs from Acrobat.** Table summary (`A11Y-029`) is advisory
  rather than failing, because `/Summary` is required by neither PDF/UA nor WCAG, and
  flagging every table trains users to ignore the report.
- **Three rules have no available repair**, because their only fix needs marked-content
  writing: `A11Y-003`, `A11Y-009` and `A11Y-022`. `A11Y-003` is the one that fires on
  every untagged document, so until Spike A resolves, the report can diagnose the most
  common defect in the world and not fix it. That is stated in the report.

### Document (8)

- [ ] `A11Y-001` **Accessibility permission flag** `LOCAL`
- [ ] `A11Y-002` **Image-only PDF** `LOCAL`
- [ ] `A11Y-003` **Tagged PDF** `LOCAL`
- [ ] `A11Y-004` **Logical reading order** `LOCAL`, manual check.
- [ ] `A11Y-005` **Primary language** `LOCAL`
- [ ] `A11Y-006` **Title** `LOCAL`
- [ ] `A11Y-007` **Bookmarks** `LOCAL`
- [ ] `A11Y-008` **Colour contrast** `LOCAL`, manual check.

### Page content (9)

- [ ] `A11Y-009` **Tagged content** `LOCAL`
- [ ] `A11Y-010` **Tagged annotations** `LOCAL`
- [ ] `A11Y-011` **Tab order** `LOCAL`
- [ ] `A11Y-012` **Character encoding** `LOCAL`
- [ ] `A11Y-013` **Tagged multimedia** `LOCAL`
- [ ] `A11Y-014` **Screen flicker** `LOCAL`
- [ ] `A11Y-015` **Scripts** `LOCAL`
- [ ] `A11Y-016` **Timed responses** `LOCAL`
- [ ] `A11Y-017` **Navigation links** `LOCAL`

### Forms (2)

- [ ] `A11Y-018` **Tagged form fields** `LOCAL`
- [ ] `A11Y-019` **Field descriptions** `LOCAL`

### Alternate text (5)

- [ ] `A11Y-020` **Figures alternate text** `LOCAL`
- [ ] `A11Y-021` **Nested alternate text** `LOCAL`
- [ ] `A11Y-022` **Associated with content** `LOCAL`
- [ ] `A11Y-023` **Hides annotation** `LOCAL`
- [ ] `A11Y-024` **Other elements alternate text** `LOCAL`

### Tables (5)

- [ ] `A11Y-025` **Rows** `LOCAL`
- [ ] `A11Y-026` **TH and TD** `LOCAL`
- [ ] `A11Y-027` **Headers** `LOCAL`
- [ ] `A11Y-028` **Regularity** `LOCAL`
- [ ] `A11Y-029` **Summary** `LOCAL`

### Lists (2)

- [ ] `A11Y-030` **List items** `LOCAL`
- [ ] `A11Y-031` **Lbl and LBody** `LOCAL`

### Headings (1)

- [ ] `A11Y-032` **Appropriate nesting** `LOCAL`

### Repair tools

Every write-side item in this group carries a shared constraint, stated once here rather
than repeated on each line. **The WASM shim exports no structure-tree API.** Grepping
`platform/wasm/lib/mupdf.c` for `struct_tree` returns zero matches, and MuPDF's own
`pdf_structure_type` (`include/mupdf/pdf/document.h:887`) is not bridged. The raw object
API **is** exported (`pdf_dict_put`, `pdf_dict_get`, `pdf_array_push`, `pdf_new_dict`,
`pdf_add_object`, `pdf_new_indirect`), so the structure tree is reachable by manipulating
`/StructTreeRoot` directly.

That makes the **dictionary half** of tagging reachable, and those items are `LOCAL`. It
is materially more work than the labels suggest, since we would be building the tagging
layer on raw dictionaries rather than calling into one. Reading is easier still, because
`stext` carries structure (`fz_new_stext_struct`,
`include/mupdf/fitz/structured-text.h:1146`).

**The dictionary half is not the whole job.** A tag is only useful when it is associated
with the content it describes, and that association lives in the content stream as
`BDC`/`EMC` marked-content operators carrying MCIDs, plus the ParentTree number tree,
`StructParents` and `StructParent` keys, MCR and OBJR references, and a role map. Writing
that association is content-stream rewriting, so `A11Y-035` and `A11Y-036` are `OPEN` on
Spike A rather than `LOCAL`. Items that only set or read a dictionary value stay `LOCAL`.

- [ ] `A11Y-033` **Accessibility report**, with each failure linked to the offending object `LOCAL`
- [ ] `A11Y-034` **Tags panel**: inspect, reorder, retype, and delete tags `LOCAL`, over
      the raw `/StructTreeRoot` per the note above.
- [ ] `A11Y-035` **Reading order tool**: assign regions to tag types by drawing on the page
      `EXCLUDED`, withdrawn after Spike A red because it requires writing `BDC`/`EMC`
      marked-content operators with MCIDs into the content stream.
- [ ] `A11Y-036` **Autotag document** `EXCLUDED`, withdrawn after Spike A red. Structure
      inference without content associations would produce tags that do not identify the
      rendered content.
- [ ] `A11Y-037` **Autotag form fields** `DEGRADED`, same reasoning.
- [ ] `A11Y-038` **Set alternate text**, with a bulk pass over all figures `LOCAL`
- [ ] `A11Y-039` **Set table headers and scope** `LOCAL`
- [ ] `A11Y-040` **Set document language, including per-region language** `LOCAL`
- [ ] `A11Y-041` **Set the title and the display-document-title flag** `LOCAL`
- [ ] `A11Y-042` **Read Out Loud** `EQUIV`, via the Web Speech API rather than Acrobat's engine.
      Voices are the platform's own, so they differ by browser and operating system. Reads
      in structure-tree order where one exists.

### Our own chrome

- [ ] `A11Y-043` **WCAG 2.2 AA throughout** `LOCAL`
      ([ADR 0015](../adr/0015-accessibility-and-no-positioned-dom-text.md)). This is a
      **conformance target for our own chrome, enforced by criteria A1 through A9**, not an
      audited certification. Nobody has audited this product, and a checked box here means
      those criteria pass, not that a third party has signed anything.
- [ ] `A11Y-044` **Logical reading order from the structure tree** `LOCAL`, where the
      document is tagged. Better than the standard approach: the usual invisible-DOM-text
      overlay exposes content-stream order, which reads a two-column page straight across
      the columns.
- [ ] `A11Y-045` **Inferred reading order for untagged documents** `DEGRADED`. Block
      analysis is a heuristic and it misorders the cases that most need it: multi-column
      layouts, footnotes, sidebars, and tables. It is still far better than content-stream
      order, but a screen-reader user is told the order was inferred rather than read from
      the document, so they know to be sceptical of it.

---

## 12. Print

- [ ] `PRNT-001` **Print through the browser's print dialog** `EQUIV`. We do not own the dialog, so
      copies, printer selection, duplex, and paper source belong to the browser and the
      operating system. Everything below is our own pre-print panel, which produces a
      print-ready document the dialog then prints.
- [ ] `PRNT-002` **Page range, and current page** `LOCAL`
- [ ] `PRNT-003` **Odd pages only, even pages only** `LOCAL`
- [ ] `PRNT-004` **Reverse order** `LOCAL`
- [ ] `PRNT-005` **Fit to printable area, actual size, shrink oversized pages, custom scale** `LOCAL`
- [ ] `PRNT-006` **Auto-portrait and auto-landscape per page** `LOCAL`
- [ ] `PRNT-007` **Multiple pages per sheet**, with order and borders `LOCAL`
- [ ] `PRNT-008` **Booklet printing**, with binding and sheet subsets `LOCAL`
- [ ] `PRNT-009` **Poster and tiling**, with scale, overlap, and cut marks `LOCAL`
- [ ] `PRNT-010` **Comments and forms**: document, document and markups, document and stamps, form
      fields only `LOCAL`
- [ ] `PRNT-011` **Print a comment summary alongside the document** `LOCAL`
- [ ] `PRNT-012` **Print as image** `LOCAL`
- [ ] `PRNT-013` **Honour the no-print permission flag** `LOCAL`
- [ ] `PRNT-014` **Print production: marks, bleeds, colour management, and separation preview**
      `EXCLUDED` on scope, not on server grounds. Prepress is a distinct product and is
      named here so its absence is deliberate.

---

## 13. Automation

- [ ] `AUTO-001` **Command palette** `LOCAL`, beyond Acrobat, which has none. See
      [`competitor-wins.md`](competitor-wins.md#a-command-palette-which-acrobat-lacks-entirely).
- [ ] `AUTO-002` **Pipeline builder: chain operations without code** `LOCAL`, beyond Acrobat's Action
      Wizard. See [`competitor-wins.md`](competitor-wins.md#stirling-the-no-code-pipeline-builder).
- [ ] `AUTO-003` **Batch a pipeline over many local files** `LOCAL`
- [ ] `AUTO-004` **Save, name, and export a pipeline** `LOCAL`, as a plain file the user owns.
- [ ] `AUTO-005` **Import a pipeline** `LOCAL`, with every step it will perform shown before it runs.
      An importable automation format is an execution vector, so a pipeline is never run on
      import.
- [x] `AUTO-006` **Document-level JavaScript for forms** `LOCAL`, via `mujs=yes`. External
      launch, mail, submit, print, and menu requests are observed and blocked.
- [x] `AUTO-007` **A JavaScript console for authoring form scripts** `LOCAL`, inside the
      document worker with MuJS runtime and memory limits.
- [ ] `AUTO-008` **Folder-level JavaScript** `EXCLUDED`. It has no browser meaning: there is no
      application folder to install scripts into.
- [ ] `AUTO-009` **Acrobat Action Wizard file compatibility** `EXCLUDED` on scope. Our pipelines are
      our own format.

---

## Coverage summary

312 items in total.

| Label      | Count | Where it concentrates                                                                                                                                                                                         |
| ---------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCAL`    |   251 | Viewing, navigation, search, selection, markup, comment management, organize pages, forms, signing, redaction, accessibility, print, automation                                                               |
| `DEGRADED` |    19 | Guarded text replacement, scalar form filling, Chromium-only OCR, signature revocation status, raster comparison, RC4                                                                                         |
| `EXCLUDED` |    32 | Existing content/object rewrites, text reflow, unavailable conversion/OCR output, marked-content tagging, cloud workflows, XFA, scanner input, timestamping, online revocation checking, LTV, prepress, sound |
| `OPEN`     |     5 | Signing (Spike C), signature validation (Spike D), and certificate encryption (Spike E)                                                                                                                       |
| `EQUIV`    |     5 | Find, clipboard, save and save as, print, Read Out Loud                                                                                                                                                       |

By section:

| Section                               | Items |
| ------------------------------------- | ----: |
| 1. Viewing and navigation (`VIEW`)    |    37 |
| 2. Search and text selection (`FIND`) |    14 |
| 3. Comment and markup (`MARK`)        |    35 |
| 4. Comment management (`CMNT`)        |    13 |
| 5. Edit content (`EDIT`)              |    25 |
| 6. Organize pages (`PAGE`)            |    20 |
| 7. Forms (`FORM`)                     |    30 |
| 8. Sign and security (`SIGN`)         |    35 |
| 9. Convert (`CONV`)                   |    26 |
| 10. Compare (`CMPR`)                  |     9 |
| 11. Accessibility (`A11Y`)            |    45 |
| 12. Print (`PRNT`)                    |    14 |
| 13. Automation (`AUTO`)               |     9 |

The counts are maintained by hand and are a summary, not a gate. If they drift from the
items above, the items are correct.

The concentration is the point. `EXCLUDED` is almost entirely workflows that need a server,
which is the trade the product exists to make.

`OPEN` grew under adversarial review and fell when Spike A supplied an answer rather than a
promotion. The red result withdrew general rewrite-dependent features
([ADR 0020](../adr/0020-content-stream-rewriting-failed-stage-one.md)); ADR 0028 later
restored only a guarded ASCII replacement path with transactional self-consistency checks
and independent saved-output acceptance. The remaining open items have no demonstrated
engine path: signing depends on bridging a synchronous C callback to asynchronous WebCrypto (Spike C), signature
validation needs a verifier the shim does not export (Spike D), and certificate-based
encryption needs PDF's public-key security handler (Spike E).

`DEGRADED` is worth reading as a group. It is not one kind of weakness. Some reconstruct a
model the PDF does not contain, three edit text through an overlay rather than replacing
the original stream, three work at the raster level rather than the object level, and
others follow from missing network access or format limits. Each ships with its own
disclosure because each is weak in a different way.

## Scope, honestly

312 items is a very large surface. Two things follow, and neither is softened here.

**This is a multi-year contract, not a release plan.** Acrobat is thirty years of
accumulated work. Nothing about writing the list down shortens that. The phase order in
[`../ROADMAP.md`](../ROADMAP.md) is what governs sequence; this document governs what
"done" means for each item when its turn comes.

**Completeness is not the goal, and a partial product is not a failure.** A viewer that
does sections 1, 2, and 3 properly is worth shipping. This inventory exists so that such a
product can say precisely what it does and does not do, rather than implying the rest.
Shipping a worse version of every Acrobat feature is explicitly not the goal
([`../VISION.md`](../VISION.md#non-goals)).
