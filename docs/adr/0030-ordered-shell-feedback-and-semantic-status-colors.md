# 0030. Order shell feedback and separate semantic status colors

## Status

Accepted

## Date

2026-08-01

## Context

The shell can report loading, recovery, errors, and document-operation results at the same
time. Independent toast and live-region mounts make announcement order and visual priority
dependent on render order. Palette colors also express both a color scale and a user-facing
meaning, which makes status treatment fragile across light and dark themes.

The accessibility contract requires errors to use `role="alert"` and to name the failed action
and next step. The design contract requires components to consume semantic tokens only.

## Decision

The shell has one ordered feedback stack. It receives every transient shell message, renders
one visible item at a time in priority order—error, active cancellable progress, recovery, then
notice—and uses one corresponding live region. Active progress precedes a persistent recovery
offer so the Cancel action for work already underway can never be starved. A replacement message
replaces the current item rather than mounting a competing region. Persistent, in-context
validation remains adjacent to its control and is not promoted to the stack.

Status styling is split into semantic role tokens (success, warning, danger, and information,
with foreground, surface, and border roles) and palette tokens. Components use only the semantic
roles; themes resolve those roles independently. This decision does not change `--page-paper`.

## Consequences

### Positive

- Assistive announcements and visible feedback have a predictable order.
- Error urgency is not diluted by a simultaneous loading or recovery message.
- Status colors remain meaningful in both themes without components depending on a palette.

### Negative

- Feedback producers must supply a message kind and must not mount their own shell toast.
- The stack deliberately serializes transient shell feedback; lower-priority notices may wait.

### Neutral

- Concurrent panels, shortcut remapping, and keyboard text selection are separate interface
  decisions recorded in [ADR 0031](0031-local-interface-state-and-keyboard-selection.md).

## Notes

Related: [ADR 0015](0015-accessibility-and-no-positioned-dom-text.md) and
[ADR 0016](0016-density-aware-design-tokens.md). Production-artifact browser evidence is
recorded in [`../qa/ui-surface-sweep.md`](../qa/ui-surface-sweep.md).
