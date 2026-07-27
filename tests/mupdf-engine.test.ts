import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';

function createOperatorFixture(): Uint8Array {
  const document = new mupdf.PDFDocument();
  const font = new mupdf.Font('Helvetica');
  const fontObject = document.addSimpleFont(font);
  const tintFunction = document.addStream('{ pop pop pop pop pop pop pop 0 0 0 0 }', {
    FunctionType: 4,
    Domain: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    Range: [0, 1, 0, 1, 0, 1, 0, 1],
  });
  const fonts = document.newDictionary();
  const resources = document.newDictionary();
  let pageObject: mupdf.PDFObject | undefined;
  let saved: mupdf.Buffer | undefined;

  try {
    fonts.put('F1', fontObject);
    resources.put('Font', fonts);
    resources._putValue('ColorSpace', {
      CS1: ['DeviceN', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], 'DeviceCMYK', tintFunction],
    });
    const contents = [
      '/P << /MCID 7 >> BDC',
      '1 j 2 J',
      'BT /F1 12 Tf 3 Tr 20 100 Td (Hello) Tj ET',
      'EMC',
      '/CS1 cs 0.1 0.2 0.3 0.4 0.5 0.6 0.7 scn',
      'q 10 0 0 10 20 20 cm',
      'BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID FF0000> EI',
      'Q',
      '',
    ].join('\n');
    pageObject = document.addPage([0, 0, 200, 200], 0, resources, contents);
    document.insertPage(-1, pageObject);
    saved = document.saveToBuffer('compress');
    return Uint8Array.from(saved.asUint8Array());
  } finally {
    saved?.destroy();
    pageObject?.destroy();
    resources.destroy();
    fonts.destroy();
    fontObject.destroy();
    tintFunction.destroy();
    font.destroy();
    document.destroy();
  }
}

describe('forked MuPDF processor bindings', () => {
  it('surfaces resolved Tf, cooked BDC, and decoded BI records from a real page', () => {
    const document = mupdf.Document.openDocument(
      createOperatorFixture(),
      'application/pdf',
    ) as mupdf.PDFDocument;
    const page = document.loadPage(0) as mupdf.PDFPage;
    const trace = page.processContents();

    try {
      const records = trace.getRecords();
      expect(records.map((record) => record.operator)).toEqual([
        'BDC',
        'j',
        'J',
        'BT',
        'Tf',
        'Tr',
        'Td',
        'Tj',
        'ET',
        'EMC',
        'cs',
        'sc_color',
        'q',
        'cm',
        'BI',
        'Q',
        'EOD',
        'END',
      ]);

      const font = records.find((record) => record.operator === 'Tf');
      expect(font?.name).toBe('F1');
      expect(font?.font?.getName()).toBe('Helvetica');
      expect(font?.font?.isEmbedded()).toBe(false);
      expect(font?.font?.getWritingMode()).toBe(0);
      expect(font?.operands[0]).toBe(12);
      expect(records.find((record) => record.operator === 'j')?.operands[0]).toBe(1);
      expect(records.find((record) => record.operator === 'J')?.operands[0]).toBe(2);
      expect(records.find((record) => record.operator === 'Tr')?.operands[0]).toBe(3);

      const markedContent = records.find((record) => record.operator === 'BDC');
      expect(markedContent?.name).toBe('P');
      expect(markedContent?.cooked?.isDictionary()).toBe(true);
      expect(markedContent?.cooked?.get('MCID').asNumber()).toBe(7);

      const inlineImage = records.find((record) => record.operator === 'BI');
      expect(inlineImage?.name).toBe('RGB');
      expect(inlineImage?.image?.getWidth()).toBe(1);
      expect(inlineImage?.image?.getHeight()).toBe(1);
      expect(inlineImage?.image?.getNumberOfComponents()).toBe(3);

      expect(records.find((record) => record.operator === 'sc_color')?.operands).toEqual([
        expect.closeTo(0.1),
        expect.closeTo(0.2),
        expect.closeTo(0.3),
        expect.closeTo(0.4),
        expect.closeTo(0.5),
        expect.closeTo(0.6),
        expect.closeTo(0.7),
      ]);
    } finally {
      trace.destroy();
      page.destroy();
      document.destroy();
    }
  });

  it('rejects record access after deterministic trace destruction', () => {
    const document = mupdf.Document.openDocument(
      createOperatorFixture(),
      'application/pdf',
    ) as mupdf.PDFDocument;
    const page = document.loadPage(0) as mupdf.PDFPage;
    const trace = page.processContents();

    trace.destroy();
    expect(() => trace.getRecords()).toThrow('PDF processor trace has been destroyed');
    page.destroy();
    document.destroy();
  });
});
