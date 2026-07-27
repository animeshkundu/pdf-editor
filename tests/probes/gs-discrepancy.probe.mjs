// Compare ghostscript.pdf under both pdf.js font modes. The corpus expectation failed
// maxChannelDelta (64 against C8's 32), so report that metric per page with ratio and RMSE.

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
let filtered;
try {
  for (let i = 0; i < doc.countPages(); i++) {
    const pg = doc.loadPage(i);
    try {
      pg.filterContents({
        recurse: true,
        instanceForms: false,
        ascii: false,
        noUpdate: false,
        newlines: true,
      });
    } finally {
      pg.destroy();
    }
  }
  const buf = doc.saveToBuffer('compress');
  try {
    filtered = Uint8Array.from(buf.asUint8Array());
  } finally {
    buf.destroy();
  }
} finally {
  doc.destroy();
}

for (const useSystemFonts of [true, false]) {
  const open = (data) => {
    const task = getDocument({
      data: Uint8Array.from(data),
      cMapPacked: true,
      cMapUrl,
      standardFontDataUrl,
      useSystemFonts,
    });
    return { task, promise: task.promise };
  };
  const beforeLoad = open(bytes);
  const afterLoad = open(filtered);
  console.log(`\nuseSystemFonts=${useSystemFonts}`);
  console.log(
    'page'.padStart(4),
    'ratio'.padStart(10),
    'maxChannelDelta'.padStart(16),
    'rmse'.padStart(8),
  );
  try {
    const before = await beforeLoad.promise;
    const after = await afterLoad.promise;
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
      let maxChannelDelta = 0;
      let squared = 0;
      for (let k = 0; k < a.length; k += 4) {
        let differs = false;
        for (let c = 0; c < 4; c++) {
          const delta = Math.abs(a[k + c] - b[k + c]);
          differs ||= delta !== 0;
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          squared += delta * delta;
        }
        differing += Number(differs);
      }
      const ratio = differing / (width * height);
      const rmse = Math.sqrt(squared / a.length);
      console.log(
        String(i).padStart(4),
        ratio.toFixed(6).padStart(10),
        String(maxChannelDelta).padStart(16),
        rmse.toFixed(3).padStart(8),
      );
      bp.cleanup();
      ap.cleanup();
    }
  } finally {
    await beforeLoad.task.destroy();
    await afterLoad.task.destroy();
  }
}
