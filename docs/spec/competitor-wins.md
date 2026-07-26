# Competitor wins

Capabilities taken from tools other than Acrobat. Each one exists here because a specific
product does it better than Adobe does, and because it is reachable entirely on the device.

These are not "nice to have later". They are part of the parity contract, tracked in
[`parity-inventory.md`](parity-inventory.md) alongside the Acrobat features, and they are a
large part of why someone would choose this over Acrobat rather than merely tolerate it.

Behaviour attributed to another product is from its published documentation and from
ordinary use. Items not verified directly are marked **(unverified)**. Nothing here is a
benchmark or a measurement.

---

## Bluebeam: markups as a data table

**What Bluebeam does.** Revu's Markups list is not a list. It is a spreadsheet: sortable
and filterable columns for type, author, date, page, colour, status, subject, comment text,
and user-defined custom columns, with the whole thing exportable to CSV and XML.

**Why it beats Acrobat.** Acrobat's Comments pane is a scrolling stack of cards. It filters
and it sorts, but it does not present comments as _data_. The difference shows up the
moment a document has more than about thirty comments, which is the normal case for any
document under real review. In construction, where Bluebeam won its market, a drawing set
routinely carries hundreds. A reviewer's actual question is almost never "what is the next
comment"; it is "show me every open item from this reviewer on these pages", and a card
stack cannot answer it.

**What we build.**

- The comments panel is a real table with sortable, resizable, reorderable columns.
- Filters compose across type, author, status, colour, page range, and date range, and the
  active filter set is visible and dismissable rather than hidden in a menu.
- Column choice persists per user.
- Export to CSV, alongside the standard XFDF and FDF that keep Acrobat interoperability.
- The table and the document are one selection: selecting a row scrolls to and highlights
  the annotation, and selecting an annotation highlights its row.

**Why it fits.** Comments are already structured data in the PDF. Presenting them as a
stack of cards discards structure the document already has.

---

## Bluebeam: saved, shareable tool sets

**What Bluebeam does.** The Tool Chest holds tools the user configured: a specific arrow
with a specific weight, colour, and dash pattern; a stamp with fixed properties; a
measurement with a preset scale. Those are grouped into named sets, and a set is a file
that can be handed to a colleague so a whole team marks up identically.

**Why it beats Acrobat.** Acrobat has "set as default for the tool", which is one
configuration per tool for one person on one machine. It does not have named sets, and it
does not have a way to share them. Anyone doing repetitive markup rebuilds the same
configurations by hand, and any team doing it collectively fails to agree.

**What we build.**

- A configured tool is a saved, named, reorderable entry, not an overwritten default.
- Tools group into named sets; a set can be active alongside the standard tools.
- A set exports to a plain file the user owns, and imports from one.
- Import shows every tool in the set before adding it. A tool set is only appearance
  configuration, never a script, so importing one is not an execution vector, and keeping
  it that way is a constraint on the format rather than an implementation detail.

**Why it fits.** Entirely local, entirely file-based. It is the collaboration benefit of a
shared review with none of the server.

---

## Sejda: split by text, split in half, and alternate and mix

Three separate operations, all from the same insight: the interesting way to divide a
document is rarely "every N pages".

### Split by text

**What Sejda does.** Split wherever the text at a given position on the page changes. Feed
it a 400-page batch of invoices and it splits into one document per invoice number, without
anyone specifying page counts.

**Why it beats Acrobat.** Acrobat splits by page count, by top-level bookmark, or by file
size. All three assume the document has a structure that matches the split you want.
Concatenated statements, invoices, and payslips have no bookmarks at all, so Acrobat's
answer is to do it by hand.

### Split in half

**What Sejda does.** Cut every page down the middle into two pages.

**Why it beats Acrobat.** Acrobat can crop, but cropping to one half and then to the other
and then interleaving the results is a manual multi-step procedure. Sejda's is one action.
It is exactly what a book scanned two pages at a time needs, which is the common output of
every flatbed and every phone scanning app.

### Alternate and mix

**What Sejda does.** Interleave two documents page by page, optionally reversing one.

**Why it beats Acrobat.** This solves the single most common scanning accident there is: a
sheet-fed scanner that does not do duplex produces a stack of odd pages and a stack of even
pages, the second in reverse order. Acrobat's answer is Insert Pages, once per page.
Sejda's is one operation with a "reverse the second document" checkbox.

**What we build.** All three, in Organize Pages, each with a preview of the resulting
document set before anything is written.

**Why it fits.** All three are page-object operations. None touches a content stream, so
none is affected by the text-editing spikes, and all three are cheap next to the machinery
already required for merge and extract.

---

## Preview: drag to extract and drag to merge

**What Preview does.** Drag a page thumbnail out of the sidebar and drop it in the Finder,
and you get a new PDF of that page. Open two documents side by side, drag thumbnails from
one into the other, and they merge.

**Why it beats Acrobat.** Acrobat's Extract Pages is a dialog with a page range, a "delete
after extracting" checkbox, and a "extract as separate files" checkbox. It is more capable
and much slower, and it requires knowing that the feature is called "extract". Preview's
version requires knowing how to drag. It is the most frequently praised thing about a PDF
tool that is otherwise a viewer, and people migrating from macOS to anything else name its
absence specifically.

**What we build.**

- Drag pages out of the thumbnail panel to the file system, producing a new document. On
  Chromium this uses the File System Access API for a real drop target; elsewhere it
  degrades to a download, announced rather than silently different
  ([`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#equiv-browser-equivalent)).
- Drag pages between two documents open in split view to move or copy them.
- Multi-select before dragging, so it scales past one page without becoming a dialog.
- The dialog-driven Extract and Insert stay, because a 300-page range is not a drag
  gesture. Direct manipulation for the small case, a dialog for the large one.

**Why it fits.** The thumbnail panel is already virtualized with drag-to-reorder. Extending
the drag to cross a document boundary is a small addition on top of machinery that has to
exist anyway.

---

## Edge: the selection action bar

**What Edge does.** Selecting text in Edge's built-in PDF viewer raises a small contextual
bar next to the selection with the actions that apply to it. (Unverified in current
versions; the pattern, not any specific button set, is what is adopted here.)

**Why it beats Acrobat.** In Acrobat, selecting text and then highlighting it means
travelling to a toolbar, picking a tool, and returning. Round trips to a distant toolbar are
the dominant cost of markup work, and they are why people who mark up documents all day
learn the keyboard shortcuts and everyone else finds the product slow.

**What we build.** On selection, a compact bar appears near the selection offering
highlight, underline, strikethrough, copy, add a note, search this phrase in the document,
and redact. It is:

- **Keyboard reachable.** It is a real toolbar in the focus order, not a hover affordance.
  A contextual UI that only a mouse can reach is a contextual UI that excludes people.
- **Non-occluding.** It positions itself off the selection and flips side rather than
  covering the text being acted on
  ([`ui-ux.md`](ui-ux.md#nothing-occludes-the-document)).
- **Dismissable**, by Escape, and it never steals focus from the document.
- **Announced** to assistive technology when it appears, with its own actions labelled.

**Why it fits.** Selection geometry already comes from `stext` quads
([ADR 0015](../adr/0015-accessibility-and-no-positioned-dom-text.md)), so we know exactly
where the selection is and can place the bar precisely. A DOM-overlay viewer has to
approximate this.

---

## Stirling: the no-code pipeline builder

**What Stirling does.** Chain operations into a named pipeline, in the interface, without
writing anything, and run it over a set of files.

**Why it beats Acrobat.** Acrobat's Action Wizard exists and is genuinely capable, but it
is buried, its editor is a modal list, and anything beyond its built-in steps drops to
Acrobat JavaScript. Stirling's is the front door rather than an expert feature, and the
composition is visible: you can see the whole chain at once.

**What we build.**

- A visible chain of steps, each configurable, reorderable by drag, with a preview of the
  result after each step.
- Any operation exposed in the command palette is available as a step, so the pipeline
  surface grows automatically with the product rather than needing separate plumbing.
- Run over one document or a batch of local files.
- A pipeline saves to a plain file the user owns and can hand to someone else.
- **Import shows every step before running anything, and never runs on import.** An
  importable automation format is an execution vector; this is the same constraint applied
  to tool sets, for the same reason.
- Batch runs report per-file success and failure with the reason, and a failure never
  leaves a partially written output claiming to be complete.

**Why it fits.** The command bus already needs a registry of every operation with its
parameters. A pipeline is that registry with a sequence around it.

---

## iLovePDF: PDF to Markdown

**What iLovePDF does.** Export a PDF as Markdown. (Unverified against the current product;
the capability, not any particular output format detail, is what is adopted.)

**Why it beats Acrobat.** Acrobat exports to Word, Excel, PowerPoint, RTF, HTML, plain
text, and images. Markdown is not on the list, and it is now the format people most often
want a document in: notes, wikis, static sites, version-controlled documentation, and
anything being fed to a text pipeline. Plain text loses every heading, list, and table.
HTML keeps them and is unpleasant to work with by hand.

**What we build.** Markdown export that uses the structure tree where the document is
tagged: headings become `#` levels, lists become lists, tables become pipe tables, and
figures become image references with their alternate text as the alt attribute. Where the
document is untagged, block analysis produces a best effort and the export says which mode
it used.

**Why it fits.** The structure tree is already required for reading order
([ADR 0015](../adr/0015-accessibility-and-no-positioned-dom-text.md)) and for the
accessibility tooling. Markdown is close to the cheapest thing to derive from it, and the
same machinery serves HTML export.

---

## Xodo: PDF/A validation as a first-class tool

**What Xodo does.** PDF/A validation is a visible tool with its own entry point.
(Unverified in current versions.)

**Why it beats Acrobat.** Acrobat can validate PDF/A, inside Preflight, which is a large,
professional, prepress-oriented tool with hundreds of profiles. Someone who needs to know
whether a document will be accepted by a court filing system, a research archive, or a
records retention policy does not need a prepress product. They need one answer. Burying
that answer inside a specialist tool means most people who need it never find it, and PDF/A
is exactly the kind of requirement imposed on people who are not PDF specialists.

**What we build.** PDF/A validation as its own command: pick a conformance level, get a
pass or fail, and get every violation linked to the object that caused it. Where a
violation is automatically repairable, offer the repair explicitly and show what it will
change. Conversion to PDF/A is a separate command, so checking is never confused with
altering.

**Why it fits.** The validation surface overlaps heavily with the accessibility checker:
both walk the object graph applying rules and report violations against specific objects.
One reporting model serves both.

---

## A command palette, which Acrobat lacks entirely

**What is missing from Acrobat.** There is no command palette. Acrobat has roughly forty
single-key accelerators, gated behind a preference that is off by default (unverified
whether the default has changed in recent versions), plus a deep menu tree and a
context-switching tool rail. Finding a command you have not used before means knowing which
of several menus contains it, or knowing that it lives inside a tool that must be entered
first.

**Why this matters more here than it would elsewhere.** This inventory has several hundred
items. A menu tree over that many commands is a memory test. Every serious tool built in
the last decade, in editors, design tools, and issue trackers, converged on the same
answer: let people type the name of the thing they want.

**What we build.**

- One shortcut opens it. Every command in the product is reachable by name.
- Fuzzy matching over both the command name and its aliases, so "rotate" finds both the
  view rotation and the page rotation, and both say which is which.
- The keyboard shortcut for a command is shown next to it, so the palette teaches the
  shortcuts rather than replacing them.
- Recent and frequent commands surface first.
- Commands unavailable in the current context appear disabled with the reason stated, not
  hidden. Hiding them is why people conclude a feature does not exist.
- Parameterised commands accept their argument inline: "go to page 214", "zoom 175".
- It is the automation surface too. Every palette command is a pipeline step, which keeps
  the two from drifting apart.

**Why it fits.** [ADR 0015](../adr/0015-accessibility-and-no-positioned-dom-text.md)
already requires every command to be keyboard reachable. A command registry is the natural
way to satisfy that, and once the registry exists, the palette is a view onto it.

---

## What is deliberately not taken

- **AI summarisation and chat over the document**, offered by Acrobat, Edge, and most web
  tools. Every implementation sends the document somewhere. This one is excluded by
  [ADR 0002](../adr/0002-client-side-only-zero-egress.md), not by preference.
- **Server-side compression services**, which achieve their results with processing budgets
  a browser tab does not have. Our optimizer is local and reports honestly what it achieved.
- **Sejda's and iLovePDF's hosted batch processing.** The operations are taken; the hosting
  is not.
