// Q2: does real redaction actually remove the text, and what does it cost the rest of
// the page?
//
// Method. Locate a real word with MuPDF's own page.search (MuPDF is allowed to LOCATE;
// it is never the acceptance reader), place a Redact annotation on the returned quad,
// apply redactions, full save. Then check, all with pdf.js or raw bytes:
//
//   a. pdf.js no longer extracts the word            (semantic removal)
//   b. the word is absent from every INFLATED stream (byte-level removal — a raw byte
//      grep is a false green, because content streams are FLATE-compressed)
//   c. pixels changed inside vs outside the redacted quad (did it work, and what did it
//      cost the rest of the page)
//
// (c) is the number that matters for ADR 0020: redaction writes through
// pdf_filter_page_contents, so it inherits whatever that filter does to the rest of the
// page. Non-zero "inside" is the positive control that the redaction actually fired.

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

const SCALE = 2; // 144 dpi

const load = (data) =>
  getDocument({
    data: Uint8Array.from(data),
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
  }).promise;

async function renderPage(page) {
  const viewport = page.getViewport({ scale: SCALE });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const ctx = createCanvas(width, height).getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
}

/** Every stream in the file, inflated where possible. Catches text a raw grep misses. */
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
      out.push(raw); // not FLATE, or a broken slice; search it raw
    }
    i = end + 9;
  }
  return out;
}

function containsNeedle(bytes, needle) {
  const buf = Buffer.from(bytes);
  return {
    raw: buf.includes(needle),
    inStream: inflatedStreams(bytes).some((s) => s.includes(needle)),
  };
}

const quadToRect = (q) => [
  Math.min(q[0], q[2], q[4], q[6]),
  Math.min(q[1], q[3], q[5], q[7]),
  Math.max(q[0], q[2], q[4], q[6]),
  Math.max(q[1], q[3], q[5], q[7]),
];

const DOCS = [
  'libreoffice.pdf',
  'apache-fop.pdf',
  'distiller-tagged-linearized.pdf',
  'ghostscript.pdf',
  'latex-pdftex.pdf',
  'word-cid.pdf',
  'ocg-acrobat.pdf',
  'transparency-group.pdf',
];

console.log('Q2: real redaction. "inside" is the positive control: 0 means it did not fire.\n');
console.log(
  'document'.padEnd(32),
  'word'.padEnd(12),
  'pdf.js'.padEnd(8),
  'stream'.padEnd(8),
  'inside'.padStart(8),
  'outside'.padStart(9),
  'out%'.padStart(8),
);

for (const file of DOCS) {
  const original = readFileSync(corpusDir + file);

  // --- locate a word with MuPDF, then redact its quad ---
  const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
  let word = null;
  let rect = null;
  let redacted = null;
  let error = null;
  try {
    const mp = doc.loadPage(0);
    // Pull candidate words out of structured text, then search for the best one so the
    // quad comes from MuPDF's own matcher rather than from hand-built coordinates.
    const st = mp.toStructuredText();
    const plain = st.asText?.() ?? '';
    st.destroy();
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
    if (word) {
      const annot = mp.createAnnotation('Redact');
      annot.setRect(rect);
      annot.update();
      mp.applyRedactions(true, 1, 0, 0); // black boxes, remove images, remove text
      mp.update();
      const buf = doc.saveToBuffer('compress');
      redacted = Uint8Array.from(buf.asUint8Array());
      buf.destroy();
    }
    mp.destroy();
  } catch (e) {
    error = e.message;
  }
  doc.destroy();

  if (error) {
    console.log(`${file.padEnd(32)} ERROR ${error.slice(0, 60)}`);
    continue;
  }
  if (!word) {
    console.log(`${file.padEnd(32)} no uniquely-locatable word on page 1`);
    continue;
  }

  const before = await load(original);
  const after = await load(redacted);
  const bp = await before.getPage(1);
  const ap = await after.getPage(1);
  const beforeRender = await renderPage(bp);
  const afterRender = await renderPage(ap);
  const afterText = (await ap.getTextContent()).items.map((i) => i.str).join(' ');

  // MuPDF quads are already in the same top-left-origin space pdf.js renders into.
  const box = {
    x0: rect[0] * SCALE - 2,
    y0: rect[1] * SCALE - 2,
    x1: rect[2] * SCALE + 2,
    y1: rect[3] * SCALE + 2,
  };
  let inside = 0;
  let outside = 0;
  if (beforeRender.width === afterRender.width && beforeRender.height === afterRender.height) {
    for (let py = 0; py < beforeRender.height; py++) {
      for (let px = 0; px < beforeRender.width; px++) {
        const o = (py * beforeRender.width + px) * 4;
        let differs = false;
        for (let c = 0; c < 4; c++) {
          if (beforeRender.pixels[o + c] !== afterRender.pixels[o + c]) differs = true;
        }
        if (!differs) continue;
        if (px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1) inside++;
        else outside++;
      }
    }
  } else {
    inside = outside = -1;
  }

  const needle = Buffer.from(word, 'latin1');
  const hit = containsNeedle(redacted, needle);
  const totalPixels = beforeRender.width * beforeRender.height;

  console.log(
    file.padEnd(32),
    word.slice(0, 11).padEnd(12),
    (afterText.includes(word) ? 'LEAK' : 'gone').padEnd(8),
    (hit.inStream ? 'LEAK' : 'gone').padEnd(8),
    String(inside).padStart(8),
    String(outside).padStart(9),
    `${((outside / totalPixels) * 100).toFixed(3)}%`.padStart(8),
  );

  await before.destroy?.();
  await after.destroy?.();
}
