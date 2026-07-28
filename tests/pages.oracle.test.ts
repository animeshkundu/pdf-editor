import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import pageMutations from '../lib/engine/worker/mutations/pages';
import { journalOperation, journalState } from '../lib/engine/worker/mutations/transaction';
import { saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-pages-'));
let qpdf = '';

function createDocument(): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  for (const width of [200, 300, 400]) {
    const page = document.addPage([0, 0, width, 500], 0, null, new Uint8Array(0));
    try {
      document.insertPage(-1, page);
    } finally {
      page.destroy();
    }
  }
  document.enableJournal();
  return document;
}

function qpdfCheck(data: ArrayBuffer, name: string): void {
  const path = join(workDir, name);
  writeFileSync(path, new Uint8Array(data));
  const result = spawnSync(qpdf, ['--check', path], { encoding: 'utf8', shell: false });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

async function pageWidths(data: ArrayBuffer): Promise<number[]> {
  const task = getDocument({ data: Uint8Array.from(new Uint8Array(data)) });
  const document = await task.promise;
  try {
    const widths: number[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      widths.push(page.getViewport({ scale: 1 }).width);
      page.cleanup();
    }

    return widths;
  } finally {
    await task.destroy();
  }
}

async function pageLabels(data: ArrayBuffer): Promise<readonly string[] | null> {
  const task = getDocument({ data: Uint8Array.from(new Uint8Array(data)) });
  const document = await task.promise;
  try {
    return await document.getPageLabels();
  } finally {
    await task.destroy();
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

describe('PAGE-001/PAGE-003/PAGE-020 page mutation oracle', () => {
  it('reorders and inserts pages as one journal step each with independent-reader output', async () => {
    const document = createDocument();
    try {
      journalOperation(
        document,
        'Reverse pages',
        () => undefined,
        () => pageMutations.reorderPages(document, [2, 1, 0]),
      );
      expect(journalState(document)).toMatchObject({
        position: 1,
        steps: ['Reverse pages'],
      });
      const reversed = saveDocument(document, SAFE_FULL_SAVE);
      qpdfCheck(reversed, 'reversed.pdf');
      expect(await pageWidths(reversed)).toEqual([400, 300, 200]);

      journalOperation(
        document,
        'Insert blank page',
        () => undefined,
        (arena) => pageMutations.insertBlankPage(arena, document, 1, [0, 0, 250, 500]),
      );
      expect(journalState(document)).toMatchObject({
        position: 2,
        steps: ['Reverse pages', 'Insert blank page'],
      });
      const inserted = saveDocument(document, SAFE_FULL_SAVE);
      qpdfCheck(inserted, 'inserted.pdf');
      expect(await pageWidths(inserted)).toEqual([400, 250, 300, 200]);

      document.undo();
      expect(document.countPages()).toBe(3);
      const undone = saveDocument(document, SAFE_FULL_SAVE);
      qpdfCheck(undone, 'insert-undone.pdf');
      expect(await pageWidths(undone)).toEqual([400, 300, 200]);
    } finally {
      document.destroy();
    }
  });

  it('composes duplicate and incoming pages as one undoable mix operation', async () => {
    const document = createDocument();
    const incoming = new mupdf.PDFDocument();
    try {
      for (const width of [150, 250]) {
        const page = incoming.addPage([0, 0, width, 500], 0, null, new Uint8Array(0));
        try {
          incoming.insertPage(-1, page);
        } finally {
          page.destroy();
        }
      }
      const incomingBytes = saveDocument(incoming, SAFE_FULL_SAVE);
      journalOperation(
        document,
        'Alternate documents',
        () => undefined,
        (arena) =>
          pageMutations.composePages(arena, document, incomingBytes, [
            { source: 'current', pageIndex: 0 },
            { source: 'incoming', pageIndex: 0 },
            { source: 'current', pageIndex: 1 },
            { source: 'incoming', pageIndex: 1 },
            { source: 'current', pageIndex: 1 },
            { source: 'current', pageIndex: 2 },
          ]),
      );
      expect(journalState(document)).toMatchObject({
        position: 1,
        steps: ['Alternate documents'],
      });
      const output = saveDocument(document, SAFE_FULL_SAVE);
      qpdfCheck(output, 'alternate-mix.pdf');
      expect(await pageWidths(output)).toEqual([200, 150, 300, 250, 300, 400]);

      document.undo();
      expect(await pageWidths(saveDocument(document, SAFE_FULL_SAVE))).toEqual([200, 300, 400]);
    } finally {
      incoming.destroy();
      document.destroy();
    }
  });

  it('writes named page boxes and page labels as separate undoable operations', async () => {
    const document = createDocument();
    try {
      journalOperation(
        document,
        'Set crop box',
        () => undefined,
        (arena) =>
          pageMutations.setPageBoxes(arena, document, [0], 'CropBox', [10, 10, 190, 490]),
      );
      journalOperation(
        document,
        'Set page labels',
        () => undefined,
        () => pageMutations.setPageLabels(document, 0, 'decimal', 'A-', 5),
      );
      const output = saveDocument(document, SAFE_FULL_SAVE);
      qpdfCheck(output, 'boxes-and-labels.pdf');
      expect(await pageWidths(output)).toEqual([180, 300, 400]);
      expect(await pageLabels(output)).toEqual(['A-5', 'A-6', 'A-7']);
      expect(journalState(document)).toMatchObject({
        position: 2,
        steps: ['Set crop box', 'Set page labels'],
      });
    } finally {
      document.destroy();
    }
  });

  it('refuses page grafting when annotations would be omitted', () => {
    const document = createDocument();
    try {
      const page = document.loadPage(0);
      try {
        const annotation = page.createAnnotation('Text');
        try {
          annotation.setRect([10, 10, 30, 30]);
          annotation.setContents('Must not disappear');
          annotation.update();
        } finally {
          annotation.destroy();
        }
      } finally {
        page.destroy();
      }
      const before = journalState(document);

      expect(() =>
        journalOperation(
          document,
          'Duplicate annotated page',
          () => undefined,
          (arena) =>
            pageMutations.composePages(arena, document, undefined, [
              { source: 'current', pageIndex: 0 },
              { source: 'current', pageIndex: 0 },
              { source: 'current', pageIndex: 1 },
              { source: 'current', pageIndex: 2 },
            ]),
        ),
      ).toThrow('would omit 1 annotation');
      expect(journalState(document)).toMatchObject({
        position: before.position,
        steps: before.steps,
      });
      expect(document.countPages()).toBe(3);
    } finally {
      document.destroy();
    }
  });

  it('refuses page grafting when links would be omitted', () => {
    const document = createDocument();
    try {
      const page = document.loadPage(0);
      try {
        const link = page.createLink([10, 10, 30, 30], '#page=2');
        link.destroy();
      } finally {
        page.destroy();
      }
      const before = journalState(document);

      expect(() =>
        journalOperation(
          document,
          'Extract linked page',
          () => undefined,
          (arena) => pageMutations.extractPages(arena, document, [0]),
        ),
      ).toThrow('and 1 link');
      expect(journalState(document)).toMatchObject({
        position: before.position,
        steps: before.steps,
      });
    } finally {
      document.destroy();
    }
  });
});
