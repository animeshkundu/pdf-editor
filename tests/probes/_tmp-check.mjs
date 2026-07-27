import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');

for (const file of ['libreoffice.pdf', 'apache-fop.pdf', 'ghostscript.pdf', 'latex-pdftex.pdf', 'ocg-acrobat.pdf', 'distiller-tagged-linearized.pdf']) {
  const doc = mupdf.Document.openDocument(Uint8Array.from(readFileSync(corpusDir + file)), 'application/pdf');
  const page = doc.loadPage(0);
  console.log(file, 'bounds', page.getBounds());
  const mb = page.getObject().get('MediaBox');
  console.log('  MediaBox obj isArray', mb.isArray?.());
  try { console.log('  MediaBox', [0,1,2,3].map(i=>mb.get(i).asNumber())); } catch(e) { console.log('  err', e.message); }
  const rot = page.getObject().get('Rotate');
  console.log('  Rotate', rot.isNumber?.() ? rot.asNumber() : '(inherited/none)');

  // check search quad coordinate space vs page bounds
  const st = page.toStructuredText();
  const hits = page.search('a', 1);
  if (hits.length) console.log('  sample quad for "a":', hits[0][0]);
  st.destroy();
  page.destroy();
  doc.destroy();
}
