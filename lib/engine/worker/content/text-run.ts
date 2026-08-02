import type { ContentToken } from './tokens';

// A narrow, provable text-run finder over the flat token stream `scanContentTokens` produces.
//
// This is deliberately not a general show-text interpreter: it does not decode `TJ` arrays,
// does not resolve font encodings, and does not walk into inline images or nested arrays. It
// answers exactly one question, byte-for-byte: is there exactly one occurrence, anywhere across
// every `(literal string) Tj` operator in this token stream, of `target` as a contiguous run of
// raw unescaped ASCII bytes? That narrow question is the one the research measurement
// (docs/research/2026-08-01-byte-span-content-splicing.md) established is answerable without an
// encoding inversion: a byte-length-preserving ASCII replacement of a run inside a simple-font
// `Tj` string reached an independent reader intact. Every other case (TJ arrays, escaped
// characters, non-ASCII, ambiguous or repeated candidates) is refused by returning `null`, and
// the caller (`inspectExistingTextEdit`) falls back to the existing annotation-overlay path
// rather than guessing.
//
// `target` need not be the *entire* string operand: `(Prefix Original Suffix) Tj` contains
// `Original` as a strict substring, and this returns the span of just that substring, not the
// whole operand, mirroring how the existing redact+overlay path already replaces a selected
// run rather than requiring the whole line to match.

export interface ShowTextRun {
  /** Offset of the first byte of the matched run, inside the string's parentheses. */
  readonly innerStart: number;
  /** Offset one past the last byte of the matched run, inside the string's parentheses. */
  readonly innerEnd: number;
}

function asciiBytesOf(text: string): Uint8Array | null {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return null;
    bytes[index] = code;
  }
  return bytes;
}

function isTrivial(token: ContentToken): boolean {
  return token.kind === 'whitespace' || token.kind === 'comment';
}

function isKeyword(token: ContentToken, bytes: Uint8Array, keyword: string): boolean {
  if (token.kind !== 'keyword' || token.end - token.start !== keyword.length) return false;
  for (let index = 0; index < keyword.length; index += 1) {
    if (bytes[token.start + index] !== keyword.charCodeAt(index)) return false;
  }
  return true;
}

/** Every offset (relative to `haystack`) at which `needle` occurs as a contiguous run. */
function findAllOccurrences(haystack: Uint8Array, needle: Uint8Array): number[] {
  const offsets: number[] = [];
  if (needle.length === 0 || needle.length > haystack.length) return offsets;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) offsets.push(start);
  }
  return offsets;
}

/**
 * Returns the unique `target` byte span found inside a `(...) Tj` operand across `tokens`, or
 * `null` if there is not exactly one unescaped, ASCII-only candidate occurrence.
 *
 * "Unescaped" means the containing string contains no backslash byte at all: a target
 * containing no PDF-reserved characters can only ever have been written as literal bytes with
 * no escape sequence, so requiring that up front is what lets this module compare raw bytes
 * directly instead of implementing (and re-verifying) a PDF string-escape decoder.
 */
export function findSingleAsciiShowTextRun(
  tokens: readonly ContentToken[],
  bytes: Uint8Array,
  target: string,
): ShowTextRun | null {
  const targetBytes = asciiBytesOf(target);
  if (!targetBytes) return null;

  const matches: ShowTextRun[] = [];
  let previous: ContentToken | undefined;
  for (const token of tokens) {
    if (isTrivial(token)) continue;
    if (previous && previous.kind === 'string' && isKeyword(token, bytes, 'Tj')) {
      const innerStart = previous.start + 1;
      const innerEnd = previous.end - 1;
      const inner = bytes.subarray(innerStart, innerEnd);
      if (!inner.includes(0x5c) /* backslash: escaped, refuse to guess */) {
        for (const relativeOffset of findAllOccurrences(inner, targetBytes)) {
          matches.push({
            innerStart: innerStart + relativeOffset,
            innerEnd: innerStart + relativeOffset + targetBytes.length,
          });
        }
      }
    }
    previous = token;
  }
  return matches.length === 1 ? matches[0]! : null;
}

export default { findSingleAsciiShowTextRun };
