import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { saveDocument } from '../lib/engine/worker/save';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-encryption-'));
let qpdf = '';

function createDocument(): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const page = document.addPage([0, 0, 200, 200], 0, null, new Uint8Array(0));
  try {
    document.insertPage(-1, page);
  } finally {
    page.destroy();
  }
  return document;
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

describe('SIGN-020/SIGN-022 password encryption oracle', () => {
  it('writes AES-256 that pdf.js and qpdf open with the password and reject without it', async () => {
    const document = createDocument();
    let output: ArrayBuffer;
    try {
      output = saveDocument(document, {
        mode: 'full',
        garbage: 'deduplicate',
        compress: true,
        encrypt: 'aes-256',
        'user-password': 'reader-secret',
        'owner-password': 'owner-secret',
        permissions: ['print', 'form', 'accessibility'],
      });
    } finally {
      document.destroy();
    }

    const withoutPassword = getDocument({ data: new Uint8Array(output.slice(0)) });
    await expect(withoutPassword.promise).rejects.toMatchObject({
      name: 'PasswordException',
    });
    await withoutPassword.destroy();

    const withPassword = getDocument({
      data: new Uint8Array(output.slice(0)),
      password: 'reader-secret',
    });
    const opened = await withPassword.promise;
    expect(opened.numPages).toBe(1);
    await withPassword.destroy();

    const path = join(workDir, 'aes-256.pdf');
    writeFileSync(path, new Uint8Array(output));
    const check = spawnSync(qpdf, ['--password=reader-secret', '--check', path], {
      encoding: 'utf8',
      shell: false,
    });
    expect(check.status, check.stderr || check.stdout).toBe(0);
    const encryption = spawnSync(
      qpdf,
      ['--password=reader-secret', '--show-encryption', path],
      { encoding: 'utf8', shell: false },
    );
    expect(encryption.status, encryption.stderr).toBe(0);
    expect(encryption.stdout).toContain('AESv3');
    expect(encryption.stdout).not.toMatch(/RC4/i);
  });
});
