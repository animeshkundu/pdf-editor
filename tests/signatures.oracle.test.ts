import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../vendor/mupdf-wasm/dist/mupdf.js';
import { inspectSignatureFields } from '../lib/engine/worker/security';

const workDir = mkdtempSync(join(tmpdir(), 'pdf-editor-signatures-'));
let qpdf = '';

interface BuiltPdf {
  readonly bytes: Uint8Array;
  readonly xrefOffset: number;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function buildBasePdf(lengthGuess: number, malformed = false): BuiltPdf {
  const byteRange = malformed ? '[0 10 20]' : `[0 10 20 ${Math.max(0, lengthGuess - 20)}]`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm 4 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents [] >>',
    '<< /Fields [5 0 R 7 0 R] /SigFlags 3 >>',
    '<< /FT /Sig /T (Primary) /V 6 0 R >>',
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange ${byteRange} /Contents <00> >>`,
    '<< /T (Approval) /Kids [8 0 R 9 0 R] >>',
    '<< /Parent 7 0 R /FT /Sig /T (Manager) >>',
    '<< /Parent 7 0 R /FT /Sig /T (Auditor) /V 10 0 R >>',
    `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange ${byteRange} /Contents <00> >>`,
  ];
  let body = '%PDF-1.7\n%\x80\x81\x82\x83\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(ascii(body).byteLength);
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = ascii(body).byteLength;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return { bytes: ascii(body), xrefOffset };
}

function stableBasePdf(malformed = false): BuiltPdf {
  let length = 0;
  let result = buildBasePdf(length, malformed);
  for (let attempt = 0; attempt < 8 && result.bytes.byteLength !== length; attempt += 1) {
    length = result.bytes.byteLength;
    result = buildBasePdf(length, malformed);
  }
  if (!malformed && result.bytes.byteLength !== length) {
    throw new Error('Signature fixture length did not stabilize.');
  }
  return result;
}

function appendRevision(base: BuiltPdf): Uint8Array {
  let suffix =
    '\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm 4 0 R /Version /1.7 >>\nendobj\n';
  const objectOffset = base.bytes.byteLength + ascii('\n').byteLength;
  const xrefOffset = base.bytes.byteLength + ascii(suffix).byteLength;
  suffix += `xref\n1 1\n${String(objectOffset).padStart(10, '0')} 00000 n \n`;
  suffix += `trailer\n<< /Size 11 /Root 1 0 R /Prev ${base.xrefOffset} >>\n`;
  suffix += `startxref\n${xrefOffset}\n%%EOF\n`;
  const output = new Uint8Array(base.bytes.byteLength + ascii(suffix).byteLength);
  output.set(base.bytes);
  output.set(ascii(suffix), base.bytes.byteLength);
  return output;
}

function inspect(bytes: Uint8Array) {
  const document = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    if (!(document instanceof mupdf.PDFDocument)) throw new Error('Fixture is not a PDF.');
    return inspectSignatureFields(document, bytes.byteLength);
  } finally {
    document.destroy();
  }
}

async function acceptWithIndependentReaders(bytes: Uint8Array, name: string): Promise<void> {
  const path = join(workDir, name);
  writeFileSync(path, bytes);
  const check = spawnSync(qpdf, ['--check', path], { encoding: 'utf8', shell: false });
  expect(check.status, check.stderr || check.stdout).toBe(0);
  const task = getDocument({ data: bytes.slice() });
  const document = await task.promise;
  expect(document.numPages).toBe(1);
  await task.destroy();
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

describe('SIGN-011 signature coverage oracle', () => {
  it('enumerates every signed and unsigned AcroForm signature field safely', async () => {
    const base = stableBasePdf();
    await acceptWithIndependentReaders(base.bytes, 'signature-fields.pdf');

    const signatures = inspect(base.bytes);
    expect(signatures.map((signature) => signature.name)).toEqual([
      'Primary',
      'Approval.Manager',
      'Approval.Auditor',
    ]);
    expect(signatures.map((signature) => signature.signed)).toEqual([true, false, true]);
    expect(signatures[0]?.coveredRanges).toEqual([
      { offset: 0, length: 10, end: 10 },
      { offset: 20, length: base.bytes.byteLength - 20, end: base.bytes.byteLength },
    ]);
    expect(signatures[0]?.laterChanges).toBe(false);
    expect(signatures[1]?.coveredRanges).toEqual([]);
    expect(signatures[2]?.fieldObject).toBe(9);
  });

  it('reports later revision evidence without claiming semantic DocMDP classification', async () => {
    const bytes = appendRevision(stableBasePdf());
    await acceptWithIndependentReaders(bytes, 'signature-later-revision.pdf');

    const signatures = inspect(bytes);
    for (const signature of signatures.filter((item) => item.signed)) {
      expect(signature.documentRevisions).toBeGreaterThanOrEqual(2);
      expect(signature.laterChanges).toBe(true);
      expect(signature.laterBytes).toBeGreaterThan(0);
      expect(Number.isFinite(signature.laterBytes)).toBe(true);
      expect(
        signature.changeHistoryValidationCode === null ||
          typeof signature.changeHistoryValidationCode === 'number',
      ).toBe(true);
    }
  });

  it('reports a malformed /ByteRange instead of trusting or throwing on it', async () => {
    const base = stableBasePdf(true);
    await acceptWithIndependentReaders(base.bytes, 'signature-malformed-range.pdf');

    const signatures = inspect(base.bytes);
    expect(signatures[0]?.coveredRanges).toEqual([]);
    expect(signatures[0]?.laterChanges).toBeNull();
    expect(signatures[0]?.issues).toContain(
      '/ByteRange must contain at least two offset/length pairs.',
    );
  });

  it('keeps reported coverage finite when the engine returns no ranges', async () => {
    const base = stableBasePdf();
    await acceptWithIndependentReaders(base.bytes, 'signature-empty-engine-range.pdf');
    const document = mupdf.Document.openDocument(base.bytes, 'application/pdf');
    try {
      if (!(document instanceof mupdf.PDFDocument)) throw new Error('Fixture is not a PDF.');
      document.signatureByteRange = () => [];
      const signatures = inspectSignatureFields(document, base.bytes.byteLength);
      const signed = signatures.filter((signature) => signature.signed);
      expect(signed.length).toBeGreaterThan(0);
      for (const signature of signed) {
        expect(signature.coveredRanges.length).toBeGreaterThan(0);
        expect(Number.isFinite(signature.coveredBytes)).toBe(true);
        expect(Number.isFinite(signature.signedRevisionEnd)).toBe(true);
        expect(Number.isFinite(signature.laterBytes)).toBe(true);
        expect(signature.issues).toContain(
          'The engine could not expose this signature byte range.',
        );
      }
    } finally {
      document.destroy();
    }
  });
});
