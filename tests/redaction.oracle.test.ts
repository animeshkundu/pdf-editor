import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import redactionMutations from '../lib/engine/worker/mutations/redaction';
import { journalOperation } from '../lib/engine/worker/mutations/transaction';
import { saveDocument, SAFE_FULL_SAVE } from '../lib/engine/worker/save';

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

function inflate(data: ArrayBuffer, name: string): Uint8Array {
  const input = join(workDir, `${name}-input.pdf`);
  const output = join(workDir, `${name}-inflated.pdf`);
  writeFileSync(input, new Uint8Array(data));
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
