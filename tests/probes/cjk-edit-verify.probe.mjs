// Independent verification of the QA claim that a supported-glyph CJK edit silently
// destroys all text. Graded with pdf.js, never with MuPDF, per ADR 0019.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const cMapUrl = asPath('../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../node_modules/pdfjs-dist/standard_fonts/');

async function textOf(file, label) {
  const doc = await getDocument({
    data: Uint8Array.from(readFileSync(file)),
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
  }).promise;
  let items = 0;
  let txt = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    items += content.items.length;
    txt += content.items.map((x) => x.str).join('');
  }
  console.log(
    label.padEnd(32),
    'pages',
    doc.numPages,
    '| items',
    String(items).padStart(4),
    '| chars',
    String(txt.replace(/\s/g, '').length).padStart(5),
  );
  return txt;
}

const original = await textOf(
  asPath('../fixtures/pdf-corpus/cjk-itext.pdf'),
  'ORIGINAL cjk-itext.pdf',
);
console.log('  original contains the CJK target 사회:', original.includes('사회'));

try {
  const edited = await textOf(
    'Q:/Software/_drive/out/fl-cjk-supported.pdf',
    'EDITED after CJK edit',
  );
  console.log('  edited contains replacement 사회:', edited.includes('사회'));
} catch (error) {
  console.log('  edited file could not be read:', error.message);
}
