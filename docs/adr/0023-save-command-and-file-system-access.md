# 0023. Save, Save As, and File System Access

## Status

Accepted

## Date

2026-07-27

## Context

ADR 0017 defines OPFS crash insurance, not user-visible output. Chromium can write back to a
user-granted file handle; Firefox and Safari cannot.

## Decision

`VIEW-037` covers the output family. When an opened Chromium file handle is writable, Save
writes a full validated buffer back to that handle and Save As uses
`showSaveFilePicker()`. Without those capabilities, the visible command is named Download
before invocation. No browser receives a misleading Save label.

OPFS remains worker-owned recovery state and never counts as Save. Every output is produced
by the worker, accepted by pdf.js and qpdf in tests, and explicitly initiated by the user.

## Consequences

The same document operation has platform-specific delivery but one honest outcome. Opening
through a plain file input cannot confer write-back authority and therefore uses Download.
