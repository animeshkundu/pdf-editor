# UI and UX specification

Acrobat's mental model, executed better.

The layout is deliberately familiar, because that is the model people arriving from Acrobat
already have and there is no value in making them learn a new one. Everything about how it
behaves is deliberately not Acrobat's, and this document says exactly where and why.

Design tokens, density values, motion timings, and focus treatment live in
[`../DESIGN.md`](../DESIGN.md) and are referenced, not restated.

## The five rules

Acrobat's documented failures are our requirements. These five override any local design
argument.

1. **Always label icons.** An icon-only control requires memorising a vocabulary the user
   did not choose. Icons are recognition aids beside a word, never a replacement for one.
2. **Every panel is resizable, closable, and openable alongside every other panel.**
   Acrobat's panels are modal about what you are doing: pick a task, get its panel, lose the
   others. Real work crosses tasks.
3. **Nothing occludes the document.** No floating toolbar over the page, no panel covering
   it, no overlay that must be dismissed to see what is underneath.
4. **Scroll jank is a P0 bug.** Not a performance nice-to-have. A PDF viewer that stutters
   while scrolling has failed at its primary job, and the whole render architecture
   ([ADR 0010](../adr/0010-tiled-render-pipeline.md)) exists to prevent it.
5. **Every command is reachable by name and by keyboard.** No command exists only as a
   toolbar button.

---

## Chrome layout

Four regions, in Acrobat's arrangement.

```
+--------------------------------------------------------------+
|  Global bar                                                   |
+------+------------------------------------------+------------+
| Tool |                                          | Contextual |
| rail |            Document pane                 |   panel    |
|      |                                          |            |
+------+------------------------------------------+------------+
|  Status bar                                                   |
+--------------------------------------------------------------+
```

### Global bar

Document title, open and save, undo and redo, the command palette entry, the density and
theme controls, and the document-level indicators: unsaved changes, memory pressure,
signature status, and permission restrictions.

It uses `--surface-chrome` and `--row-height`, so its height follows density
([`../DESIGN.md`](../DESIGN.md#density)).

The palette entry is a visible control showing its shortcut, not a hidden keystroke. A
palette nobody discovers is a palette nobody uses.

### Tool rail

Tool families, vertically, each with an icon **and a label**. Width is `--rail-width`, which
is 48, 56, or 64 px by density.

A family with more than one tool shows that it does, and its members are reachable by
clicking the family or by pressing its key repeatedly (see
[The keyboard model](#the-keyboard-model)).

The rail never becomes icon-only. If a density cannot fit labels, that is a bug in the
density values, not a reason to drop the labels.

### Document pane

The hero. `--surface-canvas` behind, `--page-paper` for the page, `--page-shadow` beneath
it. Canvas only: no positioned DOM text anywhere
([ADR 0015](../adr/0015-accessibility-and-no-positioned-dom-text.md)).

### Contextual panel

Right side, resizable by drag, closable, and able to hold several panels at once, stacked
and independently collapsible. Which panels are open persists per document.

Panels: comments, thumbnails, bookmarks, attachments, layers, signatures, tags, search
results, and the accessibility report.

### Status bar

Page position with page labels, zoom, page-layout controls, memory pressure when it is not
`ok`, and the current tool with a hint about how to leave it.

### Nothing occludes the document

Panels take space from the document pane; they never sit on top of it. When a panel opens,
the document reflows and the current page stays anchored, so nothing the user was reading
moves out from under them.

The three exceptions, each bounded:

- **The command palette**, which is modal by nature, centred, dismissed by Escape.
- **The selection action bar**, which positions off the selection and flips side rather than
  covering the text it acts on
  ([`competitor-wins.md`](competitor-wins.md#edge-the-selection-action-bar)).
- **Dialogs**, which are for destructive confirmations and multi-field configuration only.
  Anything that can be a panel is a panel.

Tooltips and menus are not exceptions: they are transient, dismissed on Escape, and never
cover the point being acted on.

---

## The tool-switching model

Acrobat's model is "enter a tool, do the thing, leave the tool", and the pain is that
leaving is often unclear, so people end up in a tool wondering why clicking does something
unexpected.

Our rules:

- **The current tool is always visible**, named in the status bar and marked in the rail.
- **Escape always returns to the default tool.** Always, from every tool, with no exception.
  One key that reliably gets you back is worth more than any amount of mode indication.
- **The default tool is a combined select and pan.** Dragging on text selects it, dragging
  on empty space pans, and space held down forces pan. Two of the most common actions in a
  document viewer should not require choosing between two tools.
- **Sticky and one-shot are both available.** Clicking a tool uses it once and returns to
  default. Double-clicking, or holding a modifier, keeps it. Marking up twenty passages and
  placing one arrow are different jobs, and Acrobat forces a preference setting to choose
  between them.
- **A tool's options appear in the contextual panel**, not in a bar that pushes the document
  down. The document must not move because a tool was selected.
- **Entering a tool never changes the view.** No auto-zoom, no scroll, no layout change.

---

## The comment workflow, end to end

The single most common serious use of a PDF tool, and the one where Acrobat's round trips
cost the most.

### 1. Create

Three routes, all first-class:

- **From a selection.** Select text, use the action bar, done. No toolbar trip.
- **From the rail.** Pick the tool, mark up the page. Sticky if you double-clicked.
- **From the keyboard.** The tool's key, then draw. With text already selected, the key
  applies the markup directly.

Creation is optimistic: the annotation appears immediately and the comment body can be typed
straight away, without a dialog appearing first.

### 2. Configure

The tool's options sit in the contextual panel: colour, opacity, weight, style, endings, and
font. Changing an option with an annotation selected changes that annotation. Changing it
with nothing selected sets the tool default for next time. The panel says which of the two
is happening, because guessing wrong is the most common annotation-tool frustration there
is.

**Save as a tool** turns the current configuration into a named, reusable tool
([`competitor-wins.md`](competitor-wins.md#bluebeam-saved-shareable-tool-sets)) rather than
silently overwriting a default.

### 3. Review

The comments panel is a **table**, not a card stack
([`competitor-wins.md`](competitor-wins.md#bluebeam-markups-as-a-data-table)): sortable
columns, composing filters that are visible and dismissable, and column choice that
persists.

Selection is unified in both directions. Clicking a row scrolls to the annotation and
highlights it; clicking an annotation selects its row. There is one selection, not two that
drift apart.

### 4. Respond

Replies thread under their parent. Status (accepted, rejected, cancelled, completed) is set
from the row or from the annotation, and it is written to the document so Acrobat sees it.
The private checkmark is local and is visibly marked as local, so nobody mistakes it for
something the recipient will see.

### 5. Export

- Comment summary as a document, for printing.
- XFDF and FDF, for Acrobat.
- CSV, for the spreadsheet the review actually lives in.

Every export states what it includes and what it drops before it runs.

### Throughout

- Every annotation is a real PDF annotation, written to the document. Nothing is a private
  overlay.
- Every operation is one journal entry, so undo is per-action
  ([ADR 0011](../adr/0011-undo-on-the-mupdf-journal.md)).
- Appearance streams regenerate on change, so an annotation looks the same in every viewer.

---

## Organize Pages

A dedicated mode, because manipulating pages and reading them want different layouts.

### Layout

The document pane becomes a grid of page thumbnails at a size the user controls. The
contextual panel holds the page operations. Thumbnails are virtualized and positioned by the
same prefix-sum layout as the reading view, so a 10,000-page document opens instantly
([ADR 0010](../adr/0010-tiled-render-pipeline.md)).

### Direct manipulation first

- **Drag to reorder**, with a clear insertion indicator between pages rather than a
  highlighted target page. Where the page will land must be unambiguous.
- **Multi-select** by click, shift-click for a range, and marquee.
- **Drag out to extract**, producing a new document
  ([`competitor-wins.md`](competitor-wins.md#preview-drag-to-extract-and-drag-to-merge)).
- **Drag between two documents** in split view to move or copy.
- **Rotate, delete, and duplicate** from hover controls on the thumbnail, sized to the
  density's target size.

### Dialogs for the large case

Direct manipulation does not scale to a 300-page range, so Insert, Extract, Replace, Split,
and Merge keep their dialogs. Every one previews the resulting document set before writing
anything.

Split includes split by text, split in half, and alternate and mix
([`competitor-wins.md`](competitor-wins.md#sejda-split-by-text-split-in-half-and-alternate-and-mix)),
presented alongside split by page count and by bookmark rather than hidden behind an
"advanced" disclosure.

### Two rotations, never confused

Rotating the **view** and rotating the **page** are different operations with different
outcomes, and conflating them is the classic source of "my rotation did not save". They live
in different places (view rotation in the reading view, page rotation here), they are named
differently, and page rotation shows that it modifies the document.

---

## Prepare Form

### Layout

Fields render as overlays on the page with their type and name visible. The contextual panel
holds the field list; the properties panel holds the selected field's configuration.

### The field list is a table

Name, type, page, required, tab index, and whether it has format, validate, or calculate
logic. Sortable and filterable, for the same reason the comments panel is: a real form has
sixty fields and a scrolling list cannot answer "which fields are required and have no
validation".

### Creating fields

- Draw a field of the chosen type directly on the page.
- Align, distribute, and match size across a multi-selection. Forms are grids, and doing
  that by hand is the slowest part of form authoring.
- Duplicate across pages, for fields that repeat.
- **Auto-detect** produces a **proposal**: detected fields appear in a distinct state, with
  accept-all, reject-all, and per-field controls. Nothing is committed until the user says
  so. Detection is heuristic in every tool including Acrobat's, and applying a heuristic
  silently is how forms end up subtly wrong.

### Properties

Tabs for general, appearance, options, actions, format, validate, and calculate, matching
Acrobat's organisation because it is genuinely well-factored and users know it.

Calculate offers sum, product, average, minimum, and maximum, plus simplified field notation
and full JavaScript. A calculation error is reported in the panel with the field named, not
swallowed.

### Tab order

Its own view: the order drawn on the page as a numbered path. Reorder by dragging the path
or by editing the numbers. Tab order is an accessibility requirement
([`parity-inventory.md`](parity-inventory.md#page-content-9)) and it is invisible in every
tool that does not draw it.

### Test mode

Switch to filling the form without leaving the authoring context, so calculations and
validations can be exercised immediately. Returning to authoring restores the design state,
and test-mode values are never written to the document.

---

## The keyboard model

Acrobat's core pattern is genuinely good and is adopted wholesale: **one key selects a tool
family, and Shift plus that key cycles within the family.** It means a small, learnable key
set covers a large tool set, and it is why people who use Acrobat all day are fast in it.

Two things about Acrobat's implementation are not adopted.

**Single-key accelerators are on by default.** In Acrobat they are behind a preference that
is off by default (unverified whether recent versions changed this), which means the best
thing about its keyboard model is invisible to most users. Ours are on, discoverable in the
palette and in tooltips, and switchable off for anyone who wants plain typing.

**Escape is absolute.** It always returns to the default tool, from every tool and every
mode, with no exception.

### Structure

| Layer                | Binding style                                                | Examples                                  |
| -------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| Tool families        | Single key                                                   | Select, hand, markup, shapes, forms       |
| Within a family      | Shift plus the same key                                      | Cycle highlight, underline, strikethrough |
| Application commands | Ctrl or Cmd plus key                                         | Open, save, print, find, undo, redo       |
| View                 | Ctrl or Cmd plus key, and single keys for zoom modes         | Fit page, fit width, actual size          |
| Navigation           | Arrows, Page Up and Down, Home and End, and Ctrl plus arrows | Page and view movement                    |
| Everything else      | The command palette                                          | Every command, by name                    |

The concrete key assignments are defined once in the command registry, exported to the
palette and to every tooltip, and are not duplicated here. A key list in prose drifts from
the code within one release.

### Rules

- **The registry is the single source of truth.** A command's shortcut is declared with the
  command. There is no second list.
- **Every shortcut is visible** in the palette and in the tooltip of the control it drives.
  The palette's job is partly to teach the shortcuts.
- **Nothing is keyboard-only or mouse-only.** Every command has both routes.
- **Single-key accelerators never fire while a text field has focus.** Typing "h" into a
  comment must type "h".
- **Focus order follows visual order**, and every focusable element shows a visible focus
  ring ([`../DESIGN.md`](../DESIGN.md#focus)).
- **Focus is trapped only in modals**, and released on Escape.
- **A skip link reaches the document pane**, which is itself focusable and scrollable by
  keyboard.
- **Shortcuts are remappable**, stored locally, exportable, and resettable. A user with a
  non-US keyboard layout or a motor impairment must not be locked into ours.

---

## States

### Progress

Any operation that can exceed roughly 200 ms shows text progress with a real estimate where
one is available, and an explicit cancel. Cancelling leaves durable state exactly as it was
and releases everything the operation allocated
([ADR 0009](../adr/0009-wasm-memory-and-handle-discipline.md)).

Progress is text, not a spinner alone. "Rendering page 340 of 1,200" tells someone whether to
wait; a spinner does not.

### Errors

Errors appear near the action that failed, in `role="alert"`, and they name the action, the
reason, and the next step. `LimitError` messages in `lib/core/limits.ts` are written to this
standard: "This file is 612 MB. The limit on this device is 512 MB", not a code.

An error never leaves the document in a state the user did not ask for. The
project-assert-then-mutate rule ([ADR 0014](../adr/0014-resource-ceilings.md)) guarantees a
rejection arrives before any mutation.

### Memory pressure

`warn` shrinks caches quietly and shows an indicator in the status bar. `critical` refuses
new non-essential work with an explanation and a suggested action. The user should meet a
clear refusal long before the engine meets a hard abort.

### Worker crash

A crashed document worker is presented as a recoverable condition, because it is one
([ADR 0008](../adr/0008-worker-topology-and-crash-isolation.md)): the document is marked
crashed, other documents keep working, and recovery from the last durable state is offered
explicitly. It is never presented as an application failure, and it never silently reloads.

### Empty states

An empty panel says what would appear there and how to get it. It never implies a capability
that does not exist.

### Disabled controls

A disabled control carries an adjacent explanation. A control disabled for a reason the user
cannot see is indistinguishable from a broken one. This applies especially to
permission-restricted operations: "Copying is not permitted by this document" rather than a
control that does nothing.

### Capability disclosure

Every `DEGRADED` feature discloses at the point of use, before the user commits, not in a
help page ([`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md#degraded-reachable-but-worse-and-said-so)).
Every `EXCLUDED` feature has an answer where a user would look for it, naming the reason,
rather than being absent without explanation.
