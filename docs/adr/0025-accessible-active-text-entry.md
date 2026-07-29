# 0025. One accessible active text-entry owner

## Status

Accepted

## Date

2026-07-27

## Context

Canvas-rendered form fields, comments, and annotation overlays need caret, selection,
clipboard, IME, and bidirectional input semantics without adding positioned DOM text for
page content.

## Decision

While editing, one visually hidden focusable text control owns the input value, caret,
selection, clipboard events, composition state, direction, commit, and cancellation. Canvas
paints the visible editing affordance from that state. The control is labelled for its role
(form field, comment, or overlay), contains only the active value, and is removed after
commit or cancellation. It is an input owner, not a duplicate representation of rendered
page text.

Escape cancels composition or editing before returning to the default tool. Single-key tool
accelerators are disabled while this owner is active.

## Consequences

Browser and assistive-technology input semantics remain available while the no-positioned-
DOM-text invariant stays intact. Caret painting and hit testing remain canvas responsibilities.
