# PDF Editor design

Acrobat's mental model, executed better. The layout is deliberately familiar because that
is the model people arriving from Acrobat already have; everything about how it behaves is
deliberately not.

The design decisions are recorded in
[ADR 0016](adr/0016-density-aware-design-tokens.md); this document is the working
narrative.

## The token system

Two tiers, in `assets/tailwind.css`.

**Palette** lives in the Tailwind `@theme` block: an ink ramp from 50 to 950, plus accent,
danger, warning, and success. Components never reference it.

**Semantic** tokens are named by role: `--surface-canvas`, `--surface-chrome`,
`--surface-raised`, `--surface-sunken`, `--border-subtle`, `--border-strong`,
`--text-primary`, `--text-secondary`, `--text-disabled`, `--accent`, `--accent-hover`,
`--focus-ring`, `--page-paper`, `--page-shadow`. Components reference only these.

A raw hex value in a component is a bug. It is invisible until someone switches theme or
density, which is exactly what makes it worth catching in review.

## Density

`data-density` on `<html>` selects `compact`, `comfortable` (default), or `touch`. One
semantic name resolves to three values.

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

A component writes `height: var(--row-height)` and is correct in all three. No conditional
CSS, no density prop, no variant explosion.

This exists because of a specific failure. Acrobat's 2023 redesign imposed touch spacing
on desktop power users and gave them no way back, and it is still the loudest complaint
about the product. Density belongs to the user, and it can belong to the user only if it
costs nothing at the component level.

`touch` satisfies WCAG 2.2 target sizing. `compact` gives back the density Acrobat took
away. `tests/e2e/shell.e2e.ts` asserts that `--row-height` genuinely changes with
`data-density`, which is the guard against the token layer being quietly bypassed.

## Light and dark as peers

`data-theme="dark"` redeclares the semantic layer with values chosen for a dark surface.
It is not an inversion and not a filter. Reading a long document in a dark room is a
primary use case, and a dark theme derived mechanically from a light one looks wrong in
exactly the places that matter for that use.

`--page-shadow` is redeclared too, because a shadow tuned for a light canvas vanishes on a
dark one.

**`--page-paper` stays white in dark mode.** The PDF's own media box defines the paper.
Tinting it misrepresents the document, and a user who cannot tell whether they are looking
at the document or at a transformation of it has lost something important. A night-reading
filter is a separate, explicitly opt-in view mode.

## Motion

| Token           |                          Value |
| --------------- | -----------------------------: |
| `--motion-fast` |                          120ms |
| `--motion-base` |                          150ms |
| `--motion-slow` |                          180ms |
| `--ease-out`    | `cubic-bezier(0.4, 0, 0.2, 1)` |

The whole range is 120 to 180 ms, with ease-out, because motion here does one job: showing
that a panel opened, or that a menu came from a particular control. Below 120 ms that
relationship does not read. Above 180 ms it delays someone who already knows what they
asked for.

Motion is never decorative, and nothing animates between the user and their document. A
global `prefers-reduced-motion: reduce` rule collapses every duration to effectively zero.

## Focus

`:focus-visible` gets a 2 px `--focus-ring` outline at 2 px offset, declared once,
globally. Under `forced-colors: active` it becomes `Highlight`.

Components do not remove it and do not replace it with something subtler. There is no
design in which the focus ring is an acceptable casualty, and a keyboard user who cannot
see where they are has no product at all.

## Layout

Acrobat's arrangement:

- a **global bar** across the top,
- a **left tool rail**,
- the **document pane**,
- a **right contextual panel**.

Executed differently in five specific ways.

### 1. Labels accompany icons

An icon-only rail requires memorising a vocabulary the user did not choose. Icons are
recognition aids next to a word, not a replacement for one.

### 2. Panels are resizable and can be open together

Acrobat's panels are modal about what you are doing: pick a task, get its panel, lose the
others. Ours are concurrent and sized by the user, because real work crosses tasks.

### 3. Nothing occludes the document

No floating toolbar, no panel over the page, no overlay that must be dismissed to see what
is underneath. `--surface-canvas` recedes and `--page-paper` advances. The document is the
hero.

### 4. A command palette

Every command reachable by name, from the keyboard, without knowing which menu holds it.
For a tool with hundreds of commands this is not a convenience feature; it is the
difference between a discoverable product and one you have to be trained on.

### 5. Real focus states everywhere

Not an accessibility checkbox. Visible focus is what makes keyboard operation feel
designed rather than tolerated.

## The document surface

There is no positioned DOM text
([ADR 0015](adr/0015-accessibility-and-no-positioned-dom-text.md)). Pages are canvas,
tiled at 512 px ([ADR 0010](adr/0010-tiled-render-pipeline.md)). Selection highlights,
search matches, and annotation highlights paint to a canvas overlay, so they are
pixel-exact against the glyphs rather than approximately aligned, and scrolling stays fast
because there is nothing to lay out.

## States

Every long operation shows text progress and an explicit way to stop. Cancelling leaves
durable state exactly as it was.

Errors name the action that failed, state the limit or condition that caused it, and give
the next step, in `role="alert"`. `LimitError` messages in `lib/core/limits.ts` are
written to this standard: "This file is 612 MB. The limit on this device is 512 MB" rather
than a code.

Empty panels explain what would appear there and how to get it, without implying a feature
that does not exist.

Disabled controls carry an adjacent explanation. A control that is disabled for a reason
the user cannot see is indistinguishable from a broken one.
