import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import annotationMutations from '../lib/engine/worker/mutations/annotations';
import { journalOperation, journalState } from '../lib/engine/worker/mutations/transaction';
import { saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';
import type { EngineTypes } from '../lib/engine/port';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-existing-text-'));
const standardFontDataUrl = fileURLToPath(
  new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url),
).replaceAll('\\', '/');
let qpdf = '';

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

function editableDocument(): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const font = new mupdf.Font('Helvetica');
  const fontObject = document.addSimpleFont(font);
  const fonts = document.newDictionary();
  const resources = document.newDictionary();
  const page = (() => {
    try {
      fonts.put('F1', fontObject);
      resources.put('Font', fonts);
      return document.addPage(
        [0, 0, 240, 180],
        0,
        resources,
        'BT /F1 12 Tf 20 100 Td (Prefix Original Suffix) Tj ET',
      );
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

async function pdfJsAnnotations(data: ArrayBuffer) {
  const loading = getDocument({ data: new Uint8Array(data.slice(0)), useSystemFonts: false });
  const document = await loading.promise;
  try {
    const page = await document.getPage(1);
    return await page.getAnnotations();
  } finally {
    await loading.destroy();
  }
}

async function pdfJsDarkPixelRatio(
  data: ArrayBuffer,
  rect: EngineTypes['PdfRect'],
): Promise<number> {
  const loading = getDocument({
    data: new Uint8Array(data.slice(0)),
    standardFontDataUrl,
    useSystemFonts: false,
  });
  const document = await loading.promise;
  try {
    const page = await document.getPage(1);
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const context = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    ).getContext('2d');
    await page.render({
      // @ts-expect-error pdf.js's Node path accepts the API-compatible canvas context.
      canvasContext: context,
      viewport,
    }).promise;
    const left = Math.max(0, Math.floor(rect[0] * scale));
    const top = Math.max(0, Math.floor(rect[1] * scale));
    const width = Math.max(1, Math.ceil((rect[2] - rect[0]) * scale));
    const height = Math.max(1, Math.ceil((rect[3] - rect[1]) * scale));
    const pixels = context.getImageData(left, top, width, height).data;
    let dark = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        pixels[offset]! < 96 &&
        pixels[offset + 1]! < 96 &&
        pixels[offset + 2]! < 96 &&
        pixels[offset + 3]! > 0
      ) {
        dark += 1;
      }
    }
    return dark / (pixels.length / 4);
  } finally {
    await loading.destroy();
  }
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

describe('existing-text edit safety', () => {
  it('abandons an unverifiable replacement without destroying the original text', async () => {
    const document = mupdf.Document.openDocument(
      fixture('cjk-itext.pdf'),
      'application/pdf',
    ) as mupdf.PDFDocument;
    document.enableJournal();
    try {
      const input = selectedInput(document, '사회복지법인', '사회');
      expect(() => annotationMutations.inspectExistingTextEdit(document, input)).toThrow(
        'supports printable ASCII replacements only',
      );
      expect(journalState(document)).toMatchObject({ position: 0, steps: [], canUndo: false });

      const output = saveDocument(document, SAFE_FULL_SAVE);
      expect(await pdfJsText(output)).toContain('사회복지법인');
    } finally {
      document.destroy();
    }
  });

  it('replaces one verified ASCII run and exposes its appearance to independent readers', async () => {
    const document = editableDocument();
    try {
      const input = selectedInput(document, 'Original', 'Revised');
      const preflight = annotationMutations.inspectExistingTextEdit(document, input);
      const annotation = journalOperation(
        document,
        'Edit existing text',
        () => undefined,
        (arena) => annotationMutations.editExistingText(arena, document, input, preflight),
      );
      expect(annotation).toMatchObject({ type: 'FreeText', contents: 'Revised' });
      expect(journalState(document)).toMatchObject({
        position: 1,
        steps: ['Edit existing text'],
        canUndo: true,
      });

      const output = saveDocument(document, SAFE_FULL_SAVE);
      expect(await pdfJsText(output)).toBe('Prefix Suffix');
      const annotations = await pdfJsAnnotations(output);
      expect(annotations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subtype: 'FreeText',
            contentsObj: expect.objectContaining({ str: 'Revised' }),
            hasAppearance: true,
          }),
        ]),
      );
      const replacementRatio = await pdfJsDarkPixelRatio(output, preflight.rect);
      expect(replacementRatio).toBeGreaterThan(0.005);
      expect(replacementRatio).toBeLessThan(0.5);

      const path = join(workDir, 'verified-ascii-edit.pdf');
      writeFileSync(path, new Uint8Array(output));
      const check = spawnSync(qpdf, ['--check', path], { encoding: 'utf8', shell: false });
      expect(check.status, check.stderr || check.stdout).toBe(0);
    } finally {
      document.destroy();
    }
  });

  it('rolls back a failure after glyph removal so the original remains readable', async () => {
    const document = editableDocument();
    try {
      const input = selectedInput(document, 'Original', 'Revised');
      expect(() =>
        journalOperation(
          document,
          'Injected failed text edit',
          () => undefined,
          (arena) => {
            const page = arena.keep(document.loadPage(0));
            const redaction = arena.keep(page.createAnnotation('Redact'));
            redaction.setQuadPoints(input.quads.map((quad) => [...quad]));
            redaction.update();
            page.applyRedactions(
              true,
              mupdf.PDFPage.REDACT_IMAGE_REMOVE,
              mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
              mupdf.PDFPage.REDACT_TEXT_REMOVE,
            );
            throw new Error('Injected replacement failure');
          },
        ),
      ).toThrow('Injected replacement failure');
      expect(journalState(document)).toMatchObject({ position: 0, steps: [], canUndo: false });
      expect(await pdfJsText(saveDocument(document, SAFE_FULL_SAVE))).toBe(
        'Prefix Original Suffix',
      );
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
      const input = selectedInput(document, 'Mathematical', 'Mathematical');
      expect(
        annotationMutations.inspectExistingTextEdit(document, input).fontName,
      ).toBeTruthy();
    } finally {
      document.destroy();
    }
  });
});
