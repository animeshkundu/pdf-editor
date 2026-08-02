import { readFileSync } from 'node:fs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { withArenaSync } from '../lib/engine/worker/arena';
import { diffContentStreams, type ContentStreamTokenDiff } from '../lib/engine/worker/content';

function fixture(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(new URL(`fixtures/pdf-corpus/${name}`, import.meta.url)));
}

function physicalPageStreams(
  document: mupdf.PDFDocument,
  pageIndex: number,
): readonly Uint8Array[] {
  return withArenaSync((arena) => {
    const page = arena.keep(document.loadPage(pageIndex) as mupdf.PDFPage);
    const pageObject = arena.keep(page.getObject());
    const contents = arena.keep(pageObject.get('Contents'));
    if (contents.isStream()) {
      const buffer = arena.keep(contents.readStream());
      return [Uint8Array.from(buffer.asUint8Array())];
    }
    if (!contents.isArray()) return [];
    const streams: Uint8Array[] = [];
    for (let index = 0; index < contents.length; index += 1) {
      const stream = arena.keep(contents.get(index));
      if (!stream.isStream()) continue;
      const buffer = arena.keep(stream.readStream());
      streams.push(Uint8Array.from(buffer.asUint8Array()));
    }
    return streams;
  });
}

function filterPage(document: mupdf.PDFDocument, pageIndex: number): void {
  withArenaSync((arena) => {
    const page = arena.keep(document.loadPage(pageIndex) as mupdf.PDFPage);
    page.filterContents({
      recurse: true,
      instanceForms: false,
      ascii: false,
      noUpdate: false,
      newlines: true,
    });
  });
}

function measure(name: string): readonly ContentStreamTokenDiff[] {
  const document = mupdf.Document.openDocument(
    fixture(name),
    'application/pdf',
  ) as mupdf.PDFDocument;
  try {
    const reports: ContentStreamTokenDiff[] = [];
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const before = physicalPageStreams(document, pageIndex);
      filterPage(document, pageIndex);
      const after = physicalPageStreams(document, pageIndex);
      reports.push(diffContentStreams(before, after));
    }
    return reports;
  } finally {
    document.destroy();
  }
}

describe('ADR 0020 null-filter token diff', () => {
  it('measures stream consolidation and the page-dependent pdfTeX rewrite', () => {
    const libreOffice = measure('libreoffice.pdf');
    const pdfTex = measure('latex-pdftex.pdf');

    expect(libreOffice).toHaveLength(1);
    expect(libreOffice[0]).toMatchObject({
      beforeStreams: 3,
      afterStreams: 1,
      keywordDelta: { Td: -1, TD: 1 },
    });
    expect(pdfTex).toHaveLength(28);
    expect(pdfTex.every((page) => page.beforeStreams === 1 && page.afterStreams === 1)).toBe(
      true,
    );
    expect({
      q: pdfTex[0]?.keywordDelta.q,
      Q: pdfTex[0]?.keywordDelta.Q,
    }).toEqual({
      q: pdfTex[1]?.keywordDelta.q,
      Q: pdfTex[1]?.keywordDelta.Q,
    });
    expect(pdfTex[0]?.keywordDelta.Td).toBe(-29);
    expect(
      Math.min(...pdfTex.slice(1).map((page) => -(page.keywordDelta.Td ?? 0))),
    ).toBeGreaterThan(29);

    process.stdout.write(
      `[null-filter-token-diff] ${JSON.stringify(
        {
          libreOffice: libreOffice[0],
          pdfTex: pdfTex.map((page, index) => ({
            page: index + 1,
            beforeBytes: page.beforeBytes,
            afterBytes: page.afterBytes,
            beforeTokens: page.beforeTokens,
            afterTokens: page.afterTokens,
            changedBeforeTokens: page.changedBeforeTokens,
            changedAfterTokens: page.changedAfterTokens,
            keywordDelta: page.keywordDelta,
            firstBeforeChanges: page.firstBeforeChanges,
            firstAfterChanges: page.firstAfterChanges,
          })),
        },
        null,
        2,
      )}\n`,
    );
  });
});
