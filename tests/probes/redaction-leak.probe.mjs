// Follow-up: three documents still contain the redacted word in an inflated stream.
// Before calling that a leak, find out WHICH stream. A word surviving in an unrelated
// page's content, or in /ToUnicode, or in XMP metadata, are three very different
// findings, and only some of them are redaction failures.

import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');

const quadToRect = (q) => [
  Math.min(q[0], q[2], q[4], q[6]),
  Math.min(q[1], q[3], q[5], q[7]),
  Math.max(q[0], q[2], q[4], q[6]),
  Math.max(q[1], q[3], q[5], q[7]),
];

/** Streams with the dictionary that precedes them, so each hit can be attributed. */
function streamsWithDicts(bytes) {
  const buf = Buffer.from(bytes);
  const out = [];
  let i = 0;
  for (;;) {
    const start = buf.indexOf('stream', i);
    if (start < 0) break;
    const dictStart = Math.max(0, start - 600);
    const dict = buf.subarray(dictStart, start).toString('latin1');
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const end = buf.indexOf('endstream', dataStart);
    if (end < 0) break;
    const raw = buf.subarray(dataStart, end);
    let data = raw;
    let inflated = false;
    try {
      data = inflateSync(raw);
      inflated = true;
    } catch {
      /* not FLATE */
    }
    out.push({ dict, data, inflated, offset: start });
    i = end + 9;
  }
  return out;
}

function describe(dict) {
  const objMatch = /(\d+)\s+0\s+obj/.exec(dict);
  const type = /\/Type\s*\/(\w+)/.exec(dict)?.[1];
  const subtype = /\/Subtype\s*\/(\w+)/.exec(dict)?.[1];
  const parts = [];
  if (objMatch) parts.push(`obj ${objMatch[1]}`);
  if (type) parts.push(`/Type /${type}`);
  if (subtype) parts.push(`/Subtype /${subtype}`);
  if (/\/ObjStm/.test(dict)) parts.push('object stream');
  if (/\/ToUnicode/.test(dict)) parts.push('has /ToUnicode ref');
  return parts.length ? parts.join(' ') : dict.trim().slice(-90).replace(/\s+/g, ' ');
}

for (const file of ['apache-fop.pdf', 'latex-pdftex.pdf', 'ocg-acrobat.pdf']) {
  const original = readFileSync(corpusDir + file);
  const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
  let mp;
  let word = null;
  let rect = null;
  let redacted;
  let pagesWithWord = 0;
  try {
    mp = doc.loadPage(0);
    const st = mp.toStructuredText();
    let plain;
    try {
      plain = st.asText?.() ?? '';
    } finally {
      st.destroy();
    }
    const words = new Set();
    for (const w of plain.split(/\s+/)) {
      const clean = w.replace(/[^A-Za-z]/g, '');
      if (clean.length >= 6 && clean === w) words.add(clean);
    }
    for (const candidate of [...words].sort((a, b) => b.length - a.length)) {
      const hits = mp.search(candidate, 4);
      if (hits.length === 1 && hits[0].length === 1) {
        word = candidate;
        rect = quadToRect(hits[0][0]);
        break;
      }
    }

    // Count before mutating: these are pages of the ORIGINAL containing the word.
    for (let i = 0; i < doc.countPages(); i++) {
      const p = doc.loadPage(i);
      try {
        if (p.search(word, 1).length > 0) pagesWithWord++;
      } finally {
        p.destroy();
      }
    }

    const annot = mp.createAnnotation('Redact');
    try {
      annot.setRect(rect);
      annot.update();
    } finally {
      annot.destroy();
    }
    mp.applyRedactions(
      true,
      mupdf.PDFPage.REDACT_IMAGE_REMOVE,
      mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );
    mp.update();
    const buf = doc.saveToBuffer('compress');
    try {
      redacted = Uint8Array.from(buf.asUint8Array());
    } finally {
      buf.destroy();
    }
  } finally {
    mp?.destroy();
    doc.destroy();
  }

  const needle = Buffer.from(word, 'latin1');
  console.log(`\n=== ${file}  word="${word}"  pages containing it: ${pagesWithWord} ===`);
  const hits = streamsWithDicts(redacted).filter((s) => s.data.includes(needle));
  console.log(`streams containing the word after redaction: ${hits.length}`);
  for (const h of hits.slice(0, 6)) {
    const at = h.data.indexOf(needle);
    const ctx = h.data
      .subarray(Math.max(0, at - 70), at + needle.length + 70)
      .toString('latin1')
      .replace(/[\r\n]+/g, ' ');
    console.log(`  [${h.inflated ? 'FLATE' : 'raw  '}] ${describe(h.dict)}`);
    console.log(`     ...${ctx}...`);
  }
}
