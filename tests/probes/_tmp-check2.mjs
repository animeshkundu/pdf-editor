import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

const SCALE = 2;
const file = 'apache-fop.pdf';
const word = 'embedded';

const original = readFileSync(corpusDir + file);
const doc = mupdf.Document.openDocument(Uint8Array.from(original), 'application/pdf');
const mp = doc.loadPage(0);
const bounds = mp.getBounds();
const hits = mp.search(word, 4);
const q = hits[0][0];
const rect = [
  Math.min(q[0], q[2], q[4], q[6]),
  Math.min(q[1], q[3], q[5], q[7]),
  Math.max(q[0], q[2], q[4], q[6]),
  Math.max(q[1], q[3], q[5], q[7]),
];
console.log('page bounds', bounds, 'rect', rect);
mp.destroy();
doc.destroy();

const pdfDoc = await getDocument({
  data: Uint8Array.from(original),
  cMapPacked: true,
  cMapUrl,
  standardFontDataUrl,
  useSystemFonts: false,
}).promise;
const page = await pdfDoc.getPage(1);
const viewport = page.getViewport({ scale: SCALE });
const width = Math.ceil(viewport.width);
const height = Math.ceil(viewport.height);
const ctx = createCanvas(width, height).getContext('2d');
await page.render({ canvasContext: ctx, viewport }).promise;

function cropAndSave(x0, y0, x1, y1, name) {
  const w = Math.max(1, Math.round(x1 - x0));
  const h = Math.max(1, Math.round(y1 - y0));
  const out = createCanvas(w, h);
  const octx = out.getContext('2d');
  octx.drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
  writeFileSync(name, out.toBuffer('image/png'));
  console.log('wrote', name, w, h);
}

// Hypothesis A: rect already top-left origin (probe's assumption)
cropAndSave(rect[0]*SCALE-20, rect[1]*SCALE-20, rect[2]*SCALE+20, rect[3]*SCALE+20, asPath('../../../crop_topleft.png'));

// Hypothesis B: rect is bottom-left PDF origin, needs y flip using page bounds height
const pageHeightPts = bounds[3] - bounds[1];
const flippedY0 = pageHeightPts - rect[3];
const flippedY1 = pageHeightPts - rect[1];
cropAndSave(rect[0]*SCALE-20, flippedY0*SCALE-20, rect[2]*SCALE+20, flippedY1*SCALE+20, asPath('../../../crop_flipped.png'));

console.log('full page size', width, height, 'pageHeightPts', pageHeightPts);
