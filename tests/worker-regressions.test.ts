import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import {
  DocumentSizeAccounting,
  JAVASCRIPT_CONTEXT_MEMORY_LIMIT,
  javaScriptContextProjection,
} from '../lib/engine/worker/resource-accounting';
import { journalHistory, journalOperation } from '../lib/engine/worker/mutations/transaction';

function createDocument(): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const page = document.addPage([0, 0, 200, 200], 0, null, new Uint8Array(0));
  try {
    document.insertPage(-1, page);
  } finally {
    page.destroy();
  }
  document.enableJournal();
  return document;
}

describe('document worker resource regressions', () => {
  it('reserves one MuJS context independent of script or edited-field count', () => {
    expect(javaScriptContextProjection(false)).toBe(0);
    expect(javaScriptContextProjection(true)).toBe(JAVASCRIPT_CONTEXT_MEMORY_LIMIT);
    expect(JAVASCRIPT_CONTEXT_MEMORY_LIMIT).toBe(100 << 20);
  });

  it('refreshes size accounting from the actual document after undo', () => {
    const document = createDocument();
    const accounting = new DocumentSizeAccounting();
    try {
      accounting.refresh(document);
      const before = accounting.bytes;
      journalOperation(
        document,
        'Add metadata',
        () => undefined,
        () => {
          document.setMetaData(mupdf.Document.META_INFO_TITLE, 'x'.repeat(64_000));
        },
      );
      accounting.refresh(document);
      expect(accounting.bytes).toBeGreaterThan(before);

      document.undo();
      accounting.refresh(document);
      expect(accounting.bytes).toBe(before);
    } finally {
      document.destroy();
    }
  });

  it('does not compensate a successful undo when reading the restored state fails', () => {
    const document = createDocument();
    try {
      journalOperation(
        document,
        'Add metadata',
        () => undefined,
        () => {
          document.setMetaData(mupdf.Document.META_INFO_TITLE, 'changed');
        },
      );
      expect(document.canUndo()).toBe(true);

      expect(() =>
        journalHistory(document, 'undo', () => {
          throw new Error('state read failed');
        }),
      ).toThrow('state read failed');
      expect(document.canUndo()).toBe(false);
      expect(document.canRedo()).toBe(true);
    } finally {
      document.destroy();
    }
  });
});

describe('journal cleanup failures', () => {
  it('commits successful work before surfacing an arena release failure', () => {
    const events: string[] = [];
    const document = {
      beginOperation: () => events.push('begin'),
      endOperation: () => events.push('end'),
      abandonOperation: () => events.push('abandon'),
    } as unknown as mupdf.PDFDocument;

    expect(() =>
      journalOperation(
        document,
        'Mutation',
        () => undefined,
        (arena) => {
          events.push('mutate');
          arena.keep({
            destroy() {
              events.push('release');
              throw new Error('release failed');
            },
          });
        },
      ),
    ).toThrow('could not be released');
    expect(events).toEqual(['begin', 'mutate', 'end', 'release']);
  });

  it('preserves both mutation and arena release failures', () => {
    const mutationError = new Error('mutation failed');
    const releaseError = new Error('release failed');
    const document = {
      beginOperation: () => undefined,
      endOperation: () => undefined,
      abandonOperation: () => undefined,
    } as unknown as mupdf.PDFDocument;

    let caught: unknown;
    try {
      journalOperation(
        document,
        'Mutation',
        () => undefined,
        (arena) => {
          arena.keep({
            destroy() {
              throw releaseError;
            },
          });
          throw mutationError;
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const errors = (caught as AggregateError).errors;
    expect(errors[0]).toBe(mutationError);
    expect(errors[1]).toBeInstanceOf(AggregateError);
    expect((errors[1] as AggregateError).errors).toEqual([releaseError]);
    expect((caught as AggregateError).cause).toBe(errors[1]);
  });
});
