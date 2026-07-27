import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

console.log('=== E. pdf.js negative control: does pdf.js extract the word BEFORE redaction? ===');
for (const [f, word] of [
  ['libreoffice.pdf', 'Characters'], ['apache-fop.pdf', 'embedded'],
  ['distiller-tagged-linearized.pdf', 'ItalicLine'], ['ghostscript.pdf', 'questionnaire'],
  ['latex-pdftex.pdf', 'Mathematical'], ['ocg-acrobat.pdf', 'AlignmentTest'],
]) {
  const d = await getDocument({ data: Uint8Array.from(readFileSync(corpusDir + f)), cMapPacked: true, cMapUrl, standardFontDataUrl, useSystemFonts: false }).promise;
  const p = await d.getPage(1);
  const t = (await p.getTextContent()).items.map((i) => i.str).join(' ');
  console.log(`${f.padEnd(34)} word=${word.padEnd(14)} pdf.js extracts it pre-redaction: ${t.includes(word)}`);
  
}
