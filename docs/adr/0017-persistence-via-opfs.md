# 0017. Persistence in OPFS, written from the worker

## Status

Accepted

## Date

2026-07-26

## Context

Two facts make persistence non-optional.

A worker can die. [ADR 0008](0008-worker-topology-and-crash-isolation.md) treats worker
death as an expected outcome, because a malformed PDF can trap the WASM instance
unrecoverably. Without durable state, every crash costs the user everything they had
done. Crash isolation without recovery is only half the feature.

A session should survive a reload. Closing a tab on a half-annotated document and losing
the work is the behaviour of a toy.

The storage options in a browser are IndexedDB, the Cache API, and the Origin Private
File System. For documents of the size in [ADR 0014](0014-resource-ceilings.md), up to
512 MiB, only OPFS offers what we need: `createSyncAccessHandle()`, available **in worker
contexts only**, which gives synchronous read, write, and truncate against a real file
without a structured-clone round trip and without materialising the whole document as a
JavaScript value.

The document worker is already the only thing holding document bytes, and it is already a
worker, so the constraint costs nothing.

## Decision

Persist to OPFS, written from the document worker through `createSyncAccessHandle()`.

- **Scope.** The original document bytes plus the current edit state, per open document,
  under a stable per-document key. The user's own file on disk is never touched: a save
  is an explicit download.
- **Placement.** Only the document worker writes. The main thread does not hold a sync
  access handle, and could not, since the API is worker-only.
- **Cadence.** After each committed journal operation
  ([ADR 0011](0011-undo-on-the-mupdf-journal.md)), debounced. The journal already defines
  the boundaries at which the document is consistent, so there is no separate notion of
  a save point to invent.
- **Atomicity.** Write to a temporary entry and rename. A crash mid-write must never
  leave a truncated file that then fails to open, which would turn a recoverable crash
  into a permanent loss.
- **Recovery.** On startup, orphaned entries are offered for recovery by name and
  timestamp, with an explicit user choice. Nothing is silently reopened; a user who
  crashed on a document they did not intend to keep should not have it forced back at
  them.
- **Quota.** `storage_quota` is a `LimitCode` in `lib/core/limits.ts`. Quota exhaustion
  surfaces as a `LimitError` with an action the user can take, and it must never fail
  silently, because a silent persistence failure is indistinguishable from working until
  the moment it costs someone their work.
- **Eviction.** Entries for documents the user has closed are removed. Persistence is
  crash insurance, not an archive, and OPFS is not a place to accumulate hundreds of
  megabytes on someone's behalf.
- **The startup sweep is not optional.** Close-time eviction provably does not run in the
  case where it matters most. A WASM trap is uncatchable, it kills the instance, and there
  is no `FinalizationRegistry` to fall back on
  ([ADR 0009](0009-wasm-memory-and-handle-discipline.md)), so a crashed session leaves its
  entry behind by construction. Without a sweep, document-sized files accumulate invisibly
  until the user's disk fills, and the user has no way to see why. On startup, therefore,
  entries belonging to no live session are enumerated: those the user declines to recover
  are deleted, and those from a session older than a bounded age are deleted without
  asking. This is a distinct mechanism from Recovery above, which offers a crashed
  document back; the sweep is what removes the ones nobody wants.
- **Privacy.** OPFS is origin-private and never leaves the device, which keeps
  [ADR 0002](0002-client-side-only-zero-egress.md) intact. It is still user data on their
  machine, so there is an explicit, discoverable way to clear it.

## Consequences

### Positive

- A worker crash costs at most the operations since the last debounce, rather than the
  session.
- Large documents are persisted without a serialisation round trip.
- Recovery composes naturally with the journal, since the journal already marks
  consistent points.

### Negative

- OPFS quota is browser-managed and can be evicted under pressure, so recovery is best
  effort and must be described that way.
- Atomic rename plus temporary entries means more filesystem operations and more error
  paths to test.
- Persisted state is another thing that must be versioned; a format change needs a
  migration or a clean discard.

### Neutral

- Cross-tab coordination is out of scope for now. Two tabs editing the same document is
  a conflict case that needs its own design, and pretending otherwise would create
  exactly the silent-corruption failure this project treats as a merge blocker.

## Notes

`storage_quota` is defined in `lib/core/limits.ts`. Related:
[ADR 0008](0008-worker-topology-and-crash-isolation.md) (why recovery is needed),
[ADR 0011](0011-undo-on-the-mupdf-journal.md) (what defines a consistent point),
[ADR 0002](0002-client-side-only-zero-egress.md) (why it stays local).
