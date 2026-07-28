# 0024. Redaction marks do not imply content removal

## Status

Accepted

## Date

2026-07-27

## Context

Redaction annotations are interoperable marks, but selective apply-redaction is withdrawn by
ADR 0020. Saving a marked file as though it were safe would be a security failure.

## Decision

`SIGN-028` through `SIGN-030` create and edit redaction marks only. Ordinary Save, Export,
and Print are blocked while unapplied marks exist. The user may remove the marks, run
`SIGN-032` wholesale page removal, run `SIGN-033` sanitize, or choose the separately named
"Export redaction marks for external workflow" action after a warning. That output never
claims content was removed.

`SIGN-032` and `SIGN-033` force full, non-incremental, garbage-collecting output and sweep
their enumerated scope or refuse before mutation. A signed document requires confirmation
that the rewrite invalidates existing signatures.

## Consequences

Marking remains useful and interoperable without being mislabeled as protection. There is no
generic "Apply redactions" command.
