const PDF_DOC_ENCODING: Readonly<Record<number, number>> = {
  0x18: 0x2d8,
  0x19: 0x2c7,
  0x1a: 0x2c6,
  0x1b: 0x2d9,
  0x1c: 0x2dd,
  0x1d: 0x2db,
  0x1e: 0x2da,
  0x1f: 0x2dc,
  0x80: 0x2022,
  0x81: 0x2020,
  0x82: 0x2021,
  0x83: 0x2026,
  0x84: 0x2014,
  0x85: 0x2013,
  0x86: 0x192,
  0x87: 0x2044,
  0x88: 0x2039,
  0x89: 0x203a,
  0x8a: 0x2212,
  0x8b: 0x2030,
  0x8c: 0x201e,
  0x8d: 0x201c,
  0x8e: 0x201d,
  0x8f: 0x2018,
  0x90: 0x2019,
  0x91: 0x201a,
  0x92: 0x2122,
  0x93: 0xfb01,
  0x94: 0xfb02,
  0x95: 0x141,
  0x96: 0x152,
  0x97: 0x160,
  0x98: 0x178,
  0x99: 0x17d,
  0x9a: 0x131,
  0x9b: 0x142,
  0x9c: 0x153,
  0x9d: 0x161,
  0x9e: 0x17e,
  0xa0: 0x20ac,
};

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const chunks: string[] = [];
  let codeUnits: number[] = [];
  for (let index = 2; index + 1 < bytes.length; index += 2) {
    codeUnits.push(
      littleEndian
        ? (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8)
        : ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0),
    );
    if (codeUnits.length === 8_192) {
      chunks.push(String.fromCharCode(...codeUnits));
      codeUnits = [];
    }
  }
  if (codeUnits.length > 0) chunks.push(String.fromCharCode(...codeUnits));
  return chunks.join('');
}

export function decodePdfTextString(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes, false);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes, true);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // PDFDocEncoding is the PDF text-string fallback when bytes are not valid UTF-8.
  }
  return Array.from(bytes, (value) =>
    String.fromCodePoint(PDF_DOC_ENCODING[value] ?? value),
  ).join('');
}

function hexBytes(value: string): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error('The font /ToUnicode map contains an invalid hexadecimal code.');
  }
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function unicodeFromHex(value: string): string {
  const bytes = hexBytes(value);
  if (bytes.length % 2 !== 0) throw new Error('The font /ToUnicode map is not UTF-16BE.');
  return decodeUtf16(Uint8Array.of(0xfe, 0xff, ...bytes), false);
}

/** Build the conservative inverse needed to reuse a PDF font's existing encoded subset. */
export function invertToUnicodeCMap(source: string): ReadonlyMap<string, Uint8Array> {
  const inverse = new Map<string, Uint8Array>();
  const blocks = source.matchAll(/beginbfchar([\s\S]*?)endbfchar/gi);
  for (const block of blocks) {
    for (const match of block[1]?.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi) ?? []) {
      const encoded = match[1];
      const unicode = match[2];
      if (!encoded || !unicode) continue;
      const character = unicodeFromHex(unicode);
      if ([...character].length === 1 && !inverse.has(character)) {
        inverse.set(character, hexBytes(encoded));
      }
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/gi)) {
    for (const match of block[1]?.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi) ??
      []) {
      const startHex = match[1];
      const endHex = match[2];
      const unicodeHex = match[3];
      if (!startHex || !endHex || !unicodeHex || startHex.length !== endHex.length) continue;
      const start = Number.parseInt(startHex, 16);
      const end = Number.parseInt(endHex, 16);
      const unicodeStart = Number.parseInt(unicodeHex, 16);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end - start > 65_536)
        continue;
      for (let code = start; code <= end; code += 1) {
        const encoded = code.toString(16).padStart(startHex.length, '0');
        const unicode = (unicodeStart + code - start)
          .toString(16)
          .padStart(unicodeHex.length, '0');
        const character = unicodeFromHex(unicode);
        if ([...character].length === 1 && !inverse.has(character)) {
          inverse.set(character, hexBytes(encoded));
        }
      }
    }
  }
  return inverse;
}

export function encodeWithToUnicodeCMap(text: string, source: string): Uint8Array {
  const inverse = invertToUnicodeCMap(source);
  const chunks: number[] = [];
  for (const character of text) {
    const encoded = inverse.get(character);
    if (!encoded) {
      throw new Error(
        `Existing-text edit refused because glyph ${JSON.stringify(character)} is absent from the embedded font subset. Choose text already supported by this font.`,
      );
    }
    chunks.push(...encoded);
  }
  return Uint8Array.from(chunks);
}

export default { decodePdfTextString, encodeWithToUnicodeCMap, invertToUnicodeCMap };
