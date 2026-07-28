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

export default { decodePdfTextString };
