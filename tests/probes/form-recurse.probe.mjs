// libreoffice.pdf: confirm the missing page-1 text lives inside Form XObjects that
// processContents does not descend into. TJ/Tj figures are byte-substring counts, not
// parsed operator counts.
import * as mupdf from '../../vendor/mupdf-wasm/dist/mupdf.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const asPath = (u) => fileURLToPath(new URL(u, import.meta.url)).replaceAll('\\', '/');
const doc = mupdf.Document.openDocument(
  Uint8Array.from(readFileSync(asPath('../fixtures/pdf-corpus/libreoffice.pdf'))),
  'application/pdf',
);
try {
  const page = doc.loadPage(0);
  try {
    const pageObject = page.getObject();
    try {
      const resources = pageObject.getInheritable('Resources');
      try {
        const res = resources.get('XObject');
        try {
          console.log(
            'page inheritable /Resources /XObject is dictionary:',
            res.isDictionary(),
          );
          res.forEach((val, key) => {
            const sub = val.get('Subtype');
            try {
              const stream = val.readStream();
              try {
                const text = Buffer.from(stream.asUint8Array()).toString('latin1');
                const tj = (text.match(/TJ/g) || []).length;
                const tjs = (text.match(/Tj/g) || []).length;
                console.log(
                  `  /${key} Subtype=${sub.asName?.() ?? '?'} streamBytes=${text.length} TJ-substrings=${tj} Tj-substrings=${tjs}`,
                );
              } finally {
                stream.destroy();
              }
            } finally {
              sub.destroy();
            }
          });
        } finally {
          res.destroy();
        }
      } finally {
        resources.destroy();
      }
    } finally {
      pageObject.destroy();
    }
  } finally {
    page.destroy();
  }
} finally {
  doc.destroy();
}
