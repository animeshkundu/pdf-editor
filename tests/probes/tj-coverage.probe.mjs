// The TJ handle is a PDF array after all; my earlier probe reported it empty only
// because PDFObject has no asJSON method. Read the array properly and check whether the
// text is fully present, so the editing verdict rests on what the trace really carries.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

/** All bytes shown by a text operator, from payload (Tj) or the array handle (TJ). */
function shownBytes(record) {
  if (record.payload?.length) return Buffer.from(record.payload);
  const out = [];
  for (const handle of record.handles ?? []) {
    if (typeof handle.isArray !== 'function' || !handle.isArray()) continue;
    for (let i = 0; i < handle.length; i++) {
      const item = handle.get(i);
      if (item.isString?.()) out.push(Buffer.from(item.asByteString()));
    }
  }
  return Buffer.concat(out);
}

const DOCS = [
  'libreoffice.pdf',
  'ghostscript.pdf',
  'latex-pdftex.pdf',
  'distiller-tagged-linearized.pdf',
  'word-cid.pdf',
  'rtl-quartz.pdf',
  'apache-fop.pdf',
  'mobile-camscanner.pdf',
];
const TEXT_OPS = new Set(['Tj', 'TJ', "'", '"']);

console.log('Does the trace carry all the shown text? Graded against pdf.js.\n');
console.log(
  'document'.padEnd(32),
  'TJ'.padStart(4),
  'Tj'.padStart(4),
  'arrElems'.padStart(9),
  'bytes'.padStart(7),
  'pdf.js chars'.padStart(13),
  'coverage',
);

for (const file of DOCS) {
  const original = readFileSync(corpusDir + file);
  const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
  const page = doc.loadPage(0);
  const trace = page.processContents();
  const records = trace.getRecords();

  const textRecords = records.filter((r) => TEXT_OPS.has(r.operator));
  let arrayElements = 0;
  for (const r of records.filter((r) => r.operator === 'TJ')) {
    for (const h of r.handles ?? []) if (h.isArray?.()) arrayElements += h.length;
  }
  const bytes = Buffer.concat(textRecords.map(shownBytes));

  trace.destroy();
  page.destroy();
  doc.destroy();

  const pdfDoc = await getDocument({
    data: Uint8Array.from(original),
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
  }).promise;
  const p1 = await pdfDoc.getPage(1);
  const extracted = (await p1.getTextContent()).items
    .map((i) => i.str)
    .join('')
    .replace(/\s+/g, '');

  // The trace gives raw character CODES, not Unicode, so a byte-for-byte comparison is
  // wrong. Character COUNT is the fair check: one code per shown glyph.
  const coverage = extracted.length ? (bytes.length / extracted.length).toFixed(2) : 'n/a';

  console.log(
    file.padEnd(32),
    String(records.filter((r) => r.operator === 'TJ').length).padStart(4),
    String(records.filter((r) => r.operator === 'Tj').length).padStart(4),
    String(arrayElements).padStart(9),
    String(bytes.length).padStart(7),
    String(extracted.length).padStart(13),
    `  ${coverage}`,
  );
}
