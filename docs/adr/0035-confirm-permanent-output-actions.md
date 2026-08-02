# 0035. Confirm permanent output actions at the point of use

## Status

Accepted

## Date

2026-08-02

## Context

Redaction and sanitizing can permanently remove content from a full rewritten output. The prior
confirmation appeared only when signatures existed, so an unsigned document placed permanent
removal one click away while a signed document received the safer flow.

## Decision

Every redaction-apply and sanitize surface requires an explicit keyboard-operable acknowledgement
for every document. The copy names the exact removed scope, states that the full output is not
recoverable through Undo, advises keeping an untouched copy, and additionally names the number
of signatures invalidated when nonzero.

The confirmation is action-specific; acknowledging redaction does not enable sanitize.

## Consequences

Permanent output takes one deliberate step on unsigned documents as well as signed ones. The
extra friction is accepted because the alternative is an irreversible one-click mistake.

## Notes

Implemented in the Markup and Protect panels and covered at unit and production-browser
boundaries.
