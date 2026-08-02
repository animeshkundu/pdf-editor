// Byte-span content splicing: exact PDF content-stream token scanning, sorted non-overlapping
// byte replacement, and a forced-write path over `PDFObject.writeStream`/`writeRawStream`
// that proves its own persistence by rereading through a freshly resolved reference.
//
// See docs/adr/0029-byte-span-content-splicing.md and
// docs/research/2026-08-01-byte-span-content-splicing.md for what this does and does not
// establish, and docs/adr/0020-content-stream-rewriting-failed-stage-one.md for the mechanism
// this narrowly, provably supersedes.

export {
  scanContentTokens,
  assertPartitionsExactly,
  ContentScanError,
  type ContentToken,
  type ContentTokenKind,
} from './tokens';
export {
  assertSortedNonOverlapping,
  spliceBytes,
  ByteSpliceError,
  type ByteSplice,
} from './splice';
export { readDecodedStreamBytes, forceWriteContentStream } from './stream-io';
export { resolveEditableContentStream, type EditableContentStream } from './page-contents';
export {
  countFormXObjectInstances,
  proveSingleFormInstance,
  type FormInstancing,
} from './form-xobjects';
export { findSingleAsciiShowTextRun, type ShowTextRun } from './text-run';
export {
  diffContentStreams,
  summarizeContentTokens,
  type ContentStreamTokenDiff,
  type ContentTokenSummary,
} from './token-diff';
