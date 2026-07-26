# Accessibility rule specification

The thirty-two rules of Adobe's Accessibility Checker, specified precisely enough to
implement without consulting Adobe. This document is the prerequisite that
[`parity-inventory.md`](parity-inventory.md) section 11 named as blocking `A11Y-001`
through `A11Y-032`.

Each rule below states what it inspects in terms of PDF structures, the exact pass, fail
and manual conditions, the message the user sees, a minimal failing fixture, and what the
repair tools can do about it.

## How to read this

**Identifiers** match `parity-inventory.md` exactly, so the two documents join on
`A11Y-0NN`.

**Verdicts** are one of four, and the distinction between the last two is the honesty
discipline of this document:

| Verdict       | Meaning                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `pass`        | The condition is satisfied.                                                                                    |
| `fail`        | The condition is violated. Actionable, with a location.                                                        |
| `manual`      | Cannot be decided mechanically. The tool presents the evidence and the user decides. Never reported as a pass. |
| `unreachable` | Cannot be checked with the engine surface we have. Stated, not guessed at.                                     |

A rule that returns `manual` must show the user what to look at. "Needs manual check" with
no evidence is a rule that will always be skipped.

**Repair** cross-references `A11Y-033` to `A11Y-041`. Several of those are `OPEN` on
Spike A, because writing a tag's **association** to content needs `BDC`/`EMC` operators
with MCIDs in the content stream. Where a rule's only repair is blocked, it says so
rather than implying a fix exists.

**Adobe's rule set is the reference, not the authority.** Where our behaviour should
differ, the rule says which and why. Two categories of difference recur: rules where we
can give a better message because we have the object graph, and rules where Adobe's
formulation predates PDF 2.0.

**Unverified** marks anything not confirmed against Adobe's published documentation. The
rule names and groupings are from that documentation; the precise pass conditions Acrobat
uses internally are not published, so where this document states a threshold or a
tolerance it is **our** definition and is marked as such.

## Engine surface these rules rely on

Confirmed against the vendored source at MuPDF 1.28.0:

| Need                           | Available                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Permission bits                | `wasm_has_permission` (`mupdf.c:1037`), with `FZ_PERMISSION_ACCESSIBILITY = 'y'` (`fitz/document.h:126`)                              |
| Structured text with structure | `stext` with `FZ_STEXT_COLLECT_STRUCTURE`                                                                                             |
| Unmapped character detection   | `FZ_STEXT_USE_CID_FOR_UNKNOWN_UNICODE` sets `FZ_STEXT_UNICODE_IS_CID` (bit 128) in the char flags word (`fitz/structured-text.h:498`) |
| Raw object graph               | `pdf_dict_get`, `pdf_dict_put`, `pdf_array_push`, `pdf_new_dict`, `pdf_add_object`, `pdf_new_indirect`                                |
| Annotations                    | 20 `wasm_pdf_annot*` exports                                                                                                          |
| Outline                        | `wasm_outline_iterator_*`, including insert, update and delete                                                                        |

**Not available**, and the reason several repairs are blocked: the shim exports no
structure-tree API (`struct_tree` returns zero matches), and no marked-content writing.
Reading structure is possible through `stext`; writing the content-stream side is Spike A
work.

---

## Group 1: Document (8 rules)

### `A11Y-001` Accessibility permission flag

**Checks.** The encryption dictionary's permission bits. Specifically
`FZ_PERMISSION_ACCESSIBILITY`, which corresponds to bit 10 of `/P` in the standard
security handler.

**Pass.** The document is unencrypted, or `wasm_has_permission(doc, 'y')` returns
non-zero.

**Fail.** The document is encrypted and the accessibility permission bit is clear.

**Message.** "This document's security settings block screen readers from extracting its
text. Removing the permissions password will fix it, and you need the owner password to
do that."

**Fixture.** Any one-page document encrypted with a permissions password and bit 10
cleared.

**Repair.** Possible only with the owner password, via `SIGN-021`. The report says so
rather than offering a repair that will fail.

**Note.** PDF 2.0 deprecated this bit: a conforming 2.0 reader ignores it and extracts
anyway. We still report it, because the documents users hold were mostly written before
2.0 and older readers do honour it. The message says the setting blocks readers, not that
it is unconditionally enforced.

### `A11Y-002` Image-only PDF

**Checks.** Whether pages carry extractable text or are scans with no text layer.

**Pass.** Every page yields at least one `stext` character.

**Fail.** One or more pages yield zero characters while the page renders non-blank.

**Manual.** Never. A page with no characters that also renders blank is genuinely empty
and passes; a deliberately blank page is not an accessibility failure.

**Message.** "Pages 4, 7 and 12 are images with no text behind them. A screen reader
finds nothing to read on them. Running text recognition adds a text layer."

**Fixture.** A single page whose only content is a JPEG of a paragraph.

**Repair.** OCR (`CONV-017`), which is `DEGRADED`. The offer names that the recognised
text is a best effort and shows confidence, per `CONV-018`.

**Difference from Adobe.** We name the specific pages. Adobe reports the document as a
whole (unverified whether recent versions changed this). Naming pages is strictly more
useful and costs nothing, since we already walked them.

### `A11Y-003` Tagged PDF

**Checks.** `/StructTreeRoot` in the document catalog, and `/MarkInfo` `/Marked` set true.

**Pass.** Both present, and `/StructTreeRoot` resolves to a dictionary containing at least
one `/K` child.

**Fail.** Either absent, or `/StructTreeRoot` present but empty. An empty structure tree
is reported distinctly from an absent one, because it usually means a producer started
tagging and gave up, which is a different repair.

**Message, absent.** "This document has no tag structure. Screen readers will fall back to
guessing the reading order from the page layout, which usually goes wrong on columns,
tables and footnotes."

**Message, empty.** "This document declares a tag structure but it contains no tags.
Whatever produced it started tagging and did not finish."

**Fixture.** Two: one document with no `/StructTreeRoot`, one with
`/StructTreeRoot << /Type /StructTreeRoot >>` and no `/K`.

**Repair.** Autotag, `A11Y-036`, which is **`OPEN` on Spike A**. This rule's report must
say the repair is not yet available rather than offering it.

### `A11Y-004` Logical reading order

**Verdict: `manual`, always.** This is one of the two rules Acrobat leaves manual, and
ours stays manual for the same reason: whether an order is _logical_ is a judgement about
meaning, not a property of the file.

**What we present.** The structure-tree order rendered as a numbered overlay on the page,
so the user reads the order the document declares rather than inferring it. Where no
structure tree exists, the inferred order from block analysis is shown instead and
labelled as inferred (`A11Y-045`, `DEGRADED`).

**Message.** "Check that the numbered order below matches how this page should be read.
This cannot be checked automatically: only a person can tell whether the order makes
sense."

**Fixture.** A two-column page whose structure tree orders content left-block then
right-block correctly, and a second whose tree interleaves them. Both return `manual`;
the fixture asserts the overlay renders the declared order faithfully, which is the part
we can test.

**Repair.** The reading order tool, `A11Y-035`, which is **`OPEN` on Spike A**.

### `A11Y-005` Primary language

**Checks.** `/Lang` in the document catalog.

**Pass.** Present, non-empty, and a well-formed BCP 47 tag.

**Fail.** Absent, empty, or malformed. Malformed is reported distinctly, because `/Lang
(english)` fails for a different reason than a missing key and needs a different fix.

**Message, absent.** "This document does not say what language it is in, so a screen
reader will use the reader's default voice. That reads French text with an English
pronunciation."

**Message, malformed.** "This document's language is set to `english`, which is not a
valid language code. It should be a code like `en` or `en-GB`."

**Fixture.** One document with no `/Lang`, one with `/Lang (english)`.

**Repair.** `A11Y-040`, `LOCAL`. Setting a catalog key needs no marked-content work.

### `A11Y-006` Title

**Checks.** Two things, and both must hold: `/Title` in the document information
dictionary or the XMP `dc:title`, and `/ViewerPreferences` `/DisplayDocTitle` set true.

**Pass.** A non-empty title exists **and** `/DisplayDocTitle` is true.

**Fail, no title.** Neither source carries a non-empty title.

**Fail, title not displayed.** A title exists but `/DisplayDocTitle` is absent or false,
so readers show the filename instead. This is the case people miss, because the title is
right there in the properties dialog and the rule still fails.

**Message, no title.** "This document has no title, so it will be announced by its
filename."

**Message, not displayed.** "This document has the title \"Q3 Report\" but is set to show
its filename instead. Turning on 'display document title' makes readers announce the
title."

**Fixture.** One with no `/Title`; one with `/Title (Q3 Report)` and no
`/DisplayDocTitle`.

**Repair.** `A11Y-041`, `LOCAL`. Both are dictionary values.

### `A11Y-007` Bookmarks

**Checks.** Whether a document long enough to need an outline has one. Adobe's threshold
is not published; **ours is 21 or more pages**, and that number is our definition rather
than a match to Acrobat's (unverified).

**Pass.** Fewer than 21 pages, or `/Outlines` present with at least one entry.

**Fail.** 21 or more pages and no outline entries.

**Message.** "This 84-page document has no bookmarks. Readers navigating by structure have
no way to jump between sections."

**Fixture.** A 25-page document with no `/Outlines`.

**Repair.** `EDIT-021`, generating bookmarks from structure-tree headings, which is
`LOCAL`: it reads structure through `stext` and writes through the exported outline
iterator, so no marked-content work is needed. Where the document has no headings to
derive from, the repair is unavailable and says so.

### `A11Y-008` Colour contrast

**Verdict: `manual`, always.** The second of Acrobat's two manual rules.

**Why it stays manual, precisely.** Deciding contrast needs a foreground and a background
colour per text run. The foreground is available from the content stream's colour
operators. The background is not a property of anything: it is whatever was painted
underneath, which may be a fill, an image, a gradient, a transparency group, or the page
itself. Sampling rendered pixels gives a number, but that number is wrong wherever text
sits over a gradient or a photo, which is exactly where contrast problems occur.

Reporting a computed ratio would therefore produce confident, sometimes-wrong numbers.
That is worse than asking.

**What we present.** Rendered text regions with their sampled foreground and background
at the glyph centroid, with the computed ratio shown **and explicitly labelled as an
estimate**, alongside the regions where sampling is unreliable (text over images,
gradients, or transparency groups) flagged separately.

**Message.** "Check the contrast of the highlighted text. The estimated ratios below are
sampled from the rendered page and are only a guide; text over images or gradients cannot
be measured reliably."

**Fixture.** A page with light grey text on white (clearly failing), black on white
(clearly passing), and white text over a photograph (unmeasurable). The fixture asserts
the third is flagged unmeasurable rather than given a number.

**Repair.** None. Contrast is a property of the document's design, and changing it means
changing the content, which this tool does not do on a user's behalf.

---

## Group 2: Page content (9 rules)

### `A11Y-009` Tagged content

**Checks.** Every piece of rendered page content is either inside a marked-content
sequence associated with a structure element, or explicitly marked as an artifact
(`/Artifact`).

**Pass.** Every content item is tagged or artifacted.

**Fail.** One or more items are neither. These are the items a screen reader will silently
skip.

**Message.** "Page 3 has content that is neither tagged nor marked as decoration. A screen
reader will skip it entirely, so if it carries meaning it will be lost."

**Fixture.** A page with a tagged paragraph and one untagged text run outside any `BDC`.

**Repair.** Tagging the content, `A11Y-036`, **`OPEN` on Spike A**. Marking it as an
artifact is equally blocked, since both write `BDC`/`EMC` operators into the content
stream. The report must say no repair is available yet.

### `A11Y-010` Tagged annotations

**Checks.** Every annotation other than `Link` and `Popup` has a corresponding structure
element, via `/StructParent` on the annotation resolving through the ParentTree.

**Pass.** Every in-scope annotation resolves to a structure element.

**Fail.** An annotation has no `/StructParent`, or its `/StructParent` does not resolve.

**Message.** "The highlight on page 2 is not part of the document's tag structure, so a
screen reader will not announce it."

**Fixture.** A page with one `Highlight` annotation and no `/StructParent`.

**Repair.** Partially `LOCAL`. Adding the `/StructParent` key and the ParentTree entry is
raw-dictionary work. But an annotation's structure element must be an OBJR reference
inside the tree, and creating a well-formed tree entry for a document that has none is
the association problem again. Repair is available where a structure tree already exists,
and blocked where one must be created.

### `A11Y-011` Tab order

**Checks.** Each page's `/Tabs` key.

**Pass.** `/Tabs` is `/S` (structure order) on every page that has annotations or form
fields.

**Fail.** `/Tabs` is absent, `/R` (row order), or `/C` (column order) on such a page.

**Note.** A page with no annotations and no fields has nothing to tab through and passes
regardless.

**Message.** "Page 5's tab order follows the page layout rather than the document
structure. Tabbing through the form may jump around unpredictably."

**Fixture.** A page with two form fields and `/Tabs /R`.

**Repair.** `LOCAL`. `/Tabs` is a single page-dictionary key, and `FORM-022` sets it.

### `A11Y-012` Character encoding

**Checks.** Whether every character has a Unicode value, or only a glyph code. Text
without a Unicode mapping extracts as nothing usable regardless of how well it is tagged.

**Method, and this one is precise because the engine gives us a direct signal.** Extract
with `FZ_STEXT_USE_CID_FOR_UNKNOWN_UNICODE` set. When MuPDF cannot resolve a character to
Unicode it returns the CID instead and sets `FZ_STEXT_UNICODE_IS_CID` (bit 128) in that
character's flags word (`fitz/structured-text.h:498`). Any character carrying that flag
failed to map.

**Pass.** No character on any page carries `FZ_STEXT_UNICODE_IS_CID`.

**Fail.** One or more do.

**Message.** "Some text on page 6 has no Unicode mapping, so it copies and reads as
gibberish even though it looks correct on screen. This usually means the font was embedded
without a `/ToUnicode` map."

**Fixture.** A page using an embedded subset font with a symbolic encoding and no
`/ToUnicode` CMap.

**Repair.** None currently. Constructing a `/ToUnicode` map for a font that lacks one is
the inverse of the encoding inversion in
[ADR 0012](../adr/0012-content-stream-text-editing.md), and it is not in scope. The report
names the affected font so the user can go back to the producer.

**Note.** This rule directly overlaps Spike B: a font that fails here will also fail
in-place text editing, and the same diagnostic serves both.

### `A11Y-013` Tagged multimedia

**Checks.** `Screen` and `Movie` annotations, and any `/RichMedia`, have a structure
element and alternate text.

**Pass.** No multimedia present, or every item is tagged with a non-empty `/Alt`.

**Fail.** Multimedia present without both.

**Message.** "The video on page 9 has no description. A screen reader announces only that
something is there."

**Fixture.** A page with a `Screen` annotation and no `/StructParent`.

**Repair.** Same split as `A11Y-010`: the dictionary side is `LOCAL`, creating a tree
entry where none exists is blocked.

**Note.** We render neither `Screen` nor `Movie` content. The rule still checks them,
because the document may be opened elsewhere and the accessibility defect is real
regardless of whether we play it.

### `A11Y-014` Screen flicker

**Checks.** Content that flashes, per Adobe's rule.

**Verdict: `unreachable`, reported as such.** Flicker arises from JavaScript animation,
`/AA` page actions driving visual change, or embedded multimedia. Deciding whether any of
those _flickers_, at what rate, and whether it crosses the three-flashes-per-second
threshold requires executing and observing the content over time. We do not do that, and a
static inspection cannot substitute.

**What we do instead.** Report the presence of the _mechanisms_ that can cause flicker:
page `/AA` actions, document-level JavaScript, `Screen` and `Movie` annotations. The user
is told these exist and that flicker cannot be determined automatically.

**Message.** "This document contains scripts and page actions that could cause flashing
content. Whether they do cannot be determined without running them. Flashing content can
trigger seizures, so check manually if this document will be published."

**Fixture.** A page with an `/AA` `/O` action containing JavaScript.

**Repair.** Removing scripts entirely, via sanitize (`SIGN-033`), which is a blunt
instrument and is described as one.

**Difference from Adobe.** Adobe presents this as a manual check. We report it as
unreachable-with-evidence, which is the same practical outcome stated more honestly: we
are not asking the user to check something we could have checked, we are telling them we
cannot.

### `A11Y-015` Scripts

**Checks.** Whether scripted behaviour interferes with assistive technology. In practice:
the presence of scripts that alter content or focus.

**Pass.** No document-level JavaScript, no `/AA` on catalog, pages, annotations or fields.

**Fail.** Any present. **This is a flag, not a defect**, and the message must say so
clearly, because a form with calculation scripts is legitimately scripted and perfectly
accessible.

**Message.** "This document runs scripts. Scripts can change content or move focus in ways
a screen reader does not announce. This is not necessarily a problem, but scripted forms
should be tested with a screen reader."

**Fixture.** A document with `/Names /JavaScript` present.

**Repair.** Sanitize (`SIGN-033`) removes scripts, which will break a form that depends on
them. The report says that before offering it.

### `A11Y-016` Timed responses

**Checks.** Whether the document imposes a time limit on user response.

**Verdict: `unreachable`, reported as such.** A timing constraint in a PDF is implemented
in JavaScript, so detecting it means understanding what a script does. Pattern-matching
for `setTimeout` in document JavaScript would produce both false positives and false
negatives, and reporting either as a verdict would be worse than reporting neither.

**What we do instead.** Report whether document JavaScript exists at all, and say that
timed behaviour cannot be detected within it.

**Message.** "If this document sets any time limits through scripts, they cannot be
detected automatically. Time limits must be adjustable or removable for users who need
longer."

**Fixture.** Shares `A11Y-015`'s fixture.

**Repair.** None, beyond removing scripts wholesale.

### `A11Y-017` Navigation links

**Checks.** Link annotations are tagged and have a discernible purpose.

**Pass.** Every `Link` annotation has a `/StructParent` resolving to a `Link` structure
element, and either enclosed text or a non-empty `/Contents`.

**Fail.** A link that is untagged, or one whose only accessible name would be the raw URL.

**Message.** "The link on page 2 has no description. A screen reader will read the whole
URL aloud, which for this link is 94 characters."

**Fixture.** A page with a `Link` annotation over a bare URL, no `/StructParent`, no
`/Contents`.

**Repair.** Setting `/Contents` is `LOCAL`. Tagging is the `A11Y-010` split.

**Difference from Adobe.** We quote the URL length in the message, because "94 characters
read aloud" conveys the problem better than "the link lacks alternate text" does.

---

## Group 3: Forms (2 rules)

### `A11Y-018` Tagged form fields

**Checks.** Every form field's widget annotation has a `/StructParent` resolving through
the ParentTree to a `Form` structure element.

**Pass.** All widgets resolve.

**Fail.** Any does not.

**Message.** "The 'Date of birth' field on page 1 is not part of the tag structure. A
screen reader will not associate it with anything on the page."

**Fixture.** A one-page AcroForm with one text field and no `/StructParent` on its widget.

**Repair.** The `A11Y-010` split: dictionary side `LOCAL`, tree creation blocked.

### `A11Y-019` Field descriptions

**Checks.** Every field has an accessible name, from `/TU` (the tooltip, which is what
readers announce) rather than `/T` (the internal field name).

**Pass.** Every field has a non-empty `/TU`.

**Fail.** Any field has no `/TU`, or a `/TU` identical to its `/T`.

**Why the second condition.** A `/TU` copied from `/T` gives fields announced as
"txtDOB_1", which passes a naive presence check and helps nobody. Adobe's exact treatment
of this case is unverified; we flag it deliberately.

**Message.** "The field named 'txtDOB_1' has no description, so a screen reader announces
its internal name. Add a tooltip describing what to enter."

**Fixture.** A field with `/T (txtDOB_1)` and no `/TU`; a second with `/TU (txtDOB_1)`.

**Repair.** `LOCAL`, via `FORM-017`. `/TU` is a field-dictionary value with no
marked-content involvement.

---

## Group 4: Alternate text (5 rules)

### `A11Y-020` Figures alternate text

**Checks.** Every `Figure` structure element has a non-empty `/Alt` or `/ActualText`.

**Pass.** All do.

**Fail.** Any has neither, or has an `/Alt` that is whitespace only.

**Message.** "The image on page 4 has no description. Add one describing what the image
conveys, or mark it as decorative if it conveys nothing."

**Fixture.** A page with one `Figure` element and no `/Alt`.

**Repair.** `A11Y-038`, `LOCAL`. Setting `/Alt` on an existing structure element is
dictionary work. Where no `Figure` element exists at all, that is `A11Y-009`'s failure and
its repair is blocked.

**Note.** We do not generate alternate text. A machine-written description of an image is
a guess presented as a fact, and a wrong description is worse than a missing one because
the user cannot tell it is wrong.

### `A11Y-021` Nested alternate text

**Checks.** No structure element carrying `/Alt` contains descendants that also carry
`/Alt` or their own text content.

**Why it matters.** `/Alt` replaces the entire subtree for a screen reader. Nested
alternate text is silently discarded, so a figure with a described sub-figure loses the
inner description with no warning.

**Pass.** No `/Alt`-bearing element has `/Alt`-bearing descendants.

**Fail.** Any does.

**Message.** "The description on the grouped figure on page 6 hides the descriptions of
the three images inside it. Only the outer one will be read."

**Fixture.** A `Figure` with `/Alt`, containing two child `Figure` elements each with
their own `/Alt`.

**Repair.** `A11Y-038` can remove the outer `/Alt` or merge the inner ones into it. Both
are dictionary edits, so `LOCAL`. The choice is the user's, since only they know which
description is right.

### `A11Y-022` Associated with content

**Checks.** Every structure element carrying `/Alt` actually maps to page content, through
an MCID that resolves via the ParentTree.

**Why it matters.** Alternate text on an element that describes nothing is announced at an
arbitrary point in the reading order, or not at all.

**Pass.** Every `/Alt`-bearing element resolves to at least one marked-content sequence or
OBJR.

**Fail.** Any resolves to nothing.

**Message.** "A description on page 8 is not attached to anything on the page. It will
either be read at the wrong moment or not at all."

**Fixture.** A structure tree containing a `Figure` with `/Alt` and an MCID that appears
nowhere in the page's content stream.

**Repair.** **Blocked.** Attaching an element to content requires writing the
marked-content sequence, which is Spike A. Removing the orphaned element is `LOCAL` and is
offered as the alternative.

### `A11Y-023` Hides annotation

**Checks.** No `/Alt` on a structure element causes an annotation inside its subtree to be
hidden from assistive technology.

**Pass.** No `/Alt`-bearing element contains an annotation reference in its subtree.

**Fail.** Any does. Same mechanism as `A11Y-021`: `/Alt` replaces the subtree, so an
annotation inside it disappears.

**Message.** "The description on page 3 hides a link inside it. A screen reader user will
not know the link is there."

**Fixture.** A `Figure` with `/Alt` whose subtree contains an OBJR pointing at a `Link`
annotation.

**Repair.** `A11Y-038`, `LOCAL`, by removing or restructuring the `/Alt`.

### `A11Y-024` Other elements alternate text

**Checks.** Non-`Figure` elements that need a text alternative have one: `Formula`, and
any element whose content is not text.

**Pass.** All such elements carry `/Alt` or `/ActualText`.

**Fail.** Any lacks both.

**Message.** "The formula on page 11 has no text alternative. A screen reader will read
its individual symbols, which for this formula produces nonsense."

**Fixture.** A `Formula` element with no `/Alt`.

**Repair.** `A11Y-038`, `LOCAL` where the element exists.

**Note.** `/ActualText` and `/Alt` are not interchangeable, and the report says which is
appropriate: `/ActualText` replaces the text for both reading and copying and suits a
ligature or a stylised word; `/Alt` describes and suits a formula or an image. Offering
the wrong one produces a document that copies badly.

---

## Group 5: Tables (5 rules)

### `A11Y-025` Rows

**Checks.** Every `TR` is a child of `Table`, `THead`, `TBody` or `TFoot`, and every
`Table` contains at least one `TR`.

**Pass.** Structure is well formed.

**Fail.** A `TR` appears elsewhere, or a `Table` has no rows.

**Message.** "The table on page 5 has rows outside the table structure. Screen readers may
not announce it as a table at all."

**Fixture.** A `Table` element with a `TR` nested under a `Div` instead.

**Repair.** `A11Y-034`, `LOCAL`. Reparenting is raw-dictionary work on `/K` arrays, with
no content-stream involvement.

### `A11Y-026` TH and TD

**Checks.** Every child of a `TR` is `TH` or `TD`, and every `TH`/`TD` has a `TR` parent.

**Pass.** Well formed.

**Fail.** Any other element type appears as a row child.

**Message.** "The table on page 5 contains cells that are not marked as header or data
cells. Its structure will not be announced correctly."

**Fixture.** A `TR` containing a `P` element directly.

**Repair.** `A11Y-034`, `LOCAL`.

### `A11Y-027` Headers

**Checks.** Every `TD` is associated with headers, by one of two mechanisms: its `TH`
carries `/Scope` (`/Row`, `/Column`, `/Both`), or the `TD` carries `/Headers` listing the
IDs of its header cells.

**Pass.** Every data cell is reachable by at least one mechanism.

**Fail.** Any data cell has neither.

**Note.** A table with no `TH` at all fails `A11Y-026` first. This rule assumes headers
exist and asks whether they are associated.

**Message.** "The table on page 5 has header cells, but its data cells are not linked to
them. A screen reader will read values without saying which column they belong to."

**Fixture.** A two-by-two table with `TH` cells lacking `/Scope` and `TD` cells lacking
`/Headers`.

**Repair.** `A11Y-039`, `LOCAL`. Both `/Scope` and `/Headers` are dictionary values.

### `A11Y-028` Regularity

**Checks.** Every row has the same number of columns, once `/ColSpan` and `/RowSpan` are
accounted for.

**Method.** Build the occupancy grid by walking rows and expanding spans, then check every
row's total equals the table's column count and no cell overlaps another.

**Pass.** The grid is complete and non-overlapping.

**Fail.** A row is short, long, or two cells claim the same position.

**Message.** "The table on page 5 is irregular: row 3 has 4 columns where the rest have 5.
Screen readers navigating it cell by cell will lose their place."

**Fixture.** A three-row table where the middle row omits a cell without a compensating
span.

**Repair.** `A11Y-034` can adjust spans, `LOCAL`. Whether the fix is a span or a missing
cell is a judgement, so the tool shows the grid and the user chooses.

### `A11Y-029` Summary

**Checks.** Tables have a `/Summary`.

**Verdict: `pass` with an advisory, never `fail`.**

**Why we differ from Adobe deliberately.** `/Summary` is not required by PDF/UA or by
WCAG, and it was deprecated in HTML. A simple table with clear headers needs no summary,
and flagging every table as failing trains users to ignore the report, which costs more
accessibility than the missing summaries do.

**Message, advisory.** "The table on page 5 has no summary. Complex tables benefit from
one; simple ones with clear headers do not need it."

**Fixture.** A table with no `/Summary`. The fixture asserts the verdict is advisory, not
failing, which is the behaviour that differs from Acrobat.

**Repair.** `A11Y-034`, `LOCAL`.

---

## Group 6: Lists (2 rules)

### `A11Y-030` List items

**Checks.** Every `LI` has an `L` parent, and every `L` contains at least one `LI`.

**Pass.** Well formed.

**Fail.** An `LI` outside an `L`, or an empty `L`.

**Message.** "Page 7 has list items that are not inside a list. A screen reader will not
announce them as a list or say how many items there are."

**Fixture.** An `LI` element parented directly to `Document`.

**Repair.** `A11Y-034`, `LOCAL`.

### `A11Y-031` Lbl and LBody

**Checks.** Every `Lbl` and `LBody` has an `LI` parent.

**Pass.** Well formed.

**Fail.** Either appears elsewhere.

**Message.** "Page 7 has list labels outside their list items. The bullets or numbers will
be read separately from the text they belong to."

**Fixture.** An `Lbl` parented to `L` rather than `LI`.

**Repair.** `A11Y-034`, `LOCAL`.

---

## Group 7: Headings (1 rule)

### `A11Y-032` Appropriate nesting

**Checks.** Heading levels descend without skipping. `H1` then `H2` is correct; `H1` then
`H3` is not.

**Method.** Walk the structure tree in document order, tracking the previous heading
level. A heading whose level exceeds the previous by more than one fails.

**Pass.** No skipped levels, and the first heading is `H1`.

**Fail.** Any skip, or a document whose first heading is not `H1`.

**Note.** PDF's `H` element (unnumbered heading) is not checkable this way and is reported
separately as an advisory, since its level is implied by nesting depth rather than stated.

**Message.** "Page 4 jumps from a level 1 heading to a level 3 heading. Readers navigating
by heading level will think a section is missing."

**Fixture.** A structure tree with `H1` followed directly by `H3`.

**Repair.** `A11Y-034` can change a heading's level, `LOCAL`, since the element type is a
dictionary value. Whether the fix is to demote the `H3` or insert a missing `H2` is the
user's judgement.

---

## Summary of verdicts

| Verdict                                       | Rules                                          |
| --------------------------------------------- | ---------------------------------------------- |
| Mechanically decidable                        | 27                                             |
| `manual` by nature                            | `A11Y-004` reading order, `A11Y-008` contrast  |
| `unreachable`, reported with evidence         | `A11Y-014` flicker, `A11Y-016` timed responses |
| Advisory rather than failing, by our decision | `A11Y-029` table summary                       |

## Summary of repairs

| Repair status                                         | Rules                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Repairable now, dictionary-only work                  | `A11Y-005`, `A11Y-006`, `A11Y-007`, `A11Y-011`, `A11Y-019`, `A11Y-020`, `A11Y-021`, `A11Y-023`, `A11Y-024`, `A11Y-025` to `A11Y-032` |
| Repairable only where a structure tree already exists | `A11Y-010`, `A11Y-013`, `A11Y-017`, `A11Y-018`                                                                                       |
| **Blocked on Spike A** (needs marked-content writing) | `A11Y-003`, `A11Y-009`, `A11Y-022`                                                                                                   |
| Repair exists but is `DEGRADED`                       | `A11Y-002` via OCR                                                                                                                   |
| No repair, by design                                  | `A11Y-001` without the owner password, `A11Y-008`, `A11Y-012`, `A11Y-016`                                                            |

The blocked group is small but consequential: `A11Y-003` is the rule that fires on every
untagged document, which is the majority of documents in the world. Until Spike A
resolves, our accessibility report can tell a user their document is untagged and cannot
fix it for them. That limitation is stated in the report rather than discovered.

## What this document does not settle

- **Acrobat's exact internal thresholds are not published.** Where this document states a
  number, such as the 21-page bookmark threshold, it is ours. Differences from Acrobat's
  verdict on the same document are expected and are not necessarily defects in either.
- **PDF/UA-1 and PDF/UA-2 conformance is a separate, larger check** than these 32 rules.
  It is not claimed here, and `CONV-023` and `CONV-024` cover PDF/A rather than PDF/UA.
- **The report's presentation** (grouping, ordering, severity) belongs to
  [`ui-ux.md`](ui-ux.md) and is not specified here.
