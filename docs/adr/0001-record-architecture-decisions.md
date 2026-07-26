# 0001. Record architecture decisions

## Status

Accepted

## Date

2026-07-26

## Context

animeshkundu/pdf-editor is built on a small number of decisions that are expensive to
reverse and non-obvious from the code: a forked WASM engine, a three-language
toolchain, a rendering pipeline shaped around an upstream API that cannot be cancelled,
and a licence obligation that follows from the engine choice. Several of these were
settled only after reading third-party source directly, because the published
documentation described capabilities the shipped build does not have.

Without durable records, a future contributor reading only the code would see the
workarounds and not the constraints that forced them, and would be very likely to
"simplify" one of them back into a bug.

## Decision

Record significant architecture and long-lived process decisions as ADRs under
`docs/adr/`, in Nygard style, using `docs/adr/0000-template.md`.

Number them sequentially and never renumber. An ADR is amended in place only for
clarification; a change of direction is a new ADR that supersedes the old one, and the
old one's Status is updated to point at it.

Where an ADR is enforced by code, name the enforcing file in the ADR and name the ADR
in the enforcing file. Several already exist: `eslint.config.js` cites ADR 0009,
`vite.web.config.ts` cites ADR 0013, and `scripts/build-wasm.mjs` cites ADR 0004.

## Consequences

### Positive

- The reasoning behind each non-obvious constraint survives contributor turnover.
- A reviewer can check a diff against a stated contract instead of against taste.
- Agents starting from a cold context have a canonical place to read the constraints.

### Negative

- A decision with lasting consequences costs a short documentation step in the same
  pull request that implements it.

### Neutral

- Routine implementation detail does not need an ADR. Reserve records for decisions
  that are costly to reverse or that a reasonable person would otherwise undo.

## Notes

The full set is indexed from [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
