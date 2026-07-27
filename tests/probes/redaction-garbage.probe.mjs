// The redacted text is unreachable by pdf.js but still present as plaintext in an
// inflated stream. Hypothesis: saveToBuffer('compress') does not garbage-collect, so the
// PRE-redaction content stream survives as an orphaned object and anyone who inflates
// the file recovers the text.
//
// If that is right, the leak disappears under a garbage-collecting save, and the rule
// for the product is that redaction must never be saved without one.

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

function inflatedStreams(bytes) {
  const buf = Buffer.from(bytes);
  const out = [];
  let i = 0;
  for (;;) {
    const start = buf.indexOf('stream', i);
    if (start < 0) break;
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const end = buf.indexOf('endstream', dataStart);
    if (end < 0) break;
    const raw = buf.subarray(dataStart, end);
    try {
      out.push(inflateSync(raw));
    } catch {
      out.push(raw);
    }
    i = end + 9;
  }
  return out;
}

const SAVE_MODES = [
  'compress',
  'compress,garbage',
  'compress,garbage=compact',
  'compress,garbage=deduplicate',
  'garbage=deduplicate,compress,sanitize',
];

const CASES = [
  { file: 'apache-fop.pdf', word: 'embedded' },
  { file: 'ocg-acrobat.pdf', word: 'AlignmentTest' },
  { file: 'libreoffice.pdf', word: 'Characters' },
  { file: 'distiller-tagged-linearized.pdf', word: 'ItalicLine' },
  { file: 'ghostscript.pdf', word: 'questionnaire' },
];

console.log('Does a garbage-collecting save remove the orphaned pre-redaction stream?\n');
console.log(
  'document'.padEnd(32),
  'save mode'.padEnd(32),
  'plaintext'.padEnd(10),
  'bytes'.padStart(8),
);

for (const { file, word } of CASES) {
  const original = readFileSync(corpusDir + file);
  const needle = Buffer.from(word, 'latin1');

  for (const mode of SAVE_MODES) {
    const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
    let redacted = null;
    let error = null;
    try {
      const mp = doc.loadPage(0);
      const hits = mp.search(word, 4);
      if (!hits.length) throw new Error('word not found on page 1');
      const annot = mp.createAnnotation('Redact');
      annot.setRect(quadToRect(hits[0][0]));
      annot.update();
      mp.applyRedactions(true, 1, 0, 0);
      mp.update();
      mp.destroy();
      const buf = doc.saveToBuffer(mode);
      redacted = Uint8Array.from(buf.asUint8Array());
      buf.destroy();
    } catch (e) {
      error = e.message;
    }
    doc.destroy();

    if (error) {
      console.log(file.padEnd(32), mode.padEnd(32), `ERROR ${error.slice(0, 40)}`);
      continue;
    }
    const leaks = inflatedStreams(redacted).some((s) => s.includes(needle));
    console.log(
      file.padEnd(32),
      mode.padEnd(32),
      (leaks ? 'PRESENT' : 'gone').padEnd(10),
      String(redacted.length).padStart(8),
    );
  }
  console.log();
}
