import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import annotationMutations from '../lib/engine/worker/mutations/annotations';
import { journalOperation, journalState } from '../lib/engine/worker/mutations/transaction';
import { saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';
import type { EngineTypes } from '../lib/engine/port';

function fixture(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(new URL(`fixtures/pdf-corpus/${name}`, import.meta.url)));
}

function selectedInput(
  document: mupdf.PDFDocument,
  originalText: string,
  replacementText: string,
): EngineTypes['ExistingTextEditInput'] {
  const page = document.loadPage(0) as mupdf.PDFPage;
  const text = page.toStructuredText();
  try {
    const matches = text.search(originalText, 1);
    const quads = matches[0];
    if (!quads?.length)
      throw new Error(`Fixture does not contain ${JSON.stringify(originalText)}.`);
    return {
      pageIndex: 0,
      originalText,
      replacementText,
      quads,
      confirmSignatureInvalidation: false,
    };
  } finally {
    text.destroy();
    page.destroy();
  }
}

async function pdfJsText(data: ArrayBuffer): Promise<string> {
  const loading = getDocument({ data: new Uint8Array(data) });
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

describe('existing-text edit safety', () => {
  it('abandons an unverifiable replacement without destroying the original text', async () => {
    const document = mupdf.Document.openDocument(
      fixture('cjk-itext.pdf'),
      'application/pdf',
    ) as mupdf.PDFDocument;
    document.enableJournal();
    try {
      const input = selectedInput(document, '사회복지법인', '사회');
      const preflight = annotationMutations.inspectExistingTextEdit(document, input);
      expect(() =>
        journalOperation(
          document,
          'Edit existing text',
          () => undefined,
          (arena) => annotationMutations.editExistingText(arena, document, input, preflight),
        ),
      ).toThrow('replacement cannot yet be verified by an independent PDF reader');
      expect(journalState(document)).toMatchObject({ position: 0, steps: [], canUndo: false });

      const output = saveDocument(document, SAFE_FULL_SAVE);
      expect(await pdfJsText(output)).toContain('사회복지법인');
    } finally {
      document.destroy();
    }
  });

  it('ties a single-font line to its selected run instead of all fonts on the page', () => {
    const document = mupdf.Document.openDocument(
      fixture('latex-pdftex.pdf'),
      'application/pdf',
    ) as mupdf.PDFDocument;
    try {
      const input = selectedInput(document, 'CWEB', 'CWEB');
      expect(
        annotationMutations.inspectExistingTextEdit(document, input).fontName,
      ).toBeTruthy();
    } finally {
      document.destroy();
    }
  });
});
