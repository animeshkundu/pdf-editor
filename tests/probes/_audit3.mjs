import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
const DOCS = ['libreoffice.pdf','apache-fop.pdf','distiller-tagged-linearized.pdf','ghostscript.pdf','latex-pdftex.pdf','word-cid.pdf','ocg-acrobat.pdf','transparency-group.pdf'];
console.log('=== F. page-1 boxes / rotation: does quad*SCALE map to pdf.js device space? ===');
for (const f of DOCS) {
  const doc = mupdf.Document.openDocument(Uint8Array.from(readFileSync(corpusDir + f)), 'application/pdf');
  const p = doc.loadPage(0);
  const o = p.getObject();
  const mb = o.getInheritable('MediaBox');
  const cb = o.getInheritable('CropBox');
  const rot = o.getInheritable('Rotate');
  const str = (x) => { try { return x && !x.isNull?.() ? JSON.stringify(x.asJS?.() ?? x.toString()) : 'none'; } catch { return '?'; } };
  console.log(`${f.padEnd(34)} MediaBox=${str(mb)} CropBox=${str(cb)} Rotate=${str(rot)} bounds=${JSON.stringify(p.getBounds())}`);
  mb?.destroy?.(); cb?.destroy?.(); rot?.destroy?.(); o.destroy(); p.destroy(); doc.destroy();
}

console.log('\n=== G. latex-pdftex: where are the 18 pre-redaction "Mathematical" hits? ===');
{
  const doc = mupdf.Document.openDocument(Uint8Array.from(readFileSync(corpusDir + 'latex-pdftex.pdf')), 'application/pdf');
  let pages = 0;
  for (let i = 0; i < doc.countPages(); i++) { const p = doc.loadPage(i); if (p.search('Mathematical', 1).length) pages++; p.destroy(); }
  console.log('pages of latex-pdftex whose TEXT contains "Mathematical":', pages, 'of', doc.countPages());
  doc.destroy();
}
{
  const doc = mupdf.Document.openDocument(Uint8Array.from(readFileSync(corpusDir + 'apache-fop.pdf')), 'application/pdf');
  let pages = 0;
  for (let i = 0; i < doc.countPages(); i++) { const p = doc.loadPage(i); if (p.search('embedded', 1).length) pages++; p.destroy(); }
  console.log('pages of apache-fop whose TEXT contains "embedded":', pages, 'of', doc.countPages());
  doc.destroy();
}
