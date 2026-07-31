import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { saveDocument } from '../lib/engine/worker/save';
import {
  assertDocumentPermission,
  assertEncryptionChangeAllowed,
  authenticateDocument,
} from '../lib/engine/worker/authentication';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-encryption-'));
let qpdf = '';

function qpdfPasswordOption(value: string): string {
  return ['--password', value].join('=');
}

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
  it('SIGN-019 requires the owner password before changing document protection', () => {
    expect(() => assertEncryptionChangeAllowed('user', 'none')).toThrow(
      'requires its owner password',
    );
    expect(() => assertEncryptionChangeAllowed('user', 'aes-256')).toThrow(
      'requires its owner password',
    );
    expect(() => assertEncryptionChangeAllowed('user', 'keep')).not.toThrow();
    expect(() => assertEncryptionChangeAllowed('owner', 'none')).not.toThrow();
  });

  it('treats owner-only encryption as user-authenticated instead of unprotected', () => {
    const sourceDocument = createDocument();
    let encrypted: ArrayBuffer;
    try {
      encrypted = saveDocument(sourceDocument, {
        mode: 'full',
        garbage: 'deduplicate',
        compress: true,
        encrypt: 'aes-256',
        'user-password': '',
        'owner-password': 'owner-secret',
        permissions: ['print'],
      });
    } finally {
      sourceDocument.destroy();
    }

    const opened = mupdf.Document.openDocument(
      new Uint8Array(encrypted.slice(0)),
      'application/pdf',
    );
    try {
      expect(opened.needsPassword()).toBe(false);
      expect(authenticateDocument(opened, undefined)).toBe('user');
      expect(() =>
        assertDocumentPermission(
          opened,
          'user',
          mupdf.Document.PERMISSION_ANNOTATE,
          'Adding annotations',
        ),
      ).toThrow('blocked by this PDF');
      expect(() => assertEncryptionChangeAllowed('user', 'none')).toThrow(
        'requires its owner password',
      );
    } finally {
      opened.destroy();
    }
  });

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

  it.each([
    ['aes-128', 'AESv2'],
    ['aes-256', 'AESv3'],
  ] as const)(
    'SIGN-018/SIGN-019/SIGN-023 opens and preserves %s with user and owner passwords',
    async (algorithm, qpdfCipher) => {
      const sourceDocument = createDocument();
      let encrypted: ArrayBuffer;
      try {
        encrypted = saveDocument(sourceDocument, {
          mode: 'full',
          garbage: 'deduplicate',
          compress: true,
          encrypt: algorithm,
          'user-password': 'reader-secret',
          'owner-password': 'owner-secret',
          permissions: ['print', 'form', 'accessibility'],
        });
      } finally {
        sourceDocument.destroy();
      }

      for (const [password, role] of [
        ['reader-secret', 'user'],
        ['owner-secret', 'owner'],
      ] as const) {
        const opened = mupdf.Document.openDocument(
          new Uint8Array(encrypted.slice(0)),
          'application/pdf',
        );
        let roundTrip: ArrayBuffer;
        try {
          expect(authenticateDocument(opened, password)).toBe(role);
          if (!(opened instanceof mupdf.PDFDocument)) {
            throw new Error('Encrypted fixture did not open as a PDF document.');
          }
          roundTrip = saveDocument(
            opened,
            {
              mode: 'full',
              garbage: 'deduplicate',
              compress: true,
              encrypt: 'keep',
            },
            password,
          );
        } finally {
          opened.destroy();
        }

        const pdfJsTask = getDocument({
          data: new Uint8Array(roundTrip.slice(0)),
          password: 'reader-secret',
        });
        const pdfJsDocument = await pdfJsTask.promise;
        expect(pdfJsDocument.numPages).toBe(1);
        await pdfJsTask.destroy();

        const path = join(workDir, `${algorithm}-${role}.pdf`);
        writeFileSync(path, new Uint8Array(roundTrip));
        const check = spawnSync(qpdf, [qpdfPasswordOption('reader-secret'), '--check', path], {
          encoding: 'utf8',
          shell: false,
        });
        expect(check.status, check.stderr || check.stdout).toBe(0);
        const encryption = spawnSync(
          qpdf,
          [qpdfPasswordOption('reader-secret'), '--show-encryption', path],
          { encoding: 'utf8', shell: false },
        );
        expect(encryption.status, encryption.stderr).toBe(0);
        expect(encryption.stdout).toContain(qpdfCipher);
      }
    },
  );
});
