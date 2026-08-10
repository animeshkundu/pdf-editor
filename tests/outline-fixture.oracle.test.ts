import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

interface PdfJsOutlineNode {
  readonly title: string;
  readonly items: readonly PdfJsOutlineNode[];
}

function titles(nodes: readonly PdfJsOutlineNode[] | null, depth = 0): readonly string[] {
  if (!nodes) return [];
  return nodes.flatMap((node) => [`${depth}:${node.title}`, ...titles(node.items, depth + 1)]);
}

describe('VIEW-021 nested outline fixture oracle', () => {
  it('is accepted by pdf.js with the expected destinations and nesting', async () => {
    const data = await readFile('tests/fixtures/pdf-corpus/nested-outline.pdf');
    const task = getDocument({ data: Uint8Array.from(data) });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(4);
      const outline = await document.getOutline();
      expect(titles(outline)).toEqual([
        '0:Introduction',
        '0:Part One',
        '1:Chapter One',
        '2:Section One',
        '3:Deep Topic',
        '4:Deep Detail',
        '0:Appendix',
      ]);
      expect(outline?.[0]?.dest).toEqual([{ num: 3, gen: 0 }, { name: 'Fit' }]);
      expect(outline?.[1]?.items[0]?.items[0]?.items[0]?.items[0]?.dest).toEqual([
        { num: 7, gen: 0 },
        { name: 'Fit' },
      ]);
    } finally {
      await task.destroy();
    }
  });
});
