// An actual in-place text edit, end to end.
//
// The operator-level re-serializer (pdf_new_buffer_processor) did NOT land in the built
// engine, so the designed edit path does not exist. But pdf_update_stream did, exposed as
// PDFObject.writeStream, so a content stream can be replaced wholesale. That is enough to
// answer the question the trace alone cannot: does an edit survive to a reader?
//
// Method: find a Tj string with the trace, rewrite those bytes in the page's content
// stream, write it back, full save. Then ask pdf.js what the page now says. pdf.js is the
// only judge; MuPDF locates and mutates but never grades.

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

const load = (data) =>
  getDocument({
    data: Uint8Array.from(data),
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
  }).promise;

async function pageText(doc, n) {
  const p = await doc.getPage(n);
  const t = (await p.getTextContent()).items.map((i) => i.str).join('');
  p.cleanup();
  return t;
}

async function renderPage1(doc) {
  const p = await doc.getPage(1);
  const viewport = p.getViewport({ scale: 2 });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const ctx = createCanvas(width, height).getContext('2d');
  await p.render({ canvasContext: ctx, viewport }).promise;
  p.cleanup();
  return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
}

// Same byte length in and out, so no /Length or offset bookkeeping is involved and the
// only variable is whether the edit itself survives.
const CASES = [
  { file: 'distiller-tagged-linearized.pdf', from: 'Line 1 ', to: 'EDITED ' },
  { file: 'mobile-camscanner.pdf', from: null, to: null },
];

for (const testCase of CASES) {
  const { file } = testCase;
  const original = readFileSync(corpusDir + file);
  const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
  const page = doc.loadPage(0);

  // Pick a Tj payload from the trace if the case did not name one.
  let from = testCase.from;
  if (!from) {
    const trace = page.processContents();
    const tj = trace
      .getRecords()
      .filter((r) => r.operator === 'Tj' && r.payload.length >= 4)
      .sort((a, b) => b.payload.length - a.payload.length)[0];
    from = tj ? Buffer.from(tj.payload).toString('latin1') : null;
    trace.destroy();
  }
  if (!from) {
    console.log(`${file}: no usable Tj payload`);
    page.destroy();
    doc.destroy();
    continue;
  }
  const to = (testCase.to ?? 'EDITED!!!!!!!!!!!!!!!!!!!!')
    .slice(0, from.length)
    .padEnd(from.length);

  // Rewrite the bytes in the page's content stream.
  const contents = page.getObject().get('Contents');
  const streams = contents.isArray()
    ? Array.from({ length: contents.length }, (_, i) => contents.get(i))
    : [contents];

  let replaced = 0;
  for (const stream of streams) {
    if (!stream.isStream()) continue;
    const buf = stream.readStream();
    const bytes = Buffer.from(buf.asUint8Array());
    buf.destroy();
    const at = bytes.indexOf(Buffer.from(from, 'latin1'));
    if (at < 0) continue;
    Buffer.from(to, 'latin1').copy(bytes, at);
    stream.writeStream(bytes);
    replaced++;
    break;
  }
  page.destroy();

  if (!replaced) {
    console.log(`${file}: "${from}" not found in the page content stream (compressed shape?)`);
    doc.destroy();
    continue;
  }

  const saved = doc.saveToBuffer('compress,garbage=deduplicate');
  const edited = Uint8Array.from(saved.asUint8Array());
  saved.destroy();
  doc.destroy();

  const beforeDoc = await load(original);
  const afterDoc = await load(edited);
  const beforeText = await pageText(beforeDoc, 1);
  const afterText = await pageText(afterDoc, 1);
  const beforeRender = await renderPage1(beforeDoc);
  const afterRender = await renderPage1(afterDoc);

  let changed = 0;
  if (beforeRender.width === afterRender.width && beforeRender.height === afterRender.height) {
    for (let o = 0; o < beforeRender.pixels.length; o += 4) {
      for (let c = 0; c < 4; c++) {
        if (beforeRender.pixels[o + c] !== afterRender.pixels[o + c]) {
          changed++;
          break;
        }
      }
    }
  } else {
    changed = -1;
  }

  console.log(`${file}: "${from.trim()}" -> "${to.trim()}"`);
  console.log(`  pdf.js had the old text:  ${beforeText.includes(from.trim())}`);
  console.log(`  pdf.js has the new text:  ${afterText.includes(to.trim())}`);
  console.log(`  pdf.js still has the old: ${afterText.includes(from.trim())}`);
  console.log(`  pixels changed on page 1: ${changed}`);
  console.log(`  page count ${beforeDoc.numPages} -> ${afterDoc.numPages}\n`);
}
