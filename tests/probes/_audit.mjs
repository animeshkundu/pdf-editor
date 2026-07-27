// Temporary audit of the probe methodology. Not part of the finding set.
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');

const ORACLE_FLAGS = { recurse: true, instanceForms: false, ascii: false, noUpdate: false, newlines: true };
const REDACT_FLAGS = { recurse: false, instanceForms: true, ascii: false, noUpdate: false, newlines: false };

function filterWith(bytes, flags) {
  const doc = mupdf.Document.openDocument(Uint8Array.from(bytes), 'application/pdf');
  try {
    for (let i = 0; i < doc.countPages(); i++) {
      const p = doc.loadPage(i);
      try { p.filterContents(flags); } finally { p.destroy(); }
    }
    const buf = doc.saveToBuffer('compress');
    try { return Uint8Array.from(buf.asUint8Array()); } finally { buf.destroy(); }
  } finally { doc.destroy(); }
}
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);

console.log('=== A. do the two flag sets actually produce different output bytes? ===');
for (const f of ['ghostscript.pdf', 'latex-pdftex.pdf', 'libreoffice.pdf']) {
  const orig = readFileSync(corpusDir + f);
  const a = filterWith(orig, ORACLE_FLAGS);
  const b = filterWith(orig, REDACT_FLAGS);
  console.log(`${f.padEnd(20)} oracle ${String(a.length).padStart(8)} ${sha(a)}   redact ${String(b.length).padStart(8)} ${sha(b)}   identical=${sha(a) === sha(b)}`);
}

console.log('\n=== B. negative control: is the needle in the ORIGINAL inflated streams? ===');
function inflatedStreams(bytes) {
  const buf = Buffer.from(bytes);
  const out = [];
  let i = 0, inflateFail = 0, endstreamInside = 0;
  for (;;) {
    const start = buf.indexOf('stream', i);
    if (start < 0) break;
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const end = buf.indexOf('endstream', dataStart);
    if (end < 0) break;
    const raw = buf.subarray(dataStart, end);
    try { const d = inflateSync(raw); out.push(d); if (d.includes('endstream')) endstreamInside++; }
    catch { out.push(raw); inflateFail++; }
    i = end + 9;
  }
  return { out, inflateFail, endstreamInside };
}
const CASES = [
  ['apache-fop.pdf', 'embedded'], ['ocg-acrobat.pdf', 'AlignmentTest'],
  ['libreoffice.pdf', 'Characters'], ['distiller-tagged-linearized.pdf', 'ItalicLine'],
  ['ghostscript.pdf', 'questionnaire'], ['latex-pdftex.pdf', 'Mathematical'],
];
for (const [f, word] of CASES) {
  const orig = readFileSync(corpusDir + f);
  const { out, inflateFail, endstreamInside } = inflatedStreams(orig);
  const needle = Buffer.from(word, 'latin1');
  const hits = out.filter((s) => s.includes(needle)).length;
  // how many streams does the file really declare?
  const declared = (Buffer.from(orig).toString('latin1').match(/[^d]stream[\r\n]/g) || []).length;
  console.log(`${f.padEnd(34)} word=${word.padEnd(14)} PRE-redaction streams containing it: ${hits}   streams scanned=${out.length} declared~=${declared} inflateFail=${inflateFail} endstreamInsideInflated=${endstreamInside}`);
}

console.log('\n=== C. editing-trace font name field ===');
{
  const doc = mupdf.Document.openDocument(Uint8Array.from(readFileSync(corpusDir + 'ghostscript.pdf')), 'application/pdf');
  const page = doc.loadPage(0);
  const trace = page.processContents();
  const tf = trace.getRecords().filter((r) => r.operator === 'Tf');
  console.log('Tf records:', tf.length, ' r.font!=null:', tf.filter((r) => r.font != null).length);
  console.log("r.font?.name (what the probe reads):", JSON.stringify(tf.map((r) => r.font?.name).slice(0, 4)));
  console.log('r.font.getName() (what the doc quotes):', JSON.stringify(tf.map((r) => r.font?.getName?.()).slice(0, 4)));
  trace.destroy(); page.destroy(); doc.destroy();
}

console.log('\n=== D. tj-coverage: whitespace in numerator but not denominator? ===');
{
  const doc = mupdf.Document.openDocument(Uint8Array.from(readFileSync(corpusDir + 'ghostscript.pdf')), 'application/pdf');
  const page = doc.loadPage(0);
  const trace = page.processContents();
  const recs = trace.getRecords().filter((r) => ['Tj', 'TJ', "'", '"'].includes(r.operator));
  let bytes = 0, spaces = 0;
  for (const r of recs) {
    if (r.payload?.length) { bytes += r.payload.length; for (const b of r.payload) if (b === 0x20) spaces++; continue; }
    for (const h of r.handles ?? []) {
      if (typeof h.isArray !== 'function' || !h.isArray()) continue;
      for (let i = 0; i < h.length; i++) {
        const it = h.get(i);
        if (it.isString?.()) { const s = Buffer.from(it.asByteString()); bytes += s.length; for (const b of s) if (b === 0x20) spaces++; }
        it.destroy();
      }
    }
  }
  console.log(`trace bytes=${bytes}  of which 0x20 space codes=${spaces} (${((spaces / bytes) * 100).toFixed(1)}% -- the denominator strips these)`);
  trace.destroy(); page.destroy(); doc.destroy();
}
