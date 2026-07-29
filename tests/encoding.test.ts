import {
  decodePdfTextString,
  encodeWithToUnicodeCMap,
  invertToUnicodeCMap,
} from '../lib/text/encoding';

describe('PDF text-string decoding', () => {
  it('decodes PDFDocEncoding punctuation and currency', () => {
    expect(decodePdfTextString(new Uint8Array([0x41, 0x80, 0xa0, 0xff]))).toBe(
      'A\u2022\u20ac\u00ff',
    );
  });

  it('decodes UTF-16 big- and little-endian byte-order marks', () => {
    expect(decodePdfTextString(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x03, 0xa9]))).toBe(
      'A\u03a9',
    );
    expect(decodePdfTextString(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xa9, 0x03]))).toBe(
      'A\u03a9',
    );
  });

  it('preserves UTF-8 streams and incrementally decodes large UTF-16 streams', () => {
    expect(decodePdfTextString(new TextEncoder().encode('console.println("\u2713")'))).toBe(
      'console.println("\u2713")',
    );
    const units = 150_000;
    const bytes = new Uint8Array(2 + units * 2);
    bytes.set([0xfe, 0xff]);
    for (let index = 0; index < units; index += 1) {
      bytes[2 + index * 2] = 0;
      bytes[3 + index * 2] = 0x41;
    }
    expect(decodePdfTextString(bytes)).toHaveLength(units);
  });
});

describe('PDF font encoding inversion', () => {
  const cmap = `
    2 beginbfchar
    <01> <0041>
    <02> <03A9>
    endbfchar
    1 beginbfrange
    <10> <12> <0061>
    endbfrange
  `;

  it('inverts bfchar and bounded bfrange entries without inventing glyphs', () => {
    const inverse = invertToUnicodeCMap(cmap);
    expect([...(inverse.get('A') ?? [])]).toEqual([0x01]);
    expect([...(inverse.get('Ω') ?? [])]).toEqual([0x02]);
    expect([...encodeWithToUnicodeCMap('AabcΩ', cmap)]).toEqual([0x01, 0x10, 0x11, 0x12, 0x02]);
  });

  it('refuses a replacement glyph absent from the embedded subset', () => {
    expect(() => encodeWithToUnicodeCMap('Z', cmap)).toThrow(
      'glyph "Z" is absent from the embedded font subset',
    );
  });
});
