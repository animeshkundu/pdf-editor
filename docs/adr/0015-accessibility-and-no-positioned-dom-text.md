# 0015. WCAG 2.2 AA, and no positioned DOM text at all

## Status

Accepted

## Date

2026-07-26

## Context

Every browser PDF viewer built on canvas rendering solves text selection the same way:
it overlays an invisible DOM element per text run, absolutely positioned and scaled to
sit exactly on top of the painted glyphs, and lets the browser's native selection do the
work.

pdf.js has done this for years, and the approach has known, structural problems:

- Thousands of positioned elements per page destroy scroll performance, which is fatal
  under a virtualized pipeline ([ADR 0010](0010-tiled-render-pipeline.md)) whose entire
  point is that scrolling stays cheap.
- Alignment between DOM text and painted glyphs is approximate. It drifts with zoom,
  with font fallback, and with subpixel rounding, so selection highlights sit slightly
  off the glyphs they claim to select.
- The overlay's reading order is the content-stream order, which is frequently not the
  logical reading order. A screen reader following it reads a two-column page across the
  columns.
- The elements are present for sighted users' selection but are also announced, so the
  same content is exposed twice with different fidelity.

Meanwhile MuPDF already produces exactly the data needed to do better. `stext` walking
gives structured text with per-character quads, in the engine's own coordinate space, and
the structure tree gives real logical reading order for tagged documents.

## Decision

**The document surface contains no positioned DOM text.** Selection, highlighting, and
accessibility are three separate mechanisms, each doing one job well.

### Selection

Selection geometry comes from `stext.walk`, which yields per-character quads. Hit testing
maps a pointer position to a character index arithmetically, in document space, without
consulting the DOM. Range selection, word and line snapping, and multi-column behaviour
are computed from the quads.

### Highlighting

Selection highlights, search matches, and annotation highlights paint to a canvas overlay
above the page canvas. Painting a few dozen rectangles per frame is trivially fast and is
pixel-exact against the rendered glyphs by construction, because both come from the same
coordinate space.

### Accessibility

A visually hidden element carries the page text in **logical reading order**, derived
from the structure tree where the document is tagged and from MuPDF's block and line
analysis where it is not. It is a reading surface, not a selection surface. It carries no
positioning, so it costs nothing to lay out.

### Ctrl+F

The browser's own find is intercepted on the document surface and routed to engine
search. Native find cannot work when there is no DOM text, and leaving it to fail
silently would be the worst outcome. Engine search is also better: it searches the whole
document rather than the mounted pages, which is the behaviour a user of a 10,000-page
document actually wants.

### The accessibility target

WCAG 2.2 AA for all editor chrome, and specifically:

- Every command reachable and operable by keyboard alone, in a logical focus order, with
  a visible focus indicator. `:focus-visible` is styled globally in
  `assets/tailwind.css` and must not be removed per-component.
- A skip link to the document pane, one `h1`, and labelled landmarks. These exist in
  `entrypoints/app/EditorShell.tsx` and are asserted in `tests/e2e/shell.e2e.ts`.
- Icon-only controls carry accessible names. Labels accompany icons in the tool rail
  rather than replacing meaning with iconography.
- Errors are announced with `role="alert"`, name the action that failed, and state the
  next step. `LimitError` messages are written to this standard.
- Contrast meets AA in both themes, which are peers rather than a theme and a variant
  ([ADR 0016](0016-density-aware-design-tokens.md)).
- `prefers-reduced-motion: reduce` and `forced-colors: active` are honoured. Both have
  global rules in `assets/tailwind.css`.
- Content reflows at 200% zoom and a 320 px viewport without loss of function.
- Target sizes meet 2.2's requirement, which the touch density mode addresses directly.

## Consequences

### Positive

- Scrolling stays fast because the page surface is canvas, not thousands of elements.
- Highlights are pixel-exact rather than approximately aligned.
- Screen-reader users get logical reading order instead of content-stream order, which is
  a genuine improvement over the standard approach rather than parity with it.

### Negative

- Selection, hit testing, word and line snapping, and drag-select must all be implemented
  rather than inherited from the browser.
- Ctrl+F interception is a browser behaviour override, which has to be done carefully so
  it never traps the key outside the document surface.
- Two representations of the page text exist (quads for selection, ordered text for
  assistive technology) and must be derived from the same source to avoid drift.

### Neutral

- Copy to clipboard is served by the quad model, since the selected character range is
  known exactly. Copy fidelity for ligatures and hyphenation is a separate concern and is
  handled with the `stext` character data rather than by reading the DOM.

## Notes

Related: [ADR 0010](0010-tiled-render-pipeline.md) (why DOM cost matters),
[ADR 0016](0016-density-aware-design-tokens.md) (contrast, density, target size).
Global accessibility rules live in `assets/tailwind.css`; landmark assertions live in
`tests/e2e/shell.e2e.ts`.
