// The editing half. In-place text editing needs three things from the engine, and the
// shipped trace API is supposed to supply the first two:
//
//   1. every text-showing operator, with its operands             (what is on the page)
//   2. the RESOLVED font at each Tf, not just the resource name   (how to invert the
//                                                                  encoding back to a
//                                                                  character code)
//   3. a way to write the edit back                               (filterContents, whose
//                                                                  fidelity is the open
//                                                                  question)
//
// This checks 1 and 2 on page 1 only against a real corpus, and cross-checks page 1
// extracted text against pdf.js so the trace is not graded by the engine that produced it.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

const DOCS = [
  'libreoffice.pdf',
  'apache-fop.pdf',
  'ghostscript.pdf',
  'latex-pdftex.pdf',
  'distiller-tagged-linearized.pdf',
  'word-cid.pdf',
  'cjk-itext.pdf',
  'rtl-quartz.pdf',
  'type3-font.pdf',
  'ocg-acrobat.pdf',
  'transparency-group.pdf',
  'mobile-camscanner.pdf',
];

const TEXT_OPS = new Set(['Tj', 'TJ', "'", '"']);

function shownBytes(record) {
  if (record.payload?.length) return Buffer.from(record.payload);
  const out = [];
  for (const handle of record.handles ?? []) {
    if (typeof handle.isArray !== 'function' || !handle.isArray()) continue;
    for (let i = 0; i < handle.length; i++) {
      const item = handle.get(i);
      try {
        if (item.isString?.()) out.push(Buffer.from(item.asByteString()));
      } finally {
        item.destroy();
      }
    }
  }
  return Buffer.concat(out);
}

console.log('Editing capability: what the processContents trace actually delivers\n');
console.log(
  'document'.padEnd(32),
  'records'.padStart(8),
  'ops'.padStart(5),
  'text'.padStart(6),
  'Tf'.padStart(4),
  'font names'.padEnd(30),
  'embedded'.padStart(9),
  'writing modes'.padEnd(14),
  'resolvd'.padStart(8),
  'BDC'.padStart(5),
  'cooked'.padStart(7),
);

for (const file of DOCS) {
  const original = readFileSync(corpusDir + file);
  const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
  let row;
  try {
    const page = doc.loadPage(0);
    const trace = page.processContents();
    const records = trace.getRecords();

    const ops = new Set(records.map((r) => r.operator));
    const textRecords = records.filter((r) => TEXT_OPS.has(r.operator));
    const tf = records.filter((r) => r.operator === 'Tf');
    const resolved = tf.filter((r) => r.font != null);
    const fontNames = new Set(resolved.map((r) => r.font.getName()));
    const embedded = resolved.filter((r) => r.font.isEmbedded()).length;
    const writingModes = new Set(resolved.map((r) => String(r.font.getWritingMode())));
    const bdc = records.filter((r) => r.operator === 'BDC');
    const cooked = bdc.filter((r) => r.cooked != null);

    row = {
      records: records.length,
      ops: ops.size,
      text: textRecords.length,
      tf: tf.length,
      resolved: resolved.length,
      embedded,
      writingModes: [...writingModes],
      bdc: bdc.length,
      cooked: cooked.length,
      fontNames: [...fontNames],
    };
    trace.destroy();
    page.destroy();
  } catch (e) {
    console.log(file.padEnd(32), `ERROR ${e.message.slice(0, 60)}`);
    doc.destroy();
    continue;
  }
  doc.destroy();

  console.log(
    file.padEnd(32),
    String(row.records).padStart(8),
    String(row.ops).padStart(5),
    String(row.text).padStart(6),
    String(row.tf).padStart(4),
    row.fontNames.join(',').slice(0, 29).padEnd(30),
    `${row.embedded}/${row.resolved}`.padStart(9),
    row.writingModes.join(',').padEnd(14),
    (row.tf ? `${row.resolved}/${row.tf}` : 'n/a').padStart(8),
    String(row.bdc).padStart(5),
    (row.bdc ? `${row.cooked}/${row.bdc}` : 'n/a').padStart(7),
  );
}

// Cross-check: does the trace's payload text agree with what pdf.js extracts? The trace
// is graded by an independent reader, not by MuPDF.
console.log('\nCross-check of trace payloads against pdf.js extraction (page 1):\n');
for (const file of ['libreoffice.pdf', 'ghostscript.pdf', 'distiller-tagged-linearized.pdf']) {
  const original = readFileSync(corpusDir + file);
  const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
  const page = doc.loadPage(0);
  const trace = page.processContents();
  const payloads = trace
    .getRecords()
    .filter((r) => TEXT_OPS.has(r.operator))
    .map((r) => shownBytes(r).toString('latin1'));
  trace.destroy();
  page.destroy();
  doc.destroy();

  const task = getDocument({
    data: Uint8Array.from(original),
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
  });
  const pdfDoc = await task.promise;
  const p1 = await pdfDoc.getPage(1);
  const extracted = (await p1.getTextContent()).items.map((i) => i.str).join('');
  const alpha = (s) => s.replace(/[^A-Za-z]/g, '');

  const traceAlpha = alpha(payloads.join(''));
  const pdfAlpha = alpha(extracted);
  let matched = 0;
  for (const w of new Set(pdfAlpha.match(/[A-Za-z]{6,}/g) ?? [])) {
    if (traceAlpha.includes(w)) matched++;
  }
  const total = new Set(pdfAlpha.match(/[A-Za-z]{6,}/g) ?? []).size;
  console.log(
    `${file.padEnd(32)} text records ${String(payloads.length).padStart(5)}  ` +
      `payload bytes ${String(payloads.join('').length).padStart(6)}  ` +
      `pdf.js words found in payloads: ${matched}/${total}`,
  );
  console.log(`   first payload: ${JSON.stringify(payloads[0]?.slice(0, 70) ?? '(none)')}`);
  await task.destroy();
}
