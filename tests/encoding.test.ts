import { decodePdfTextString } from '../lib/text/encoding';

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
