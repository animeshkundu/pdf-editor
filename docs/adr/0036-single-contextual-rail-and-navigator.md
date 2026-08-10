# 0036. Use one contextual rail and a tabbed Navigator

## Status

Accepted

## Date

2026-08-10

## Context

The previous shell allowed a set of independently sized, collapsed, and persisted panels. That
model exposed several unrelated property surfaces at once and required people arriving from
established PDF editors to learn a new interaction grammar.

## Decision

The shell has one persistent Navigator on the left and one contextual rail on the right. The
Navigator keeps Thumbnails, Outline, Attachments, and Search available through an accessible tab
strip. The right rail shows exactly one active tool or the current selection's properties; a
selection replaces an active tool surface instead of opening a floating toolbar.

Tool commands live in a persistent top command area and use familiar names. Tool selection remains
sticky. Escape first restores Select and Pan, then dismisses contextual properties and returns
focus to the document viewport.

This supersedes ADR 0016's concurrent/resizable panel decision and ADR 0031's stacked contextual
dock description. Existing local panel preferences are read once as a migration input and saved
thereafter as one active tool plus one Navigator tab.

## Consequences

- The document remains the visual center while context stays adjacent and keyboard reachable.
- A person sees only properties relevant to the current selection or tool.
- Navigation remains continuously available without consuming the contextual rail.
- Independent panel width, collapse, and concurrent-open preferences are intentionally retired.
