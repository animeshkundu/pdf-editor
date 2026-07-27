// Two questions the oracle run did not answer.
//
// 1. The oracle filtered with recurse=true, instanceForms=false, newlines=true.
//    MuPDF's own pdf_redact_page configures the SAME filter with recurse=0 and
//    instance_forms=1 (source/pdf/pdf-clean.c). So redaction's actual configuration was
//    never exercised. Does the perturbation persist under it?
//
// 2. Does real redaction remove the text, and what collateral damage does it do?
//
// Metrics and tolerances mirror tests/pdf-oracle.test.ts exactly so the numbers are
// comparable to the published table. Judged with pdf.js, never with MuPDF, per ADR 0019.

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

// pdf.js requires a trailing slash on factory URLs and rejects Windows backslashes,
// so normalise the separators rather than handing it a native path.
const asFactoryUrl = (url) => fileURLToPath(url).replaceAll('\\', '/');

const corpusDir = asFactoryUrl(new URL('../fixtures/pdf-corpus/', import.meta.url));
const cMapUrl = asFactoryUrl(new URL('../../node_modules/pdfjs-dist/cmaps/', import.meta.url));
const standardFontDataUrl = asFactoryUrl(
  new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url),
);

const C8 = {
  viewportPoints: 0.001,
  differentPixelRatio: 0.0001,
  maxChannelDelta: 32,
  rmse: 0.1,
};

async function open(bytes) {
  // useSystemFonts is deliberately OFF. The oracle test leaves it on, which makes the
  // result depend on the host's installed fonts; a fidelity comparison should not.
  const task = getDocument({
    data: Uint8Array.from(bytes),
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
  });
  return { task, doc: await task.promise };
}

async function renderPage(page) {
  const viewport = page.getViewport({ scale: 2 }); // 144 dpi
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const ctx = createCanvas(width, height).getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width, height, viewport, pixels: ctx.getImageData(0, 0, width, height).data };
}

function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeChanged: true, differentPixels: -1, ratio: 1, maxDelta: 255, rmse: 255 };
  }
  let differentPixels = 0;
  let maxDelta = 0;
  let squared = 0;
  for (let o = 0; o < a.pixels.length; o += 4) {
    let differs = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.pixels[o + c] - b.pixels[o + c]);
      differs ||= d !== 0;
      if (d > maxDelta) maxDelta = d;
      squared += d * d;
    }
    differentPixels += Number(differs);
  }
  return {
    sizeChanged: false,
    differentPixels,
    ratio: differentPixels / (a.width * a.height),
    maxDelta,
    rmse: Math.sqrt(squared / a.pixels.length),
  };
}

const passesC8 = (m, viewportDelta) =>
  !m.sizeChanged &&
  viewportDelta <= C8.viewportPoints &&
  m.ratio <= C8.differentPixelRatio &&
  m.maxDelta <= C8.maxChannelDelta &&
  m.rmse <= C8.rmse;

/** Run the null filter over every page with the given flags, then full-save + compress. */
function filterWith(bytes, flags) {
  const doc = mupdf.Document.openDocument(Uint8Array.from(bytes), 'application/pdf');
  try {
    for (let i = 0; i < doc.countPages(); i++) {
      const p = doc.loadPage(i);
      try {
        p.filterContents(flags);
      } finally {
        p.destroy();
      }
    }
    const buf = doc.saveToBuffer('compress');
    try {
      return Uint8Array.from(buf.asUint8Array());
    } finally {
      buf.destroy();
    }
  } finally {
    doc.destroy();
  }
}

const ORACLE_FLAGS = {
  recurse: true,
  instanceForms: false,
  ascii: false,
  noUpdate: false,
  newlines: true,
};
// pdf_redact_page's own configuration, from source/pdf/pdf-clean.c.
const REDACT_FLAGS = {
  recurse: false,
  instanceForms: true,
  ascii: false,
  noUpdate: false,
  newlines: false,
};

const FAILING = ['ghostscript.pdf', 'latex-pdftex.pdf', 'libreoffice.pdf'];

console.log("Q1: does the perturbation persist under redaction's own filter flags?\n");
console.log(
  'document'.padEnd(20),
  'flags'.padEnd(7),
  'pages'.padStart(5),
  'failed'.padStart(6),
  'worst ratio'.padStart(12),
  'maxD'.padStart(5),
  'rmse'.padStart(7),
  ' C8',
);

for (const file of FAILING) {
  const original = readFileSync(corpusDir + file);
  const before = await open(original);

  for (const [label, flags] of [
    ['oracle', ORACLE_FLAGS],
    ['redact', REDACT_FLAGS],
  ]) {
    let after;
    try {
      after = await open(filterWith(original, flags));
    } catch (e) {
      console.log(file.padEnd(20), label.padEnd(7), 'ERROR', String(e.message).slice(0, 50));
      continue;
    }
    const failedPages = [];
    const changedPages = [];
    let worst = { ratio: 0, maxDelta: 0, rmse: 0, differentPixels: 0 };
    const n = Math.min(before.doc.numPages, after.doc.numPages);
    for (let i = 1; i <= n; i++) {
      const bp = await before.doc.getPage(i);
      const ap = await after.doc.getPage(i);
      const b = await renderPage(bp);
      const a = await renderPage(ap);
      const viewportDelta = Math.max(
        Math.abs(a.viewport.width - b.viewport.width),
        Math.abs(a.viewport.height - b.viewport.height),
      );
      const m = compare(b, a);
      if (m.differentPixels !== 0) changedPages.push(`${i}(${m.differentPixels})`);
      if (!passesC8(m, viewportDelta)) failedPages.push(i);
      if (m.ratio > worst.ratio) worst = m;
      bp.cleanup();
      ap.cleanup();
    }
    console.log(
      file.padEnd(20),
      label.padEnd(7),
      String(n).padStart(5),
      String(failedPages.length).padStart(6),
      worst.ratio.toFixed(6).padStart(12),
      String(worst.maxDelta).padStart(5),
      worst.rmse.toFixed(3).padStart(7),
      failedPages.length === 0 ? ' PASS' : ' FAIL',
    );
    console.log('     changed pages(px):', changedPages.join(' ') || 'none');
    if (failedPages.length) console.log('     exceeded C8 on pages:', failedPages.join(','));
    if (before.doc.numPages !== after.doc.numPages) {
      console.log('     !! page count', before.doc.numPages, '->', after.doc.numPages);
    }
    await after.task.destroy();
  }
  await before.task.destroy();
}
