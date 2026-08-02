// Sorted, non-overlapping byte splicing over an exact byte buffer.
//
// This is the second half of the byte-span mechanism: given the token-scanner's proof that a
// span corresponds to exactly one syntactic unit, this module is what actually rewrites bytes,
// and it rewrites nothing it was not told to. It has no knowledge of PDF syntax at all; it
// operates on plain offsets so it can be exhaustively tested against adversarial inputs
// without a document, a page, or a font in sight.
//
// See docs/adr/0029-byte-span-content-splicing.md.

export interface ByteSplice {
  /** Inclusive start offset into the original buffer. */
  readonly start: number;
  /** Exclusive end offset into the original buffer. */
  readonly end: number;
  /** Bytes to place at [start, end). May differ in length from `end - start`. */
  readonly replacement: Uint8Array;
}

export class ByteSpliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ByteSpliceError';
  }
}

/**
 * Validates that every splice has a well-formed, in-bounds range, and that the set of splices
 * is free of overlaps once sorted by start offset. Splices are not required to arrive
 * pre-sorted; this returns them sorted so `spliceBytes` and its callers never have to sort
 * twice or trust an unsorted input silently.
 *
 * Throws {@link ByteSpliceError} naming the exact offending range on:
 * - a non-integer, negative, or out-of-bounds `start` or `end`;
 * - `end < start`;
 * - two splices whose ranges overlap (touching at a shared boundary, `a.end === b.start`, is
 *   not an overlap and is permitted, since the two ranges then share no byte).
 */
export function assertSortedNonOverlapping(
  splices: readonly ByteSplice[],
  bufferLength: number,
): ByteSplice[] {
  for (const splice of splices) {
    if (
      !Number.isInteger(splice.start) ||
      !Number.isInteger(splice.end) ||
      splice.start < 0 ||
      splice.end < splice.start ||
      splice.end > bufferLength
    ) {
      throw new ByteSpliceError(
        `Invalid splice range [${splice.start}, ${splice.end}) against a buffer of ${bufferLength} byte(s).`,
      );
    }
  }
  const sorted = [...splices].sort((left, right) => left.start - right.start);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (current.start < previous.end) {
      throw new ByteSpliceError(
        `Overlapping splice ranges [${previous.start}, ${previous.end}) and [${current.start}, ${current.end}).`,
      );
    }
  }
  return sorted;
}

/**
 * Applies a set of byte splices to `original`, returning a new buffer. Every byte of
 * `original` not covered by a splice is copied through untouched, in its original position
 * relative to the other untouched bytes; only the spliced ranges are replaced, and a splice
 * whose `replacement` is byte-identical to the span it replaces (a "null splice") produces a
 * byte-identical output while still exercising every validation and write path a real edit
 * would.
 *
 * Ranges are validated and overlap-checked via {@link assertSortedNonOverlapping} before any
 * copying happens, so a rejected call never returns a partially-spliced buffer.
 */
export function spliceBytes(original: Uint8Array, splices: readonly ByteSplice[]): Uint8Array {
  const sorted = assertSortedNonOverlapping(splices, original.length);
  const outputLength =
    original.length +
    sorted.reduce(
      (total, splice) => total + (splice.replacement.length - (splice.end - splice.start)),
      0,
    );
  const output = new Uint8Array(outputLength);
  let readCursor = 0;
  let writeCursor = 0;
  for (const splice of sorted) {
    const gap = splice.start - readCursor;
    output.set(original.subarray(readCursor, splice.start), writeCursor);
    writeCursor += gap;
    output.set(splice.replacement, writeCursor);
    writeCursor += splice.replacement.length;
    readCursor = splice.end;
  }
  output.set(original.subarray(readCursor), writeCursor);
  return output;
}

export default { assertSortedNonOverlapping, spliceBytes, ByteSpliceError };
