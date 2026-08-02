import type * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { Arena } from '../arena';

// Page-content access for the byte-span splicing mechanism.
//
// A page's `/Contents` entry is either a single stream reference or an array of them
// (ISO 32000-2 7.7.3.3), concatenated with an implied whitespace separator when a content
// processor reads them as one logical stream. This mechanism never performs that
// concatenation itself: splicing operates on one physical stream's own decoded bytes, and a
// byte span computed against a concatenation of several physical streams could straddle a
// stream boundary that a single `writeStream()` call cannot express. Rather than approximate
// that, this refuses whenever `/Contents` cannot be resolved to exactly one physical stream.

export interface EditableContentStream {
  readonly object: mupdf.PDFObject;
  /** True when `/Contents` was a one-element array rather than a bare stream reference. */
  readonly wasArray: boolean;
}

/**
 * Resolves the single physical content stream this mechanism is allowed to splice.
 *
 * Throws when `/Contents` is missing, is a non-stream object, or is an array of more than one
 * stream: the last case is the literal "refuse cross-stream edits" requirement, because a
 * byte span computed from a page-level text search has no reliable way to say which physical
 * stream (or which byte position within a multi-stream concatenation) it falls in without
 * re-deriving MuPDF's own concatenation logic, and getting that wrong would silently corrupt
 * whichever stream received a wrong offset.
 */
export function resolveEditableContentStream(
  arena: Arena,
  page: mupdf.PDFPage,
): EditableContentStream {
  const pageObject = arena.keep(page.getObject());
  const contents = arena.keep(pageObject.get('Contents'));
  if (contents.isStream()) {
    return { object: contents, wasArray: false };
  }
  if (contents.isArray()) {
    const length = contents.length;
    if (length === 0) {
      throw new Error(
        'Content-stream byte splicing refuses this page because its /Contents array is empty.',
      );
    }
    if (length > 1) {
      throw new Error(
        `Content-stream byte splicing refuses this page because /Contents is an array of ${length} separate streams; a byte span computed from page-level text would need to prove which physical stream, or which side of a stream boundary, it falls in, and this mechanism does not perform that cross-stream reconciliation.`,
      );
    }
    const only = arena.keep(contents.get(0));
    if (!only.isStream()) {
      throw new Error(
        'Content-stream byte splicing refuses this page because its single /Contents array entry is not a stream.',
      );
    }
    return { object: only, wasArray: true };
  }
  throw new Error(
    'Content-stream byte splicing refuses this page because it has no /Contents stream to edit.',
  );
}

export default { resolveEditableContentStream };
