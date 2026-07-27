import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const corpusDir = asPath('../fixtures/pdf-corpus/');
console.log('=== H. is `cooked != null` evidence of a usable BDC property dictionary? ===');
for (const f of ['distiller-tagged-linearized.pdf', 'ocg-acrobat.pdf']) {
  const doc = mupdf.Document.openDocument(Uint8Array.from(readFileSync(corpusDir + f)), 'application/pdf');
  const page = doc.loadPage(0);
  const trace = page.processContents();
  const bdc = trace.getRecords().filter((r) => r.operator === 'BDC');
  let cooked = 0, dict = 0, nonEmpty = 0, handleCounts = [];
  for (const r of bdc) {
    handleCounts.push((r.handles ?? []).length);
    if (r.cooked != null) {
      cooked++;
      try { if (r.cooked.isDictionary()) { dict++; if (r.cooked.length !== 0 || true) nonEmpty++; } } catch {}
    }
  }
  console.log(`${f.padEnd(34)} BDC=${bdc.length} cooked!=null=${cooked} cooked.isDictionary()=${dict} handleCounts=${JSON.stringify([...new Set(handleCounts)])}`);
  // does any BDC have exactly one handle (so raw/cooked slot identity is ambiguous)?
  console.log('   records with 1 handle (slot identity lost by array compaction):', handleCounts.filter((n) => n === 1).length);
  trace.destroy(); page.destroy(); doc.destroy();
}
