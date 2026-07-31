import type { EngineTypes } from '@/lib/engine/port';

interface RedactionTextSnapshot {
  readonly characters: number;
  readonly pageFingerprints: ReadonlyMap<number, string>;
}

type RedactionRegion = Pick<EngineTypes['AnnotationInfo'], 'pageIndex' | 'rect'>;
const MAX_REDACTION_SAMPLE_PIXELS = 1_000_000;

async function pageFingerprint(
  engine: EngineTypes['PdfEngine'],
  pageIndex: number,
  rects: readonly EngineTypes['PdfRect'][],
  regionPixelBudget: number,
): Promise<string> {
  const page = engine.info.pages[pageIndex];
  if (!page) return '';
  let first = 2_166_136_261;
  let second = 0;
  for (const rect of rects) {
    const rectWidth = Math.max(0, Math.min(page.width, Math.abs(rect[2] - rect[0])));
    const rectHeight = Math.max(0, Math.min(page.height, Math.abs(rect[3] - rect[1])));
    if (rectWidth === 0 || rectHeight === 0) continue;
    const scale = Math.min(
      1,
      Math.sqrt(regionPixelBudget / Math.max(1, rectWidth * rectHeight)),
    );
    const left = Math.max(0, Math.floor((Math.min(rect[0], rect[2]) - page.bounds[0]) * scale));
    const top = Math.max(0, Math.floor((Math.min(rect[1], rect[3]) - page.bounds[1]) * scale));
    let width = Math.max(1, Math.ceil(rectWidth * scale));
    let height = Math.max(1, Math.ceil(rectHeight * scale));
    while (width * height > regionPixelBudget) {
      if (width >= height) width -= 1;
      else height -= 1;
    }
    const right = Math.min(Math.ceil(page.width * scale), left + width);
    const bottom = Math.min(Math.ceil(page.height * scale), top + height);
    width = right - left;
    height = bottom - top;
    if (width <= 0 || height <= 0) continue;
    for (let y = top; y < bottom; y += 512) {
      for (let x = left; x < right; x += 512) {
        const tile = await engine.renderTile({
          pageIndex,
          scale,
          x,
          y,
          width: Math.min(512, right - x),
          height: Math.min(512, bottom - y),
          priority: 0,
        });
        const pixels = new Uint8Array(tile.pixels);
        for (const value of pixels) {
          first = Math.imul(first ^ value, 16_777_619) >>> 0;
          second = (Math.imul(second, 33) + value) >>> 0;
        }
      }
    }
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

export async function snapshotRedactionText(
  engine: EngineTypes['PdfEngine'],
  regions: readonly RedactionRegion[],
): Promise<RedactionTextSnapshot> {
  let characters = 0;
  const pageFingerprints = new Map<number, string>();
  const pages = new Map<number, EngineTypes['PdfRect'][]>();
  for (const region of regions) {
    const rects = pages.get(region.pageIndex) ?? [];
    rects.push(region.rect);
    pages.set(region.pageIndex, rects);
  }
  const regionPixelBudget = Math.max(
    1,
    Math.floor(MAX_REDACTION_SAMPLE_PIXELS / Math.max(1, regions.length)),
  );
  for (const [pageIndex, rects] of pages) {
    const page = await engine.getPageText(pageIndex);
    characters += page.characters;
    pageFingerprints.set(
      pageIndex,
      await pageFingerprint(engine, pageIndex, rects, regionPixelBudget),
    );
  }
  return { characters, pageFingerprints };
}

export function describeRedactionOutcome(
  report: EngineTypes['ApplyRedactionsReport'],
  before: RedactionTextSnapshot,
  after: RedactionTextSnapshot,
): string {
  const removedCharacters = Math.max(0, before.characters - after.characters);
  if (removedCharacters === 0) {
    const renderedPageChanged = [...before.pageFingerprints].some(
      ([pageIndex, fingerprint]) => after.pageFingerprints.get(pageIndex) !== fingerprint,
    );
    return renderedPageChanged
      ? `Applied ${report.applied} redaction ${report.applied === 1 ? 'mark' : 'marks'}. No extractable characters were removed, but the rendered marked region changed; the mark may have removed image or line-art content. Inspect the marked region before sharing the document.`
      : `Applied ${report.applied} redaction ${report.applied === 1 ? 'mark' : 'marks'}, but no extractable characters were removed and the sampled marked region did not change. Inspect the marked region before sharing the document.`;
  }
  return `Removed ${removedCharacters} extractable ${removedCharacters === 1 ? 'character' : 'characters'} with ${report.applied} redaction ${report.applied === 1 ? 'mark' : 'marks'} on ${report.pages} ${report.pages === 1 ? 'page' : 'pages'}. Inspect the marked region before sharing the document.`;
}
