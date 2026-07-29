import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { withArenaSync } from '../lib/engine/worker/arena';
import pageMutations from '../lib/engine/worker/mutations/pages';
import redactionMutations from '../lib/engine/worker/mutations/redaction';
import { journalOperation } from '../lib/engine/worker/mutations/transaction';
import { persistenceSnapshot, saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-sanitize-'));
let qpdf = '';

function createSensitiveDocument(): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const page = document.addPage([0, 0, 200, 200], 0, null, new Uint8Array(0));
  let trailer: mupdf.PDFObject | undefined;
  let root: mupdf.PDFObject | undefined;
  let action: mupdf.PDFObject | undefined;
  try {
    document.insertPage(-1, page);
    document.setMetaData(mupdf.Document.META_INFO_TITLE, 'SECRET_METADATA');
    trailer = document.getTrailer();
    root = trailer.get('Root');
    action = root.put('OpenAction', {
      S: 'JavaScript',
      JS: 'SECRET_SCRIPT',
    });
  } finally {
    action?.destroy();
    root?.destroy();
    trailer?.destroy();
    page.destroy();
  }
  document.enableJournal();
  return document;
}

function createRedactionDocument(
  options: { metadata?: boolean; pages?: number } = {},
): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const font = new mupdf.Font('Helvetica');
  const fontObject = document.addSimpleFont(font);
  const fonts = document.newDictionary();
  const resources = document.newDictionary();
  const pages: mupdf.PDFObject[] = [];
  try {
    fonts.put('F1', fontObject);
    resources.put('Font', fonts);
    const pageCount = options.pages ?? 2;
    for (let index = 0; index < pageCount; index += 1) {
      const contents =
        index === 0
          ? 'BT /F1 12 Tf 20 100 Td (SECRET_REDACTION_TARGET) Tj ET'
          : `BT /F1 12 Tf 20 100 Td (SAFE_PAGE_${index + 1}) Tj ET`;
      const pageObject = document.addPage([0, 0, 200, 200], 0, resources, contents);
      pages.push(pageObject);
      document.insertPage(-1, pageObject);
    }
    if (options.metadata) {
      withArenaSync((arena) => {
        const trailer = arena.keep(document.getTrailer());
        const root = arena.keep(trailer.get('Root'));
        const metadata = arena.keep(
          document.addStream('<x:xmpmeta>SECRET_REDACTION_TARGET</x:xmpmeta>', {
            Type: 'Metadata',
            Subtype: 'XML',
          }),
        );
        arena.keep(root.put('Metadata', metadata));
      });
    }
  } finally {
    for (const page of pages) page.destroy();
    resources.destroy();
    fonts.destroy();
    fontObject.destroy();
    font.destroy();
  }
  document.enableJournal();
  withArenaSync((arena) => {
    const page = arena.keep(document.loadPage(0));
    const hits = page.search('SECRET_REDACTION_TARGET', 2);
    if (hits.length !== 1 || hits[0]?.length !== 1) {
      throw new Error('The redaction oracle fixture did not expose its target exactly once.');
    }
    const annotation = arena.keep(page.createAnnotation('Redact'));
    annotation.setQuadPoints([hits[0]![0]!]);
    annotation.update();
  });
  return document;
}

function inflate(data: ArrayBuffer | Uint8Array, name: string): Uint8Array {
  const input = join(workDir, `${name}-input.pdf`);
  const output = join(workDir, `${name}-inflated.pdf`);
  writeFileSync(input, data instanceof Uint8Array ? data : new Uint8Array(data));
  const result = spawnSync(
    qpdf,
    ['--qdf', '--object-streams=disable', '--stream-data=uncompress', input, output],
    { encoding: 'utf8', shell: false },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return readFileSync(output);
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

describe('SIGN-033 sanitize whole-file oracle', () => {
  it('garbage-collects removed page content from durable recovery snapshots', () => {
    const document = new mupdf.PDFDocument();
    const secretPage = document.addPage(
      [0, 0, 200, 200],
      0,
      null,
      'BT /F1 12 Tf 20 100 Td (SECRET_REDACTED_TEXT) Tj ET',
    );
    const retainedPage = document.addPage([0, 0, 200, 200], 0, null, new Uint8Array(0));
    try {
      document.insertPage(-1, secretPage);
      document.insertPage(-1, retainedPage);
      document.enableJournal();

      const before = saveDocument(document, {
        mode: 'full',
        garbage: 'none',
        compress: true,
        encrypt: 'keep',
      });
      expect(
        Buffer.from(inflate(before, 'redaction-snapshot-before')).includes(
          Buffer.from('SECRET_REDACTED_TEXT'),
        ),
      ).toBe(true);

      journalOperation(
        document,
        'Remove pages wholesale',
        () => undefined,
        () => {
          redactionMutations.redactPages(document, [0], 0, false);
        },
      );
      const snapshot = persistenceSnapshot(document);
      expect(
        Buffer.from(inflate(snapshot, 'redaction-snapshot-after')).includes(
          Buffer.from('SECRET_REDACTED_TEXT'),
        ),
      ).toBe(false);
    } finally {
      retainedPage.destroy();
      secretPage.destroy();
      document.destroy();
    }
  });

  it('applies named-method redactions, removes inflated source text, and clears every mark', () => {
    const document = createRedactionDocument();
    try {
      const before = inflate(saveDocument(document, SAFE_FULL_SAVE), 'apply-redactions-before');
      expect(Buffer.from(before).includes(Buffer.from('SECRET_REDACTION_TARGET'))).toBe(true);
      expect(redactionMutations.countUnappliedRedactions(document)).toBe(1);

      const preflight = redactionMutations.inspectApplyRedactions(document);
      expect(preflight).toEqual({
        marks: 1,
        pageIndices: [0],
        signatures: 0,
        unsupported: [],
      });
      const report = journalOperation(
        document,
        'Apply redactions',
        () => redactionMutations.assertApplyRedactions(preflight, false),
        (arena) => redactionMutations.applyRedactions(arena, document, preflight),
      );

      expect(report).toMatchObject({ fidelity: 'DEGRADED', applied: 1, pages: 1 });
      expect(redactionMutations.countUnappliedRedactions(document)).toBe(0);
      expect(
        Buffer.from(inflate(report.data, 'apply-redactions-after')).includes(
          Buffer.from('SECRET_REDACTION_TARGET'),
        ),
      ).toBe(false);
    } finally {
      document.destroy();
    }
  });

  it('unblocks save, export-equivalent save, page export, split, and sanitize', () => {
    const document = createRedactionDocument();
    try {
      expect(redactionMutations.countUnappliedRedactions(document)).toBe(1);
      const preflight = redactionMutations.inspectApplyRedactions(document);
      journalOperation(
        document,
        'Apply redactions',
        () => redactionMutations.assertApplyRedactions(preflight, false),
        (arena) => redactionMutations.applyRedactions(arena, document, preflight),
      );
      expect(redactionMutations.countUnappliedRedactions(document)).toBe(0);

      expect(saveDocument(document, SAFE_FULL_SAVE).byteLength).toBeGreaterThan(0);
      expect(saveDocument(document, SAFE_FULL_SAVE).byteLength).toBeGreaterThan(0);
      expect(
        withArenaSync((arena) => pageMutations.extractPages(arena, document, [0])).byteLength,
      ).toBeGreaterThan(0);
      expect(
        pageMutations.splitDocument(document, [
          [0, 1],
          [1, 2],
        ]),
      ).toHaveLength(2);

      const sanitizePreflight = redactionMutations.inspectSanitize(document);
      const sanitized = journalOperation(
        document,
        'Sanitize document',
        () => undefined,
        (arena) => redactionMutations.sanitize(arena, document, sanitizePreflight, false),
      );
      expect(sanitized.data.byteLength).toBeGreaterThan(0);
    } finally {
      document.destroy();
    }
  });

  it('refuses redaction when metadata can retain the marked text and leaves the mark intact', () => {
    const document = createRedactionDocument({ metadata: true });
    try {
      const preflight = redactionMutations.inspectApplyRedactions(document);
      expect(preflight.marks).toBe(1);
      expect(preflight.unsupported.join(' ')).toContain('object metadata');
      expect(() =>
        journalOperation(
          document,
          'Apply redactions',
          () => redactionMutations.assertApplyRedactions(preflight, false),
          (arena) => redactionMutations.applyRedactions(arena, document, preflight),
        ),
      ).toThrow(/object metadata.*retain the redacted text/i);
      expect(redactionMutations.countUnappliedRedactions(document)).toBe(1);
    } finally {
      document.destroy();
    }
  });

  it('proves known sensitive content present before and absent after a full rewrite', async () => {
    const document = createSensitiveDocument();
    try {
      const before = saveDocument(document, SAFE_FULL_SAVE);
      const inflatedBefore = inflate(before, 'before');
      expect(Buffer.from(inflatedBefore).includes(Buffer.from('SECRET_METADATA'))).toBe(true);
      expect(Buffer.from(inflatedBefore).includes(Buffer.from('SECRET_SCRIPT'))).toBe(true);

      const preflight = redactionMutations.inspectSanitize(document);
      expect(preflight).toEqual({ signatures: 0, unsupported: [] });
      const report = journalOperation(
        document,
        'Sanitize document',
        () => undefined,
        (arena) => redactionMutations.sanitize(arena, document, preflight, false),
      );
      expect(report.removed).toMatchObject({ scripts: 1, metadata: 1 });

      const inflatedAfter = inflate(report.data, 'after');
      expect(Buffer.from(inflatedAfter).includes(Buffer.from('SECRET_METADATA'))).toBe(false);
      expect(Buffer.from(inflatedAfter).includes(Buffer.from('SECRET_SCRIPT'))).toBe(false);

      const task = getDocument({ data: new Uint8Array(report.data) });
      const output = await task.promise;
      expect(output.numPages).toBe(1);
      await task.destroy();
    } finally {
      document.destroy();
    }
  });
});
