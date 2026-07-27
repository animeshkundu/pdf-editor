// Test whether garbage-collecting saves remove pre-redaction text that was demonstrably
// present in a searchable original stream. Cases absent before redaction are not measured.

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

function searchableStreams(bytes) {
  const buf = Buffer.from(bytes);
  const streams = [];
  let failedInflates = 0;
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
      streams.push(inflateSync(raw));
    } catch {
      streams.push(raw);
      failedInflates++;
    }
    i = end + 9;
  }
  return { streams, failedInflates };
}

function encodings(word) {
  const utf16be = Buffer.alloc(word.length * 2);
  for (let i = 0; i < word.length; i++) utf16be.writeUInt16BE(word.charCodeAt(i), i * 2);
  return [
    ['latin1', Buffer.from(word, 'latin1')],
    ['utf16be', utf16be],
    ['hex', Buffer.from(Buffer.from(word, 'latin1').toString('hex'), 'ascii')],
  ];
}

function streamHits(bytes, word) {
  const { streams, failedInflates } = searchableStreams(bytes);
  return {
    matches: encodings(word)
      .filter(([, needle]) => streams.some((stream) => stream.includes(needle)))
      .map(([name]) => name),
    failedInflates,
  };
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
  'stream'.padEnd(18),
  'inflate!'.padStart(8),
  'bytes'.padStart(8),
);

for (const { file, word } of CASES) {
  const original = readFileSync(corpusDir + file);
  const pre = streamHits(original, word);
  if (!pre.matches.length) {
    console.log(file.padEnd(32), 'n/a (absent pre)');
    console.log();
    continue;
  }

  for (const mode of SAVE_MODES) {
    const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
    let redacted = null;
    let error = null;
    try {
      const mp = doc.loadPage(0);
      try {
        const hits = mp.search(word, 4);
        if (!hits.length) throw new Error('word not found on page 1');
        const annot = mp.createAnnotation('Redact');
        try {
          annot.setRect(quadToRect(hits[0][0]));
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
      } finally {
        mp.destroy();
      }
      const buf = doc.saveToBuffer(mode);
      try {
        redacted = Uint8Array.from(buf.asUint8Array());
      } finally {
        buf.destroy();
      }
    } catch (e) {
      error = e.message;
    } finally {
      doc.destroy();
    }

    if (error) {
      console.log(file.padEnd(32), mode.padEnd(32), `ERROR ${error.slice(0, 40)}`);
      continue;
    }
    const post = streamHits(redacted, word);
    console.log(
      file.padEnd(32),
      mode.padEnd(32),
      (post.matches.length ? `PRESENT(${post.matches.join('+')})` : 'gone').padEnd(18),
      String(post.failedInflates).padStart(8),
      String(redacted.length).padStart(8),
    );
  }
  console.log();
}
