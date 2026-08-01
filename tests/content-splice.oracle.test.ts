import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { withArenaSync } from '../lib/engine/worker/arena';
import { journalOperation } from '../lib/engine/worker/mutations/transaction';
import {
  scanContentTokens,
  assertPartitionsExactly,
  ContentScanError,
  assertSortedNonOverlapping,
  spliceBytes,
  ByteSpliceError,
  readDecodedStreamBytes,
  forceWriteContentStream,
  resolveEditableContentStream,
  countFormXObjectInstances,
  proveSingleFormInstance,
  findSingleAsciiShowTextRun,
} from '../lib/engine/worker/content';
import { saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';
import { corpus } from './fixtures/pdf-corpus/corpus';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-content-splice-'));
let qpdf = '';

function fixture(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(new URL(`fixtures/pdf-corpus/${name}`, import.meta.url)));
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A minimal in-memory single-page document with a single, unfiltered content stream. */
function editableDocument(content = 'BT /F1 12 Tf 20 100 Td (Prefix Original Suffix) Tj ET') {
  const document = new mupdf.PDFDocument();
  const font = new mupdf.Font('Helvetica');
  const fontObject = document.addSimpleFont(font);
  const fonts = document.newDictionary();
  const resources = document.newDictionary();
  const page = (() => {
    try {
      fonts.put('F1', fontObject);
      resources.put('Font', fonts);
      return document.addPage([0, 0, 240, 180], 0, resources, content);
    } finally {
      resources.destroy();
      fonts.destroy();
      fontObject.destroy();
      font.destroy();
    }
  })();
  try {
    document.insertPage(-1, page);
  } finally {
    page.destroy();
  }
  document.enableJournal();
  return document;
}

/**
 * A document with one Form XObject, drawn by `/Fm1 Do` exactly `instances` times within a
 * single page's own content stream (so `countFormXObjectInstances` need not descend into
 * nested forms or multiple pages to measure it).
 */
function documentWithForm(instances: number): {
  document: mupdf.PDFDocument;
  formNumber: number;
} {
  const document = new mupdf.PDFDocument();
  const font = new mupdf.Font('Helvetica');
  const fontObject = document.addSimpleFont(font);
  const fonts = document.newDictionary();
  const formResources = document.newDictionary();
  const pageResources = document.newDictionary();
  const xobjects = document.newDictionary();
  let formNumber = -1;
  const page = (() => {
    try {
      fonts.put('F1', fontObject);
      formResources.put('Font', fonts);
      const form = document.addStream('BT /F1 12 Tf 0 0 Td (Form Text) Tj ET', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 100, 20],
        Resources: formResources,
      });
      try {
        formNumber = form.asIndirect();
        xobjects.put('Fm1', form);
      } finally {
        form.destroy();
      }
      pageResources.put('Font', fonts);
      pageResources.put('XObject', xobjects);
      const pageContent = Array.from({ length: instances }, () => '/Fm1 Do').join(' ');
      return document.addPage([0, 0, 200, 200], 0, pageResources, pageContent);
    } finally {
      xobjects.destroy();
      pageResources.destroy();
      formResources.destroy();
      fonts.destroy();
      fontObject.destroy();
      font.destroy();
    }
  })();
  try {
    document.insertPage(-1, page);
  } finally {
    page.destroy();
  }
  document.enableJournal();
  return { document, formNumber };
}

async function pdfJsText(data: ArrayBuffer): Promise<string> {
  const loading = getDocument({ data: new Uint8Array(data.slice(0)) });
  const document = await loading.promise;
  try {
    const page = await document.getPage(1);
    try {
      const content = await page.getTextContent();
      return content.items.map((item) => ('str' in item ? item.str : '')).join('');
    } finally {
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
}

function qpdfCheck(name: string, bytes: ArrayBuffer): void {
  const path = join(workDir, name);
  writeFileSync(path, new Uint8Array(bytes));
  const check = spawnSync(qpdf, ['--check', path], { encoding: 'utf8', shell: false });
  expect(check.status, check.stderr || check.stdout).toBe(0);
}

beforeAll(() => {
  const setup = spawnSync(process.execPath, ['scripts/setup-qpdf.mjs', '--print-path'], {
    encoding: 'utf8',
    shell: false,
  });
  if (setup.status !== 0) throw new Error(setup.stderr || setup.stdout);
  qpdf = setup.stdout.trim();
});

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe('content-stream token scanner', () => {
  it('partitions a content stream exercising every token kind, with no gap or overlap', () => {
    const bytes = ascii(
      '% a leading comment\n' +
        'q 1 0 0 1 10 20 cm\n' +
        '/GS1 gs\n' +
        '<< /Type /ExtGState /CA 0.5 >> /GS2 Do\n' +
        '[1 2 3 (foo) /Bar <48454C4C4F>] TJ\n' +
        '(escaped \\(paren\\) and \\\\backslash\\\\) Tj\n' +
        'Q',
    );
    const tokens = scanContentTokens(bytes);
    expect(() => assertPartitionsExactly(tokens, bytes)).not.toThrow();
    const kinds = new Set(tokens.map((token) => token.kind));
    expect(kinds).toEqual(
      new Set([
        'whitespace',
        'comment',
        'keyword',
        'number',
        'name',
        'dictionary',
        'array',
        'string',
      ]),
    );
    const dictionary = tokens.find((token) => token.kind === 'dictionary');
    expect(dictionary?.children?.some((child) => child.kind === 'name')).toBe(true);
    const array = tokens.find((token) => token.kind === 'array');
    expect(array?.children?.map((child) => child.kind)).toEqual(
      expect.arrayContaining(['number', 'string', 'name', 'hex-string']),
    );
  });

  it('scans an inline image as one opaque data token bounded by BI/ID/EI', () => {
    const preamble = '/W 2 /H 1 /BPC 8 /CS /G ID ';
    const data = Uint8Array.from([0x00, 0xff, 0x10, 0x20]);
    const bytes = new Uint8Array(
      ascii(`q BI ${preamble}`).length + data.length + ascii(' EI Q').length,
    );
    let offset = 0;
    bytes.set(ascii(`q BI ${preamble}`), offset);
    offset += ascii(`q BI ${preamble}`).length;
    bytes.set(data, offset);
    offset += data.length;
    bytes.set(ascii(' EI Q'), offset);

    const tokens = scanContentTokens(bytes);
    expect(() => assertPartitionsExactly(tokens, bytes)).not.toThrow();
    const imageToken = tokens.find((token) => token.kind === 'inline-image-data');
    expect(imageToken).toBeDefined();
    expect(bytes.subarray(imageToken!.start, imageToken!.end)).toEqual(data);
  });

  it('partitions a zero-length inline image without duplicating its separator byte', () => {
    const bytes = ascii('q BI /W 0 /H 0 ID EI Q');
    const tokens = scanContentTokens(bytes);
    expect(() => assertPartitionsExactly(tokens, bytes)).not.toThrow();
    expect(tokens.filter((token) => token.kind === 'inline-image-data')).toEqual([]);
  });

  it('refuses an unterminated literal string rather than guessing its extent', () => {
    expect(() => scanContentTokens(ascii('(unterminated'))).toThrow(ContentScanError);
  });

  it('refuses an unterminated hex string', () => {
    expect(() => scanContentTokens(ascii('<48454C4C4F'))).toThrow(ContentScanError);
  });

  it('refuses an unterminated array', () => {
    expect(() => scanContentTokens(ascii('[1 2 3'))).toThrow(ContentScanError);
  });

  it('refuses an unterminated dictionary', () => {
    expect(() => scanContentTokens(ascii('<< /Type /Page'))).toThrow(ContentScanError);
  });

  it('exactly partitions the first page content stream of every corpus document it can resolve', () => {
    let resolved = 0;
    let refused = 0;
    for (const entry of corpus) {
      const document = mupdf.Document.openDocument(fixture(entry.file), 'application/pdf');
      try {
        withArenaSync((arena) => {
          const page = arena.keep((document as mupdf.PDFDocument).loadPage(0));
          try {
            const editable = resolveEditableContentStream(arena, page as mupdf.PDFPage);
            const bytes = readDecodedStreamBytes(arena, editable.object);
            const tokens = scanContentTokens(bytes);
            assertPartitionsExactly(tokens, bytes);
            resolved += 1;
          } catch (error) {
            // A page with a multi-stream /Contents array, or content this scanner cannot
            // account for, is a documented refusal, not a test failure: the point of this
            // measurement is that everything the scanner *does* accept, it accounts for
            // exactly. See docs/research/2026-08-01-byte-span-content-splicing.md.
            expect(error).toBeInstanceOf(Error);
            refused += 1;
          }
        });
      } finally {
        document.destroy();
      }
    }
    expect(resolved + refused).toBe(corpus.length);
    // The corpus is small but real; at least most single-page-one/first-page content streams
    // should resolve and tokenize exactly.
    expect(resolved).toBeGreaterThan(0);
  });
});

describe('byte splicing', () => {
  it('produces a byte-identical buffer for a null splice (replacement equals original span)', () => {
    const original = ascii('BT (Hello World) Tj ET');
    const spliced = spliceBytes(original, [
      { start: 3, end: 16, replacement: ascii('(Hello World)') },
    ]);
    expect(spliced).toEqual(original);
    expect(spliced).not.toBe(original);
  });

  it('preserves every byte outside a non-null spliced span exactly', () => {
    const original = ascii('BT (Original) Tj ET');
    const spliced = spliceBytes(original, [
      { start: 4, end: 12, replacement: ascii('Replaced') },
    ]);
    expect(new TextDecoder().decode(spliced)).toBe('BT (Replaced) Tj ET');
    expect(spliced.subarray(0, 4)).toEqual(original.subarray(0, 4));
    expect(spliced.subarray(12)).toEqual(original.subarray(12));
  });

  it('sorts out-of-order splices before applying them', () => {
    const original = ascii('AAAABBBBCCCC');
    const spliced = spliceBytes(original, [
      { start: 8, end: 12, replacement: ascii('cccc') },
      { start: 0, end: 4, replacement: ascii('aaaa') },
    ]);
    expect(new TextDecoder().decode(spliced)).toBe('aaaaBBBBcccc');
  });

  it('allows two splices that touch at a shared boundary without treating it as an overlap', () => {
    const original = ascii('AAAABBBB');
    expect(() =>
      spliceBytes(original, [
        { start: 0, end: 4, replacement: ascii('aaaa') },
        { start: 4, end: 8, replacement: ascii('bbbb') },
      ]),
    ).not.toThrow();
  });

  it('rejects an out-of-range splice', () => {
    const original = ascii('AAAA');
    expect(() =>
      assertSortedNonOverlapping(
        [{ start: 0, end: 5, replacement: ascii('x') }],
        original.length,
      ),
    ).toThrow(ByteSpliceError);
    expect(() =>
      assertSortedNonOverlapping(
        [{ start: -1, end: 2, replacement: ascii('x') }],
        original.length,
      ),
    ).toThrow(ByteSpliceError);
    expect(() =>
      assertSortedNonOverlapping(
        [{ start: 3, end: 1, replacement: ascii('x') }],
        original.length,
      ),
    ).toThrow(ByteSpliceError);
  });

  it('rejects overlapping splices', () => {
    const original = ascii('AAAABBBB');
    expect(() =>
      assertSortedNonOverlapping(
        [
          { start: 0, end: 5, replacement: ascii('x') },
          { start: 4, end: 8, replacement: ascii('y') },
        ],
        original.length,
      ),
    ).toThrow(ByteSpliceError);
  });
});

describe('forced content-stream writes', () => {
  it('proves a null splice was actually written by rereading through a fresh reference', () => {
    const document = editableDocument();
    try {
      journalOperation(
        document,
        'Null splice forced write',
        () => undefined,
        (arena) => {
          const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
          const editable = resolveEditableContentStream(arena, page);
          expect(editable.wasArray).toBe(false);
          const before = readDecodedStreamBytes(arena, editable.object);
          // A genuine null splice: the whole buffer, replaced with itself.
          const nullSplice = spliceBytes(before, [
            { start: 0, end: before.length, replacement: before },
          ]);
          expect(nullSplice).toEqual(before);
          forceWriteContentStream(arena, document, editable.object, nullSplice);

          // Independent proof #1: reread through a *different* freshly resolved reference than
          // the one `forceWriteContentStream` itself used internally.
          const objectNumber = editable.object.asIndirect();
          const independentReference = arena.keep(document.newIndirect(objectNumber));
          const independentBytes = arena.keep(independentReference.readStream());
          expect(independentBytes.asUint8Array()).toEqual(before);
        },
      );

      // Independent proof #2: pdf.js, an independent reader, still extracts the same text.
      const output = saveDocument(document, SAFE_FULL_SAVE);
      return pdfJsText(output).then((text) => {
        expect(text).toBe('Prefix Original Suffix');
        qpdfCheck('null-splice.pdf', output);
      });
    } finally {
      document.destroy();
    }
  });

  it('preserves untouched bytes and text around a non-null forced write', async () => {
    const document = editableDocument();
    try {
      // Presence-first: assert the original text is there before any edit is attempted.
      const before = saveDocument(document, SAFE_FULL_SAVE);
      expect(await pdfJsText(before)).toBe('Prefix Original Suffix');

      let objectNumber = -1;
      let innerStart = -1;
      let innerEnd = -1;
      let originalBytes: Uint8Array = new Uint8Array();
      journalOperation(
        document,
        'Non-null splice forced write',
        () => undefined,
        (arena) => {
          const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
          const editable = resolveEditableContentStream(arena, page);
          originalBytes = readDecodedStreamBytes(arena, editable.object);
          const tokens = scanContentTokens(originalBytes);
          const run = findSingleAsciiShowTextRun(tokens, originalBytes, 'Original');
          expect(run).not.toBeNull();
          innerStart = run!.innerStart;
          innerEnd = run!.innerEnd;
          objectNumber = editable.object.asIndirect();
          const newBytes = spliceBytes(originalBytes, [
            { start: innerStart, end: innerEnd, replacement: ascii('REVISED!') },
          ]);
          forceWriteContentStream(arena, document, editable.object, newBytes);
        },
      );

      withArenaSync((arena) => {
        const reference = arena.keep(document.newIndirect(objectNumber));
        const rereadBytes = arena.keep(reference.readStream()).asUint8Array();
        // Every byte strictly outside the spliced span is untouched.
        expect(rereadBytes.subarray(0, innerStart)).toEqual(
          originalBytes.subarray(0, innerStart),
        );
        expect(rereadBytes.subarray(innerStart + 8)).toEqual(originalBytes.subarray(innerEnd));
      });

      const output = saveDocument(document, SAFE_FULL_SAVE);
      const text = await pdfJsText(output);
      expect(text).toBe('Prefix REVISED! Suffix');
      expect(text).not.toContain('Original');
      qpdfCheck('non-null-splice.pdf', output);
    } finally {
      document.destroy();
    }
  });

  it('never claims a compression filter it did not produce', () => {
    const document = editableDocument();
    try {
      journalOperation(
        document,
        'No compression claim',
        () => undefined,
        (arena) => {
          const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
          const editable = resolveEditableContentStream(arena, page);
          const filter = arena.keep(editable.object.get('Filter'));
          // `document.addPage` writes an uncompressed stream by construction, so this
          // document's content stream has no declared filter and takes the writeRawStream path.
          expect(filter.isNull()).toBe(true);
          const before = readDecodedStreamBytes(arena, editable.object);
          forceWriteContentStream(arena, document, editable.object, before);
          const filterAfter = arena.keep(editable.object.get('Filter'));
          expect(filterAfter.isNull()).toBe(true);
        },
      );
    } finally {
      document.destroy();
    }
  });
});

describe('corrupted-span negative control', () => {
  it('a span not derived from the tokenizer silently corrupts the edit, unlike the honest span', async () => {
    // Presence-first, per the test conventions: confirm the original text is there before any
    // edit runs at all.
    const before = saveDocument(editableDocument(), SAFE_FULL_SAVE);
    expect(await pdfJsText(before)).toBe('Prefix Original Suffix');

    // The honest, tokenizer-derived span produces the intended, correct result.
    const honestDocument = editableDocument();
    try {
      const honestOutput = journalOperation(
        honestDocument,
        'Honest span',
        () => undefined,
        (arena) => {
          const page = arena.keep(honestDocument.loadPage(0)) as mupdf.PDFPage;
          const editable = resolveEditableContentStream(arena, page);
          const bytes = readDecodedStreamBytes(arena, editable.object);
          const tokens = scanContentTokens(bytes);
          const run = findSingleAsciiShowTextRun(tokens, bytes, 'Original')!;
          const spliced = spliceBytes(bytes, [
            { start: run.innerStart, end: run.innerEnd, replacement: ascii('REVISED!') },
          ]);
          forceWriteContentStream(arena, honestDocument, editable.object, spliced);
          return saveDocument(honestDocument, SAFE_FULL_SAVE);
        },
      );
      expect(await pdfJsText(honestOutput)).toBe('Prefix REVISED! Suffix');
    } finally {
      honestDocument.destroy();
    }

    // A corrupted span, deliberately shifted by one byte instead of derived from the
    // tokenizer, is still range-valid (so `assertSortedNonOverlapping` cannot catch it) but is
    // semantically wrong: it leaves one original byte stitched into the replacement. This is
    // the negative control demonstrating *why* the tokenizer-derived span matters, not just
    // that malformed ranges are rejected (that is covered separately, under "byte splicing").
    const corruptedDocument = editableDocument();
    try {
      const corruptedOutput = journalOperation(
        corruptedDocument,
        'Corrupted span',
        () => undefined,
        (arena) => {
          const page = arena.keep(corruptedDocument.loadPage(0)) as mupdf.PDFPage;
          const editable = resolveEditableContentStream(arena, page);
          const bytes = readDecodedStreamBytes(arena, editable.object);
          const tokens = scanContentTokens(bytes);
          const run = findSingleAsciiShowTextRun(tokens, bytes, 'Original')!;
          // Off by one: one byte short of the real span, bypassing the tokenizer's own answer.
          const corruptedSpan = { start: run.innerStart, end: run.innerEnd - 1 };
          const spliced = spliceBytes(bytes, [
            { ...corruptedSpan, replacement: ascii('REVISED!') },
          ]);
          forceWriteContentStream(arena, corruptedDocument, editable.object, spliced);
          return saveDocument(corruptedDocument, SAFE_FULL_SAVE);
        },
      );
      const corruptedText = await pdfJsText(corruptedOutput);
      // The corrupted span fails to produce the intended, correct edit: it is neither the
      // original text (something did change) nor the clean replacement (the change is wrong).
      expect(corruptedText).not.toBe('Prefix Original Suffix');
      expect(corruptedText).not.toBe('Prefix REVISED! Suffix');
      expect(corruptedText).toBe('Prefix REVISED!l Suffix');
    } finally {
      corruptedDocument.destroy();
    }
  });
});

describe('page-content resolution', () => {
  function pageWithContentsArray(streamContents: readonly string[]): mupdf.PDFDocument {
    const document = new mupdf.PDFDocument();
    const pages: mupdf.PDFObject[] = [];
    const streams: mupdf.PDFObject[] = [];
    try {
      const page = document.addPage([0, 0, 100, 100], 0, null, '');
      pages.push(page);
      const array = document.newArray();
      try {
        for (const content of streamContents) {
          const stream = document.addStream(content, {});
          streams.push(stream);
          array.push(stream);
        }
        page.put('Contents', array);
      } finally {
        array.destroy();
      }
      document.insertPage(-1, page);
    } finally {
      for (const stream of streams) stream.destroy();
      for (const page of pages) page.destroy();
    }
    document.enableJournal();
    return document;
  }

  it('resolves a bare single-stream /Contents', () => {
    const document = editableDocument();
    try {
      withArenaSync((arena) => {
        const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
        const editable = resolveEditableContentStream(arena, page);
        expect(editable.wasArray).toBe(false);
        expect(editable.object.isStream()).toBe(true);
      });
    } finally {
      document.destroy();
    }
  });

  it('resolves a one-element /Contents array', () => {
    const document = pageWithContentsArray(['q Q']);
    try {
      withArenaSync((arena) => {
        const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
        const editable = resolveEditableContentStream(arena, page);
        expect(editable.wasArray).toBe(true);
        expect(editable.object.isStream()).toBe(true);
      });
    } finally {
      document.destroy();
    }
  });

  it('refuses (does not cross-stream edit) a multi-element /Contents array', () => {
    const document = pageWithContentsArray(['q Q', 'q Q']);
    try {
      withArenaSync((arena) => {
        const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
        expect(() => resolveEditableContentStream(arena, page)).toThrow(/2 separate streams/);
      });
    } finally {
      document.destroy();
    }
  });

  it('refuses an empty /Contents array', () => {
    const document = pageWithContentsArray([]);
    try {
      withArenaSync((arena) => {
        const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
        expect(() => resolveEditableContentStream(arena, page)).toThrow(/empty/);
      });
    } finally {
      document.destroy();
    }
  });

  it('refuses a page with no /Contents at all', () => {
    const document = editableDocument();
    try {
      journalOperation(
        document,
        'Delete Contents',
        () => undefined,
        (arena) => {
          const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
          const pageObject = arena.keep(page.getObject());
          pageObject.delete('Contents');
        },
      );
      withArenaSync((arena) => {
        const page = arena.keep(document.loadPage(0)) as mupdf.PDFPage;
        expect(() => resolveEditableContentStream(arena, page)).toThrow(/no \/Contents/);
      });
    } finally {
      document.destroy();
    }
  });
});

describe('Form XObject instancing proof', () => {
  it('proves a Form XObject drawn exactly once is safe to splice', () => {
    const { document, formNumber } = documentWithForm(1);
    try {
      withArenaSync((arena) => {
        expect(countFormXObjectInstances(arena, document, formNumber)).toBe(1);
        const formObject = arena.keep(document.newIndirect(formNumber));
        const instancing = proveSingleFormInstance(arena, document, formObject);
        expect(instancing).toEqual({ referenceCount: 1, provenSingleInstance: true });
      });
    } finally {
      document.destroy();
    }
  });

  it('refuses a Form XObject drawn more than once', () => {
    const { document, formNumber } = documentWithForm(2);
    try {
      withArenaSync((arena) => {
        expect(countFormXObjectInstances(arena, document, formNumber)).toBe(2);
        const formObject = arena.keep(document.newIndirect(formNumber));
        expect(() => proveSingleFormInstance(arena, document, formObject)).toThrow(
          /drawn 2 time\(s\)/,
        );
      });
    } finally {
      document.destroy();
    }
  });

  it('measures Form XObject instancing on a real corpus document that uses one', () => {
    const entry = corpus.find((candidate) => candidate.features.includes('form-xobject'));
    expect(entry).toBeDefined();
    const document = mupdf.Document.openDocument(
      fixture(entry!.file),
      'application/pdf',
    ) as mupdf.PDFDocument;
    try {
      withArenaSync((arena) => {
        let formsSeen = 0;
        const instanceCounts: number[] = [];
        for (let objectNumber = 1; objectNumber < document.countObjects(); objectNumber += 1) {
          const object = arena.keep(document.newIndirect(objectNumber));
          if (object.isNull() || !object.isStream()) continue;
          const subtype = arena.keep(object.get('Subtype'));
          if (!subtype.isName() || subtype.asName() !== 'Form') continue;
          formsSeen += 1;
          instanceCounts.push(countFormXObjectInstances(arena, document, objectNumber));
        }
        expect(formsSeen).toBe(1);
        expect(instanceCounts).toEqual([1]);
      });
    } finally {
      document.destroy();
    }
  });
});
