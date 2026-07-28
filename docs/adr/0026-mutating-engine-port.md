# 0026. A serializable mutating engine port

## Status

Accepted

## Date

2026-07-27

## Context

The viewer port carries only read operations. Editing must not move MuPDF handles, callbacks,
or mutable objects onto the main thread, and failed requests must not leave partial changes.

## Decision

All document mutation is expressed as serializable requests on `PdfEngine` and runs in the
per-document worker. Every request projects and asserts its cost before calling
`beginOperation()`, commits exactly one named MuPDF journal operation, calls
`abandonOperation()` on failure, and releases all temporary handles through an arena in
`finally`. Undo, redo, and history are projections of MuPDF's journal.

Save and export return transferred `ArrayBuffer` values. The main thread never imports
`mupdf` and never accepts a native handle.

## Consequences

The port is larger and deliberately explicit, but crash isolation, handle discipline, and
undo all keep one source of truth. Operations that cannot meet the preflight or rollback
contract are refused rather than approximated.
