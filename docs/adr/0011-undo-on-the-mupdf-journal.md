# 0011. Undo on MuPDF's journal, not a reinvented command stack

## Status

Accepted

## Date

2026-07-26

## Context

The obvious design for undo in an editor is a command stack: each user action becomes a
command object with `do` and `undo`, and history is a list of those objects.

For a PDF that design is a trap. A single user-visible action ("delete this page")
touches the page tree, the page objects, the resource dictionaries, any annotations,
any structure-tree entries pointing into that page, any outline destinations, and the
cross-reference table. Writing a correct inverse for each of those, for every operation
the product supports, is a large amount of code whose bugs present as silent document
corruption discovered days later.

MuPDF already has an undo journal. It operates at the level of the PDF object graph, it
is what MuPDF's own editing tools use, and it is correct by construction because it
records object-level changes rather than reconstructing intent.

The usual objection to using an engine journal is that the application has its own state
that the engine does not know about, so two mutators exist and neither history is
complete.

That objection does not apply here. [ADR 0005](0005-rust-font-module-scope.md) scopes
the Rust module to a pure function library over font bytes: it takes bytes and a string,
returns glyphs and subset bytes, and **never touches the document**. All document
mutation passes through MuPDF. There is exactly one mutator, so one journal is a complete
history.

## Decision

Undo and redo are MuPDF's journal operations. We do not build a command stack.

- Each user-visible action is bracketed by a journal operation with a human-readable
  name, so the history panel shows "Delete page 4", not an object-level diff.
- Journal position, not an application-side list, is the source of truth for what undo
  and redo will do.
- Operations that must be atomic (a text edit that rewrites a content stream, re-embeds
  a subset font, and updates a resource dictionary) are a single journal operation.
  Partial application is not a state the user can reach.
- An operation that fails mid-way is rolled back to the journal position it started
  from. This composes with the project-assert-then-mutate rule in `lib/core/limits.ts`:
  the cheap failures are refused before any mutation, and the journal covers the rest.
- The Rust module's purity is a **structural invariant**, not a convention. If it ever
  gained the ability to mutate a document, this decision would become unsound and would
  need to be reopened before that capability shipped.

## Consequences

### Positive

- Undo is correct for operations we have not written yet, because it is object-level.
- A large class of corruption bugs never exists.
- The history panel is a projection of engine state rather than a parallel model that
  can drift out of sync with it.

### Negative

- History granularity is whatever the journal gives us. Grouping and naming take
  deliberate bracketing; getting it wrong produces a history that is technically correct
  and unhelpful to read.
- Undo is coupled to the engine. A future engine change would require rebuilding it.
- Journal depth consumes engine memory, so it is bounded like everything else under
  [ADR 0014](0014-resource-ceilings.md).

### Neutral

- Pure view state (zoom, scroll, current page, panel layout) is deliberately outside the
  journal. Undo should not move the viewport, and a user who undoes a deletion expects
  the deletion reversed, not their scroll position restored.

## Notes

Depends on the mutation boundary in [ADR 0005](0005-rust-font-module-scope.md). Text
editing, the most compound operation in the product, is
[ADR 0012](0012-content-stream-text-editing.md).
