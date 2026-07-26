# 0016. A density-aware, two-tier design token system

## Status

Accepted

## Date

2026-07-26

## Context

Acrobat's 2023 redesign imposed a touch-first spacing scale on desktop power users with
no way back. It remains the loudest complaint about the product: people who spend all day
in a document tool lost roughly a third of their vertical information density overnight,
and no preference restored it.

The mistake was not the touch scale. Touch targets are a real accessibility requirement,
and WCAG 2.2 raised the bar. The mistake was treating density as a fixed decision baked
into every component.

The same class of mistake shows up in dark mode. When dark is derived from light by
inversion or by a filter, it looks wrong in exactly the places that matter for long-form
reading. Dark is not a variant of light; it is a peer.

## Decision

Two tiers of tokens, and density lives in the token layer.

### Tier 1: palette

Raw values, declared in the Tailwind `@theme` block in `assets/tailwind.css`. An ink
ramp from 50 to 950, accent, danger, warning, and success. **Components never reference
palette tokens.**

### Tier 2: semantic

Named by role, not by value: `--surface-canvas`, `--surface-chrome`, `--surface-raised`,
`--surface-sunken`, `--border-subtle`, `--border-strong`, `--text-primary`,
`--text-secondary`, `--text-disabled`, `--accent`, `--accent-hover`, `--focus-ring`,
`--page-paper`, `--page-shadow`. Components reference only these.

This is the lesson from Adobe Spectrum, applied more strictly than Acrobat applies it.

### Density is a token, not a component concern

`data-density` on `<html>` selects among `compact`, `comfortable` (default), and `touch`.
One semantic name resolves to three values:

| Token              |   compact | comfortable |     touch |
| ------------------ | --------: | ----------: | --------: |
| `--row-height`     |      32px |        40px |      48px |
| `--control-height` |      26px |        32px |      44px |
| `--rail-width`     |      48px |        56px |      64px |
| `--space-100`      |       4px |         8px |      12px |
| `--space-200`      |       8px |        12px |      16px |
| `--space-300`      |      12px |        16px |      20px |
| `--space-400`      |      16px |        24px |      32px |
| `--text-ui`        | 0.8125rem |    0.875rem | 0.9375rem |

A component that writes `height: var(--row-height)` is correct in all three modes and
contains no conditional CSS. Switching density costs nothing at the component level,
which is the whole point: it is why we can offer the switch at all, and why Acrobat
could not.

`touch` satisfies WCAG 2.2 target sizing on tablets. `compact` gives desktop power users
back the density Acrobat took away.

### Light and dark are peers

`data-theme="dark"` redeclares the semantic layer with values chosen for a dark surface,
not derived from the light ones. Long-form document reading in a dark room is a primary
use case, and dark-only or light-only both fail someone.

`--page-paper` deliberately stays white in dark mode. The PDF's own media box defines
the paper, and tinting it misrepresents the document. A night-reading filter that inverts
or warms the page is a separate, explicitly opt-in view mode, so a user always knows
whether they are looking at the document or at a transformation of it.

`--page-shadow` is redeclared for dark, because a shadow tuned for a light canvas
disappears on a dark one.

### Motion

`--motion-fast: 120ms`, `--motion-base: 150ms`, `--motion-slow: 180ms`, all with
`--ease-out: cubic-bezier(0.4, 0, 0.2, 1)`.

The range is 120 to 180 ms because motion here is functional feedback: it tells you a
panel opened or a menu came from a particular control. Below 120 ms the relationship does
not read; above 180 ms it delays a user who already knows what they asked for. Motion is
never decorative and never sits between a user and their document. A global
`prefers-reduced-motion: reduce` rule collapses every duration.

### Focus

`:focus-visible` gets a 2 px `--focus-ring` outline with a 2 px offset, declared once
globally. Under `forced-colors: active` it becomes `Highlight`. Components do not remove
it, and there is no design in which a focus ring is an acceptable casualty.

### The layout

Acrobat's mental model, because that is the model users arriving from Acrobat already
have: a global bar, a left tool rail, the document pane, and a right contextual panel.

Executed differently in four specific ways:

1. **Labels accompany icons.** Icon-only rails require memorisation of a vocabulary the
   user did not choose.
2. **Panels are resizable and can be open simultaneously.** Acrobat's are modal about
   what you are doing.
3. **Nothing occludes the document.** No panel or toolbar floats over the page. The
   document is the hero and chrome recedes, which is what `--surface-canvas` against
   `--page-paper` is for.
4. **A command palette.** Every command reachable by name. A tool with hundreds of
   commands must not require knowing which of eight menus holds the one you want.

## Consequences

### Positive

- Density becomes a user preference rather than a design decision imposed on everyone.
- Dark mode is genuinely designed rather than derived.
- Theming, contrast fixes, and density work happen in one file.

### Negative

- Contributors must resist writing raw values, and a stray hex code in a component is
  invisible until someone switches theme or density.
- Every new component has to be checked in three densities and two themes, which is six
  states rather than one.

### Neutral

- The three density modes are exercised in `tests/e2e/shell.e2e.ts`, which asserts that
  `--row-height` actually changes with `data-density`. That test is the guard against
  the token layer quietly being bypassed.

## Notes

Implemented in `assets/tailwind.css`. Default density is set on `<html>` in
`web/index.html`. Accessibility requirements are
[ADR 0015](0015-accessibility-and-no-positioned-dom-text.md). Fuller design narrative is
in [`../DESIGN.md`](../DESIGN.md).
