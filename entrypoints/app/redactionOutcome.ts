import type { EngineTypes } from '@/lib/engine/port';

interface RedactionTextSnapshot {
  readonly characters: number;
}

export async function snapshotRedactionText(
  engine: EngineTypes['PdfEngine'],
  pageIndices: readonly number[],
): Promise<RedactionTextSnapshot> {
  const pages = await Promise.all(
    pageIndices.map((pageIndex) => engine.getPageText(pageIndex)),
  );
  return { characters: pages.reduce((total, page) => total + page.text.length, 0) };
}

export function describeRedactionOutcome(
  report: EngineTypes['ApplyRedactionsReport'],
  before: RedactionTextSnapshot,
  after: RedactionTextSnapshot,
): string {
  const removedCharacters = Math.max(0, before.characters - after.characters);
  if (removedCharacters === 0) {
    return `Applied ${report.applied} redaction ${report.applied === 1 ? 'mark' : 'marks'}, but removed no extractable text. Do not treat this redaction as successful; inspect the marked region before sharing the document.`;
  }
  return `Removed ${removedCharacters} extractable ${removedCharacters === 1 ? 'character' : 'characters'} with ${report.applied} redaction ${report.applied === 1 ? 'mark' : 'marks'} on ${report.pages} ${report.pages === 1 ? 'page' : 'pages'}. Output is unblocked.`;
}
