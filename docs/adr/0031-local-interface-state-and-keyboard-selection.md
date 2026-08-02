# 0031. Keep interface preferences local and map keyboard selection to engine quads

## Status

Accepted

## Date

2026-08-01

## Context

ADR 0015 prohibits positioned DOM text, while the keyboard contract requires text selection
without a pointer. ADRs 0016 and 0022 also require concurrent panels, user-owned panel sizing,
and remappable shortcuts. These preferences must survive a reload without creating an account,
server, or document mutation.

## Decision

Keyboard selection starts from the visually hidden logical reading-order text, extends or
contracts by word, and maps that exact text back to engine search quads. The existing canvas
overlay paints those quads and the existing selection action bar receives the same
`TextSelection` shape as pointer selection. No positioned or focusable text spans are added.

The open panel set, collapsed state, and user-selected widths are stored in `localStorage` under
a document-name key. Shortcut remapping is stored in a separate application key, is editable
from the command palette, and can be reset, exported, or imported. Invalid local state is
refused with a visible message and safe defaults; it is never sent off-device.

Contextual panels share one right-side dock. They are stacked, independently collapsible and
closable, and resize from a labelled separator target. Narrow viewports use the same open set in
a vertical dock and suppress width dragging because the panel must occupy the available width.

## Consequences

### Positive

- Keyboard and pointer selection converge on one quad and canvas-overlay model.
- Panel and shortcut preferences survive reload without entering the PDF or recovery journal.
- Multiple work surfaces remain available without occluding the document.
- Corrupt preference data cannot prevent a document from opening.

### Negative

- A repeated filename shares panel layout even when the files have different contents.
- Keyboard selection depends on exact local search mapping and reports a refusal when geometry
  cannot be recovered.
- `localStorage` can be disabled or cleared by the browser, so persistence is best effort and
  failures must stay visible.

### Neutral

- Document bytes and document mutations remain worker-owned.
- `--page-paper`, density values, zero egress, and the no-positioned-DOM-text rule are unchanged.

## Notes

Related: [ADR 0015](0015-accessibility-and-no-positioned-dom-text.md),
[ADR 0016](0016-density-aware-design-tokens.md), and
[ADR 0022](0022-command-registry.md).
