// Settles one discrepancy: the pipeline's oracle table reports ghostscript.pdf as a C8
// failure, but the same filter run here passes. The suspect is useSystemFonts, which the
// oracle leaves on and which makes the result depend on the host's installed fonts.

import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

const bytes = readFileSync(asPath('../fixtures/pdf-corpus/ghostscript.pdf'));

const doc = mupdf.Document.openDocument(Uint8Array.from(bytes), 'application/pdf');
for (let i = 0; i < doc.countPages(); i++) {
  const pg = doc.loadPage(i);
  pg.filterContents({
    recurse: true,
    instanceForms: false,
    ascii: false,
    noUpdate: false,
    newlines: true,
  });
  pg.destroy();
}
const buf = doc.saveToBuffer('compress');
const filtered = Uint8Array.from(buf.asUint8Array());
buf.destroy();
doc.destroy();

for (const useSystemFonts of [true, false]) {
  const load = (data) =>
    getDocument({
      data: Uint8Array.from(data),
      cMapPacked: true,
      cMapUrl,
      standardFontDataUrl,
      useSystemFonts,
    }).promise;
  const before = await load(bytes);
  const after = await load(filtered);
  let worst = 0;
  let worstPage = 0;
  let maxDelta = 0;
  for (let i = 1; i <= before.numPages; i++) {
    const bp = await before.getPage(i);
    const ap = await after.getPage(i);
    const viewport = bp.getViewport({ scale: 2 });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const c1 = createCanvas(width, height).getContext('2d');
    const c2 = createCanvas(width, height).getContext('2d');
    await bp.render({ canvasContext: c1, viewport }).promise;
    await ap.render({ canvasContext: c2, viewport: ap.getViewport({ scale: 2 }) }).promise;
    const a = c1.getImageData(0, 0, width, height).data;
    const b = c2.getImageData(0, 0, width, height).data;
    let differing = 0;
    for (let k = 0; k < a.length; k += 4) {
      let differs = false;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(a[k + c] - b[k + c]);
        if (d) {
          differs = true;
          if (d > maxDelta) maxDelta = d;
        }
      }
      if (differs) differing++;
    }
    const ratio = differing / (width * height);
    if (ratio > worst) {
      worst = ratio;
      worstPage = i;
    }
  }
  console.log(
    `useSystemFonts=${String(useSystemFonts).padEnd(5)} worst ratio ${worst.toFixed(6)} on page ${worstPage}, maxDelta ${maxDelta} -> ${worst <= 0.0001 ? 'PASS' : 'FAIL'} (C8 limit 0.0001)`,
  );
}

// Are the fonts on this document embedded, or resolved from the host?
const probe = await getDocument({
  data: Uint8Array.from(bytes),
  cMapPacked: true,
  cMapUrl,
  standardFontDataUrl,
  useSystemFonts: false,
}).promise;
const fonts = new Map();
for (let i = 1; i <= probe.numPages; i++) {
  const pg = await probe.getPage(i);
  await pg.getOperatorList();
  for (const [key, value] of Object.entries(pg.commonObjs._objs ?? {})) {
    const data = value?.data ?? value;
    if (data?.loadedName) fonts.set(key, `${data.name} embedded=${data.data !== undefined}`);
  }
}
console.log('\nfonts:', [...fonts.values()].join('\n       '));
