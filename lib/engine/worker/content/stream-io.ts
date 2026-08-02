import type * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { Arena } from '../arena';

// Forced content-stream byte writes, and the documented journaling behaviour they rely on.
//
// `PDFObject.writeStream()` and `.writeRawStream()` both bottom out in the fork's
// `wasm_pdf_update_stream`, which is a thin wrapper over `pdf_update_stream` in
// `source/pdf/pdf-xref.c`. That function's own comment is the load-bearing fact this module
// depends on:
//
//     /* Write the Length first, as this has the effect of moving the
//      * old object into the journal for undo. This also moves the
//      * stream buffer with it, keeping it consistent. */
//     pdf_dict_put_int(ctx, obj, PDF_NAME(Length), fz_buffer_storage(ctx, newbuf, NULL));
//     ...
//     fz_drop_buffer(ctx, x->stm_buf);
//     x->stm_buf = fz_keep_buffer(ctx, newbuf);
//     if (!compressed) {
//         pdf_dict_del(ctx, obj, PDF_NAME(Filter));
//         pdf_dict_del(ctx, obj, PDF_NAME(DecodeParms));
//     }
//
// Three consequences follow, and this module is built around all three:
//
// 1. The **prior** object and stream buffer are what gets journaled, by writing `/Length`
//    before swapping the buffer pointer. An undo after a forced write restores the object as
//    it stood before, including its old stream bytes: it is a real journal entry, not a
//    silent in-place mutation outside the undo history ADR 0011 requires.
// 2. `writeStream()` (the `compressed = 0` call) unconditionally deletes `/Filter` and
//    `/DecodeParms`. Calling it on a filtered stream with the *decoded* bytes is always
//    correct, because MuPDF itself removes the now-stale filter declaration. It can never
//    produce a stream whose declared filter disagrees with its actual bytes.
// 3. `writeRawStream()` (the `compressed = 1` call) does not touch `/Filter` at all, which
//    means the caller is asserting the bytes it supplies are already correctly encoded for
//    whatever filter is still declared. This module only takes that path when there is no
//    declared filter to begin with, so the "raw" bytes and the decoded bytes are the same
//    bytes by definition. It never invents compressed bytes it did not produce, per the
//    product rule against claiming compression that was not actually done.
//
// See docs/adr/0029-byte-span-content-splicing.md and
// docs/research/2026-08-01-byte-span-content-splicing.md.

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertEditableStream(streamObject: mupdf.PDFObject): void {
  if (!streamObject.isIndirect()) {
    throw new Error(
      'Content-stream byte splicing refuses a direct stream reference because a forced write must be provable by reloading the object through its own indirect number.',
    );
  }
  if (!streamObject.isStream()) {
    throw new Error('Content-stream byte splicing refuses an object that is not a stream.');
  }
}

/** Reads the fully decoded (filter-applied) bytes of a content stream object. */
export function readDecodedStreamBytes(
  arena: Arena,
  streamObject: mupdf.PDFObject,
): Uint8Array {
  assertEditableStream(streamObject);
  const buffer = arena.keep(streamObject.readStream());
  return buffer.asUint8Array();
}

function streamHasDeclaredFilter(arena: Arena, streamObject: mupdf.PDFObject): boolean {
  const filter = arena.keep(streamObject.get('Filter'));
  return !filter.isNull();
}

/**
 * Writes `newBytes` as the decoded content of `streamObject`, then reloads the stream through
 * a **freshly created indirect reference** (not the handle used to write it) and rereads it,
 * throwing if the reread does not return exactly `newBytes`.
 *
 * That reread is the forced-write proof this function exists to provide: a caller cannot
 * observe from `newBytes` alone whether `writeStream`/`writeRawStream` actually reached the
 * document's own object table, because both calls return `void`. Reloading by object number
 * and rereading is what turns "we called a function that promises to write" into "the
 * document's own graph now serves back what we wrote," which is the same postcondition-then-
 * trust-nothing discipline `editExistingText` already applies to its annotation writes.
 *
 * Prefers `writeRawStream` only when the stream has no declared `/Filter`, in which case the
 * raw bytes and the decoded bytes are identical by definition and no compression claim is
 * being made either way. Every other stream is written with `writeStream`, whose decoded-bytes
 * contract lets MuPDF itself delete the now-stale filter declaration rather than this module
 * asserting a compression it did not perform.
 */
export function forceWriteContentStream(
  arena: Arena,
  document: mupdf.PDFDocument,
  streamObject: mupdf.PDFObject,
  newBytes: Uint8Array,
): void {
  assertEditableStream(streamObject);
  const objectNumber = streamObject.asIndirect();
  if (streamHasDeclaredFilter(arena, streamObject)) {
    streamObject.writeStream(newBytes);
  } else {
    streamObject.writeRawStream(newBytes);
  }

  // Deliberately does not call `.resolve()` here: resolving an indirect reference returns a
  // plain dictionary view that has lost the reference's own object identity, and this fork's
  // `isStream()`/`readStream()` bindings both key off that identity (`pdf_is_stream` and
  // `pdf_load_stream` both resolve internally). A freshly constructed indirect reference from
  // `document.newIndirect(objectNumber)` is itself already the correct handle to reread
  // through — it is "fresh" in the sense that matters (a new JS wrapper obtained purely from
  // the object number, independent of `streamObject`), not in the sense of being dereferenced.
  const reloadedReference = arena.keep(document.newIndirect(objectNumber));
  if (!reloadedReference.isStream()) {
    throw new Error(
      'Content-stream byte splice was rolled back because the object is no longer a stream after the forced write.',
    );
  }
  const rereadBuffer = arena.keep(reloadedReference.readStream());
  const reread = rereadBuffer.asUint8Array();
  if (!bytesEqual(reread, newBytes)) {
    throw new Error(
      'Content-stream byte splice was rolled back because rereading the stream through a freshly resolved reference did not return the bytes that were written.',
    );
  }
}

export default { forceWriteContentStream, readDecodedStreamBytes };
