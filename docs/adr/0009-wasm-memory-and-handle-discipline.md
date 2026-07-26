# 0009. WASM memory and handle discipline

## Status

Accepted

## Date

2026-07-26

## Context

MuPDF's JavaScript binding exposes 27 classes that wrap native objects: `PDFDocument`,
`Page`, `Pixmap`, `StructuredText`, `Buffer`, `DisplayList`, `Device`, `Font`, `Image`,
`ColorSpace`, and the rest. Every one of them holds a pointer into the WASM linear
memory, and every one of them requires an explicit `.destroy()`.

**There is no `FinalizationRegistry` in the binding.** Garbage collecting the JavaScript
wrapper does not free the native object. A leaked `Pixmap` leaks until the page is
reloaded.

This is the single most common production failure in mupdf.js. It is not a subtle bug.
The failure mode is a viewer that works perfectly in testing, grows by a few megabytes
per rendered page in real use, and dies partway through a long document with an
unrecoverable abort rather than a catchable error, because wasm32 linear memory cannot
exceed 2 GiB and exceeding it aborts the instance.

Discipline enforced by code review does not survive contact with a codebase. Discipline
enforced by a linter does.

## Decision

### Construction is confined to the worker

`eslint.config.js` forbids importing `mupdf` anywhere except `lib/engine/worker/`. All
other code uses the `PdfEngine` port in `lib/engine/port.ts`, which trades in plain
serialisable values, never handles.

### Every handle is owned at construction

Inside the worker, a second lint rule (`no-restricted-syntax`) rejects a bare
`new mupdf.X(...)`. Construction must be wrapped:

- `arena.keep(new mupdf.X(...))` for job-scoped objects, or
- `retain(key, new mupdf.X(...))` for objects that outlive the job.

An unowned handle is a lint error, not a review comment.

### Arenas release in reverse order on job exit

Every job acquires an `Arena`. On exit, whether the job succeeded, failed, or was
cancelled, the arena destroys everything it holds in reverse acquisition order.
Reverse order matters because some MuPDF objects reference others, and destroying a
parent before its child is undefined behaviour rather than a no-op.

The release path runs in `finally`. A thrown error must never skip it.

### Retained objects have a named owner and an eviction policy

Anything that outlives a job (a `DisplayList` cache, an open `PDFDocument`, a loaded
`Font`) lives in the `RETAINED` map under an explicit key, with a documented owner and a
documented eviction trigger. An entry with no eviction policy is a leak with extra steps.

### Project, assert, then mutate

`lib/core/limits.ts` states the rule this decision serves: every operation that can grow
memory computes its cost first and throws before touching the document. Discovering a
ceiling mid-mutation leaves a half-edited document that no undo can reach.
`assertHeadroom(currentBytes, projectedBytes, budget)` is the gate, and it is called
before allocation, never after.

### Pressure is observable

`pressureOf()` reports `ok`, `warn`, or `critical` against the soft ceiling. The UI
reacts to `warn` by shrinking caches and to `critical` by refusing new non-essential
work. A user should meet a clear refusal well before the instance meets a hard abort.

## Consequences

### Positive

- The most likely production failure mode is caught at lint time rather than in the
  field.
- Cancellation and error paths free memory by construction, because the arena releases
  in `finally`.
- The port boundary makes the rest of the application testable without WASM.

### Negative

- Worker code is more ceremonious than idiomatic TypeScript. Every construction is
  wrapped.
- The lint rules are syntactic and can be circumvented by anyone determined to do so;
  they raise the cost of a mistake rather than making one impossible.

### Neutral

- If upstream ever adds a `FinalizationRegistry`, it would be a safety net and not a
  replacement. Deterministic release under a 2 GiB ceiling still beats waiting for a
  collector.

## Notes

Enforced by the two rule blocks at the end of `eslint.config.js`, which name this ADR.
Ceilings are in [ADR 0014](0014-resource-ceilings.md) and `lib/core/limits.ts`. Crash
containment is in [ADR 0008](0008-worker-topology-and-crash-isolation.md).
