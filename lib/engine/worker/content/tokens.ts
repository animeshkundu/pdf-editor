// Exact PDF content-stream token scanner.
//
// This is a pure byte-in, byte-spans-out lexer for the operand/operator grammar defined by
// ISO 32000-2 clause 7.2 (objects) as it appears inside a page or Form XObject content
// stream (clause 9.2 for the show-text and marked-content operators, clause 8.9.5.2 for the
// inline-image `BI`/`ID`/`EI` triad). It never resolves names, never inverts an encoding, and
// never decides what an operator means. Its only job is: given the exact decoded bytes of a
// content stream, produce a sequence of tokens whose byte spans partition the input exactly,
// with no gap and no overlap, so a caller can splice bytes at an exact span with the
// certainty that nothing outside that span was touched.
//
// This module is framework-free and MuPDF-free by construction: it operates on a Uint8Array
// and has no imports. That is what makes `content-splice.oracle.test.ts` able to exercise it
// without a document at all, and what makes the invariant ("every byte accounted for exactly
// once") checkable directly.
//
// See docs/adr/0029-byte-span-content-splicing.md and
// docs/research/2026-08-01-byte-span-content-splicing.md for why this exists instead of the
// sanitize-filter rewrite withdrawn by ADR 0020.

export type ContentTokenKind =
  | 'whitespace'
  | 'comment'
  | 'string'
  | 'hex-string'
  | 'array'
  | 'dictionary'
  | 'name'
  | 'number'
  | 'keyword'
  | 'inline-image-data';

export interface ContentToken {
  /** Inclusive start byte offset into the scanned buffer. */
  readonly start: number;
  /** Exclusive end byte offset into the scanned buffer. */
  readonly end: number;
  readonly kind: ContentTokenKind;
  /**
   * Populated only for `array` and `dictionary`: the tokens strictly between the opening and
   * closing delimiters, recursively scanned. Whitespace and comments between elements are
   * included so children also partition their parent's span exactly.
   */
  readonly children?: readonly ContentToken[];
}

export class ContentScanError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (byte offset ${offset}).`);
    this.name = 'ContentScanError';
    this.offset = offset;
  }
}

const WHITESPACE = new Set<number>([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set<number>(
  ['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'].map((char) => char.charCodeAt(0)),
);

function isWhitespace(byte: number | undefined): boolean {
  return byte !== undefined && WHITESPACE.has(byte);
}

function isDelimiter(byte: number | undefined): boolean {
  return byte !== undefined && DELIMITERS.has(byte);
}

function isRegular(byte: number | undefined): boolean {
  return byte !== undefined && !isWhitespace(byte) && !isDelimiter(byte);
}

function isDigit(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

function isHexDigit(byte: number | undefined): boolean {
  return (
    isDigit(byte) ||
    (byte !== undefined && byte >= 0x41 && byte <= 0x46) ||
    (byte !== undefined && byte >= 0x61 && byte <= 0x66)
  );
}

/**
 * Scans a whole content stream (or a slice of one, such as an inline image's key/value
 * preamble) into a flat, gapless, non-overlapping sequence of top-level tokens.
 *
 * Throws {@link ContentScanError} on any construct it cannot account for exactly: an
 * unterminated string, hex string, array, or dictionary; an invalid character inside a hex
 * string; or inline-image data with no recoverable `EI` terminator. A scanner that silently
 * widened or truncated a malformed span would make splicing lie about what it touched, so
 * malformed input is a hard refusal rather than a best-effort guess.
 */
export function scanContentTokens(bytes: Uint8Array): ContentToken[] {
  const tokens: ContentToken[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const token = scanOne(bytes, cursor);
    tokens.push(token);
    if (token.end <= cursor) {
      // Defensive: a scanner bug that fails to advance would spin forever instead of
      // producing a wrong-but-finite answer. Fail loudly.
      throw new ContentScanError('Content-stream scanner made no progress', cursor);
    }
    cursor = token.end;
    if (keywordAt(bytes, token, 'BI')) {
      cursor = scanInlineImage(bytes, cursor, tokens);
    }
  }
  return tokens;
}

function scanOne(bytes: Uint8Array, start: number): ContentToken {
  const byte = bytes[start];
  if (byte === undefined) {
    throw new ContentScanError('Attempted to scan past the end of the buffer', start);
  }
  if (isWhitespace(byte)) return scanWhitespace(bytes, start);
  if (byte === 0x25 /* % */) return scanComment(bytes, start);
  if (byte === 0x28 /* ( */) return scanLiteralString(bytes, start);
  if (byte === 0x3c /* < */) {
    if (bytes[start + 1] === 0x3c) return scanDictionary(bytes, start);
    return scanHexString(bytes, start);
  }
  if (byte === 0x5b /* [ */) return scanArray(bytes, start);
  if (byte === 0x2f /* / */) return scanName(bytes, start);
  if (
    isDigit(byte) ||
    byte === 0x2b /* + */ ||
    byte === 0x2d /* - */ ||
    byte === 0x2e /* . */
  ) {
    const number = tryScanNumber(bytes, start);
    if (number) return number;
  }
  if (isRegular(byte)) return scanKeyword(bytes, start);
  throw new ContentScanError(`Unexpected delimiter byte 0x${byte.toString(16)}`, start);
}

function scanWhitespace(bytes: Uint8Array, start: number): ContentToken {
  let end = start;
  while (isWhitespace(bytes[end])) end += 1;
  return { start, end, kind: 'whitespace' };
}

function scanComment(bytes: Uint8Array, start: number): ContentToken {
  let end = start + 1;
  while (end < bytes.length && bytes[end] !== 0x0a && bytes[end] !== 0x0d) end += 1;
  return { start, end, kind: 'comment' };
}

function scanLiteralString(bytes: Uint8Array, start: number): ContentToken {
  let depth = 1;
  let cursor = start + 1;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    if (byte === 0x5c /* \ */) {
      // The escape swallows exactly the next byte, except an octal escape which swallows up
      // to two further octal digits, and a line-continuation escape which swallows a CRLF
      // pair as one unit. None of those inner bytes can themselves open or close the string.
      cursor += 1;
      const escaped = bytes[cursor];
      if (escaped === 0x0d) {
        cursor += 1;
        if (bytes[cursor] === 0x0a) cursor += 1;
        continue;
      }
      if (escaped !== undefined && escaped >= 0x30 && escaped <= 0x37) {
        cursor += 1;
        for (let digits = 0; digits < 2 && bytes[cursor] !== undefined; digits += 1) {
          const next = bytes[cursor];
          if (next === undefined || next < 0x30 || next > 0x37) break;
          cursor += 1;
        }
        continue;
      }
      cursor += 1;
      continue;
    }
    if (byte === 0x28 /* ( */) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (byte === 0x29 /* ) */) {
      depth -= 1;
      cursor += 1;
      if (depth === 0) return { start, end: cursor, kind: 'string' };
      continue;
    }
    cursor += 1;
  }
  throw new ContentScanError('Unterminated literal string', start);
}

function scanHexString(bytes: Uint8Array, start: number): ContentToken {
  let cursor = start + 1;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    if (byte === 0x3e /* > */) return { start, end: cursor + 1, kind: 'hex-string' };
    if (isWhitespace(byte) || isHexDigit(byte)) {
      cursor += 1;
      continue;
    }
    throw new ContentScanError(
      `Invalid byte 0x${(byte ?? 0).toString(16)} inside hex string`,
      cursor,
    );
  }
  throw new ContentScanError('Unterminated hex string', start);
}

function scanDictionary(bytes: Uint8Array, start: number): ContentToken {
  const children: ContentToken[] = [];
  let cursor = start + 2;
  while (cursor < bytes.length) {
    if (bytes[cursor] === 0x3e && bytes[cursor + 1] === 0x3e) {
      return { start, end: cursor + 2, kind: 'dictionary', children };
    }
    const child = scanOne(bytes, cursor);
    children.push(child);
    if (child.end <= cursor) {
      throw new ContentScanError('Content-stream scanner made no progress', cursor);
    }
    cursor = child.end;
  }
  throw new ContentScanError('Unterminated dictionary (missing >>)', start);
}

function scanArray(bytes: Uint8Array, start: number): ContentToken {
  const children: ContentToken[] = [];
  let cursor = start + 1;
  while (cursor < bytes.length) {
    if (bytes[cursor] === 0x5d /* ] */) {
      return { start, end: cursor + 1, kind: 'array', children };
    }
    const child = scanOne(bytes, cursor);
    children.push(child);
    if (child.end <= cursor) {
      throw new ContentScanError('Content-stream scanner made no progress', cursor);
    }
    cursor = child.end;
  }
  throw new ContentScanError('Unterminated array (missing ])', start);
}

function scanName(bytes: Uint8Array, start: number): ContentToken {
  let cursor = start + 1;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    if (
      byte === 0x23 /* # */ &&
      isHexDigit(bytes[cursor + 1]) &&
      isHexDigit(bytes[cursor + 2])
    ) {
      cursor += 3;
      continue;
    }
    if (!isRegular(byte)) break;
    cursor += 1;
  }
  return { start, end: cursor, kind: 'name' };
}

function tryScanNumber(bytes: Uint8Array, start: number): ContentToken | undefined {
  let cursor = start;
  if (bytes[cursor] === 0x2b || bytes[cursor] === 0x2d) cursor += 1;
  let sawDigit = false;
  while (isDigit(bytes[cursor])) {
    cursor += 1;
    sawDigit = true;
  }
  if (bytes[cursor] === 0x2e /* . */) {
    cursor += 1;
    while (isDigit(bytes[cursor])) {
      cursor += 1;
      sawDigit = true;
    }
  }
  if (!sawDigit) return undefined;
  // A number must end at a delimiter or whitespace, never run into another regular byte
  // (e.g. "12x" is not a number followed by nothing, it is an invalid token; refuse rather
  // than silently truncate to "12").
  if (isRegular(bytes[cursor])) return undefined;
  return { start, end: cursor, kind: 'number' };
}

function scanKeyword(bytes: Uint8Array, start: number): ContentToken {
  let cursor = start;
  while (isRegular(bytes[cursor])) cursor += 1;
  return { start, end: cursor, kind: 'keyword' };
}

function keywordAt(bytes: Uint8Array, token: ContentToken, keyword: string): boolean {
  if (token.kind !== 'keyword' || token.end - token.start !== keyword.length) return false;
  for (let index = 0; index < keyword.length; index += 1) {
    if (bytes[token.start + index] !== keyword.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Scans the inline-image preamble (`BI` was already consumed) through to and including `EI`,
 * appending its tokens to `tokens` and returning the cursor just past `EI`.
 *
 * The key/value pairs between `BI` and `ID` are ordinary content-stream objects (names,
 * numbers, arrays, booleans) and are scanned with the same `scanOne` used everywhere else.
 * The bytes between `ID` and `EI` are opaque sample data with no self-delimiting grammar:
 * per ISO 32000-2 8.9.5.2 a reader either knows the length in advance (rare in a hand-written
 * content stream, and this scanner does not evaluate the `/L` key to avoid trusting a value
 * an adversarial or corrupt stream could lie about) or must search for `EI` bounded by
 * whitespace. That is what this does, and it is a known, documented limitation: sample data
 * that happens to contain the exact byte sequence whitespace-E-I-whitespace will truncate
 * early. See docs/research/2026-08-01-byte-span-content-splicing.md.
 */
function scanInlineImage(bytes: Uint8Array, cursor: number, tokens: ContentToken[]): number {
  let position = cursor;
  for (;;) {
    if (position >= bytes.length) {
      throw new ContentScanError('Unterminated inline image (missing ID)', cursor);
    }
    const token = scanOne(bytes, position);
    tokens.push(token);
    position = token.end;
    if (keywordAt(bytes, token, 'ID')) break;
  }
  // Exactly one whitespace byte conventionally separates ID from the sample data. It is
  // part of the operator syntax, not the image data, and is scanned as its own token so the
  // data token's span is exactly the sample bytes.
  if (isWhitespace(bytes[position])) {
    tokens.push({ start: position, end: position + 1, kind: 'whitespace' });
    position += 1;
  }
  const dataStart = position;
  let dataEnd = -1;
  let terminatorStart = -1;
  let keywordStart = -1;
  for (let index = position; index < bytes.length - 1; index += 1) {
    if (bytes[index] !== 0x45 /* E */ || bytes[index + 1] !== 0x49 /* I */) continue;
    const before = index > dataStart ? bytes[index - 1] : bytes[dataStart - 1];
    const after = bytes[index + 2];
    if (!isWhitespace(before)) continue;
    if (after !== undefined && !isWhitespace(after) && !isDelimiter(after)) continue;
    dataEnd = Math.max(dataStart, index - 1);
    terminatorStart = index - 1;
    keywordStart = index;
    break;
  }
  if (dataEnd < 0) {
    throw new ContentScanError('Unterminated inline image (no recoverable EI)', dataStart);
  }
  if (dataEnd > dataStart) {
    tokens.push({ start: dataStart, end: dataEnd, kind: 'inline-image-data' });
  }
  if (terminatorStart >= dataStart) {
    tokens.push({ start: terminatorStart, end: terminatorStart + 1, kind: 'whitespace' });
  }
  tokens.push({ start: keywordStart, end: keywordStart + 2, kind: 'keyword' });
  return keywordStart + 2;
}

/** Asserts that a token list partitions `bytes` exactly: gapless, non-overlapping, in order. */
export function assertPartitionsExactly(
  tokens: readonly ContentToken[],
  bytes: Uint8Array,
): void {
  let expected = 0;
  for (const token of tokens) {
    if (token.start !== expected) {
      throw new ContentScanError(
        `Token scanner left a gap or overlap before offset ${token.start}`,
        expected,
      );
    }
    if (token.end <= token.start) {
      throw new ContentScanError('Token has non-positive length', token.start);
    }
    expected = token.end;
  }
  if (expected !== bytes.length) {
    throw new ContentScanError(
      `Token scanner did not account for the final ${bytes.length - expected} byte(s)`,
      expected,
    );
  }
}

export default { assertPartitionsExactly, scanContentTokens, ContentScanError };
