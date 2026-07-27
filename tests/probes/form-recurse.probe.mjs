// libreoffice.pdf: the trace sees 33 bytes of text where pdf.js extracts 1431 chars, and
// the operator histogram contains Do_form. Confirm the missing text lives inside a Form
// XObject that processContents does not descend into.
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\u005c', '/');
const doc = mupdf.Document.openDocument(
  Uint8Array.from(readFileSync(asPath('../fixtures/pdf-corpus/libreoffice.pdf'))),
  'application/pdf',
);
const page = doc.loadPage(0);
const res = page.getObject().get('Resources', 'XObject');
console.log('page /Resources /XObject is dictionary:', res.isDictionary());
res.forEach((val, key) => {
  const sub = val.get('Subtype');
  const stream = val.readStream();
  const text = Buffer.from(stream.asUint8Array()).toString('latin1');
  const tj = (text.match(/TJ/g) || []).length;
  const tjs = (text.match(/Tj/g) || []).length;
  console.log(
    `  /${key} Subtype=${sub.asName?.() ?? '?'} streamBytes=${text.length} TJ=${tj} Tj=${tjs}`,
  );
  stream.destroy();
});
page.destroy();
doc.destroy();
