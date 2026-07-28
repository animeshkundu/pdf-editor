import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import annotationMutations from '../lib/engine/worker/mutations/annotations';
import { journalOperation, journalState } from '../lib/engine/worker/mutations/transaction';
import { saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-annotation-'));
let qpdf = '';

function createDocument(): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const page = document.addPage([0, 0, 300, 300], 0, null, new Uint8Array(0));
  try {
    document.insertPage(-1, page);
  } finally {
    page.destroy();
  }
  document.enableJournal();
  return document;
}

async function pdfJsAnnotations(data: ArrayBuffer) {
  const task = getDocument({ data: new Uint8Array(data) });
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    try {
      return await page.getAnnotations();
    } finally {
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}

function expectQpdfAccepts(data: ArrayBuffer, name: string): void {
  const path = join(workDir, name);
  writeFileSync(path, new Uint8Array(data));
  const result = spawnSync(qpdf, ['--check', path], {
    encoding: 'utf8',
    shell: false,
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
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

describe('MARK-001 worker mutation oracle', () => {
  it('commits one annotation action, undoes it as one step, and saves interoperable output', async () => {
    const document = createDocument();
    try {
      const created = journalOperation(
        document,
        'Add sticky note',
        () => undefined,
        (arena) =>
          annotationMutations.addAnnotation(arena, document, {
            pageIndex: 0,
            type: 'Text',
            rect: [40, 50, 68, 78],
            contents: 'Independent reader note',
            author: 'Local reviewer',
            color: [1, 0.82, 0],
          }),
      );

      expect(created.type).toBe('Text');
      expect(journalState(document)).toMatchObject({
        position: 1,
        steps: ['Add sticky note'],
        canUndo: true,
        canRedo: false,
      });

      const output = saveDocument(document, SAFE_FULL_SAVE);
      expectQpdfAccepts(output, 'with-note.pdf');
      const annotations = await pdfJsAnnotations(output);
      const notes = annotations.filter((annotation) => annotation.subtype === 'Text');
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        subtype: 'Text',
        contentsObj: { str: 'Independent reader note' },
        titleObj: { str: 'Local reviewer' },
      });
      expect(annotations.map((annotation) => annotation.subtype).sort()).toEqual([
        'Popup',
        'Text',
      ]);

      document.undo();
      expect(journalState(document)).toMatchObject({
        position: 0,
        canUndo: false,
        canRedo: true,
      });
      expect(annotationMutations.listAnnotations(document)).toEqual([]);
      const undone = saveDocument(document, SAFE_FULL_SAVE);
      expectQpdfAccepts(undone, 'undone.pdf');
      expect(await pdfJsAnnotations(undone)).toHaveLength(0);
    } finally {
      document.destroy();
    }
  });

  it('abandons a rejected annotation without adding a history step or output object', async () => {
    const document = createDocument();
    try {
      expect(() =>
        journalOperation(
          document,
          'Invalid sticky note',
          () => undefined,
          (arena) =>
            annotationMutations.addAnnotation(arena, document, {
              pageIndex: 0,
              type: 'Text',
              rect: [40, 50, 68, 78],
              contents: 'must not survive',
              interiorColor: [1, 0, 0],
            }),
        ),
      ).toThrow('do not accept an interior colour');
      expect(journalState(document)).toMatchObject({
        position: 0,
        steps: [],
        canUndo: false,
        canRedo: false,
      });

      const output = saveDocument(document, SAFE_FULL_SAVE);
      expectQpdfAccepts(output, 'rejected.pdf');
      expect(await pdfJsAnnotations(output)).toHaveLength(0);
    } finally {
      document.destroy();
    }
  });

  it('writes review state and reply threading as interoperable annotation objects', async () => {
    const document = createDocument();
    try {
      journalOperation(
        document,
        'Add comment thread',
        () => undefined,
        (arena) => {
          const parent = annotationMutations.addAnnotation(arena, document, {
            pageIndex: 0,
            type: 'Text',
            rect: [40, 50, 68, 78],
            contents: 'Parent',
            state: 'Accepted',
          });
          annotationMutations.addAnnotation(arena, document, {
            pageIndex: 0,
            type: 'Text',
            rect: [80, 50, 108, 78],
            contents: 'Reply',
            state: 'Completed',
            replyTo: { pageIndex: 0, annotationId: parent.id },
          });
        },
      );
      const listed = annotationMutations.listAnnotations(document);
      expect(listed).toMatchObject([
        { contents: 'Parent', state: 'Accepted', replyToId: null },
        { contents: 'Reply', state: 'Completed', replyToId: listed[0]?.id },
      ]);
      const output = saveDocument(document, SAFE_FULL_SAVE);
      expectQpdfAccepts(output, 'comment-thread.pdf');
      const annotations = await pdfJsAnnotations(output);
      expect(
        annotations.some(
          (annotation) =>
            annotation.contentsObj?.str === 'Reply' && annotation.inReplyTo !== undefined,
        ),
      ).toBe(true);
    } finally {
      document.destroy();
    }
  });
});
