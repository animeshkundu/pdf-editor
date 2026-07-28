# 0022. One command registry

## Status

Accepted

## Date

2026-07-27

## Context

Duplicating command definitions across buttons, the palette, keyboard handlers, and
automation makes shortcuts and disabled states drift.

## Decision

One registry owns each command's stable id, parity id, honesty label, title, shortcut,
availability, disabled reason, and invocation. Visible controls, the palette, remapping,
export, and automation pipelines project from that registry. Imported pipelines are parsed
and previewed but never executed on import. Single-key accelerators are suppressed while a
text-entry owner is active, and Escape always returns to the default tool.

## Consequences

Commands become test-enumerable and disabled reasons stay consistent. Context is supplied at
invocation time rather than captured in a parallel command stack.
