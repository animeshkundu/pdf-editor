# 0014. Resource ceilings

## Status

Accepted

## Date

2026-07-26

## Context

wasm32 linear memory cannot exceed **2 GiB (2,147,483,648 bytes)**. MuPDF's WASM build
uses `ALLOW_MEMORY_GROWTH` with no maximum override, so it grows until it hits that wall.
Crossing it **aborts the instance**. It does not throw something a `catch` can handle.

iOS Safari is worse. It kills the tab well below that limit, with no catchable error at
all, so no graceful-degradation path can ever run there. A budget derived by scaling the
desktop numbers down would be a guess about a threshold that, when crossed, offers no
second chance.

A ceiling that is discovered mid-operation is not a ceiling, it is a corruption bug: the
document is left half-edited in a state no undo can reach.

## Decision

Ceilings are declared in `lib/core/limits.ts` and enforced by the rule that module
states in its own header: **project, assert, then mutate.** Every operation that can grow
memory computes its cost first and throws before touching the document.

The values below are the contract. `lib/core/limits.ts` is the normative source; this
table must match it exactly, and `tests/limits.test.ts` covers the boundaries.

### Hard platform limit

| Constant            |         Value | Note                                                    |
| ------------------- | ------------: | ------------------------------------------------------- |
| `WASM_HARD_CEILING` | 2,147,483,648 | wasm32 maximum. Exceeding it aborts; it does not throw. |

### `DESKTOP_BUDGET`

| Field             |                 Value | Meaning                                                                          |
| ----------------- | --------------------: | -------------------------------------------------------------------------------- |
| `maxFileBytes`    | 536,870,912 (512 MiB) | Largest input PDF we will open at all.                                           |
| `maxPages`        |                10,000 | Page-count ceiling.                                                              |
| `maxPagePoints`   |                14,400 | Longest side in PDF points. This is PDF's own maximum user-space page dimension. |
| `wasmSoftCeiling` |         1,400,000,000 | Soft ceiling for MuPDF linear memory, below the 2 GiB hard limit.                |
| `maxRenderPixels` |             4,000,000 | Pixels in one uninterruptible `toPixmap()` call. Larger renders are tiled.       |
| `bitmapBudget`    | 402,653,184 (384 MiB) | Main-thread `ImageBitmap` cache. Separate address space, separate budget.        |

### `IOS_BUDGET`

Every number here is a measured survival threshold, not a scaled desktop value.

| Field             |                 Value |
| ----------------- | --------------------: |
| `maxFileBytes`    | 209,715,200 (200 MiB) |
| `maxPages`        |                 4,000 |
| `maxPagePoints`   |                14,400 |
| `wasmSoftCeiling` |           700,000,000 |
| `maxRenderPixels` |             1,000,000 |
| `bitmapBudget`    | 167,772,160 (160 MiB) |

`budgetFor(navigator)` selects between them via `isIosLike()`, which treats a Macintosh
user-agent string with more than one touch point as iPadOS, because iPadOS reports a
desktop string.

### Memory pressure

`pressureOf(currentBytes, budget)` returns `ok` below 65% of the soft ceiling, `warn`
from 65%, and `critical` from 85%. The UI shrinks caches at `warn` and refuses new
non-essential work at `critical`, so the user meets a clear refusal long before the
instance meets an abort.

### Overflow safety

`projectRenderBytes(width, height)` computes `width * height * 4` in `BigInt` and clamps
to `Number.MAX_SAFE_INTEGER`. `assertHeadroom()` sums current and projected cost in
`BigInt`. This is not defensive decoration: computed as `Number`, an adversarial
`2^30 x 2^30` render wraps to a small float and sails straight past the check meant to
catch it. Negative dimensions are floored to zero so they cannot produce negative cost.

### Error taxonomy

Every rejection is a `LimitError` carrying a `LimitCode` from this closed set:

`file_too_large`, `too_many_pages`, `page_too_large`, `heap_ceiling`,
`render_too_large`, `bitmap_budget`, `save_flag_conflict`, `storage_quota`.

Messages are written for the person who hit them: they state the actual number, the
limit, and what to do next. `tests/limits.test.ts` asserts that, not just the code.

### Save-flag validation

MuPDF enforces the mutual exclusivity of its save flags by throwing from inside WASM.
`assertSaveFlags()` validates the same rules in TypeScript so the UI can disable an
option rather than let the user choose it and then fail. Incremental save is refused
when the document was repaired on open, when the document cannot be saved incrementally,
when garbage collection is requested alongside it, and when encryption is being changed.

### Honest scope

These ceilings are defence in depth plus graceful refusal. They are **not** a guarantee
that the browser cannot run out of memory. Native allocation inside the engine, browser
decoder behaviour, and other tabs are all outside our control, and on iOS the tab can
die with no error at all. The product must say so rather than imply an impossible
guarantee.

## Consequences

### Positive

- Every ceiling is one exported constant with a boundary test, so there is no
  disagreement between what the code enforces and what the docs claim.
- Failures arrive before mutation, so a rejection never leaves a damaged document.
- Error messages give the user an action rather than a code.

### Negative

- Some legitimately large documents are refused. The numbers are conservative and
  revisable, but only through a superseding ADR backed by measurement.
- Two budgets means two code paths to exercise in tests.

### Neutral

- The soft ceiling is deliberately well below 2 GiB. The headroom absorbs allocations we
  do not measure, and shrinking it is not a free win.

## Notes

Normative source: `lib/core/limits.ts`. Tests: `tests/limits.test.ts`. Related:
[ADR 0009](0009-wasm-memory-and-handle-discipline.md) (handle discipline),
[ADR 0010](0010-tiled-render-pipeline.md) (why `maxRenderPixels` exists),
[ADR 0013](0013-supported-browser-matrix.md) (why iOS is separate).
