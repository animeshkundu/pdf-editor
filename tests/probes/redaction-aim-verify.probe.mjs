// Verify the QA claim that redaction cannot be aimed: it reports success while burning a
// box into blank space and leaving the intended text fully extractable.
// Graded with pdf.js, never MuPDF, per ADR 0019.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const cMapUrl = asPath('../../node_modules/pdfjs-dist/cmaps/');
const standardFontDataUrl = asPath('../../node_modules/pdfjs-dist/standard_fonts/');

async function firstPageText(file) {
  const doc = await getDocument({
    data: Uint8Array.from(readFileSync(file)),
    cMapPacked: true,
    cMapUrl,
    standardFontDataUrl,
    useSystemFonts: false,
  }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((i) => i.str).join('');
  return { pages: doc.numPages, text };
}

const cases = [
  [
    'latex-pdftex',
    asPath('../fixtures/pdf-corpus/latex-pdftex.pdf'),
    'Q:/Software/_drive/red/out-latex.pdf',
  ],
  [
    'ghostscript',
    asPath('../fixtures/pdf-corpus/ghostscript.pdf'),
    'Q:/Software/_drive/red/out-gs.pdf',
  ],
];

for (const [name, originalPath, redactedPath] of cases) {
  if (!existsSync(redactedPath)) {
    console.log(`${name}: no redacted output at ${redactedPath}`);
    continue;
  }
  const before = await firstPageText(originalPath);
  const after = await firstPageText(redactedPath);
  const beforeWords = new Set(before.text.match(/[A-Za-z]{4,}/g) ?? []);
  const afterWords = new Set(after.text.match(/[A-Za-z]{4,}/g) ?? []);
  const removed = [...beforeWords].filter((w) => !afterWords.has(w));
  console.log(`\n=== ${name} ===`);
  console.log(`  chars before ${before.text.length}  after ${after.text.length}`);
  console.log(`  distinct words removed by the redaction: ${removed.length}`);
  console.log(
    `  removed: ${removed.slice(0, 12).join(', ') || '(none — nothing was redacted)'}`,
  );
}
