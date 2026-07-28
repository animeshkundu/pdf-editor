import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { EngineTypes } from '../../port';
import { withArenaSync, type Arena } from '../arena';

const DEFAULT_PAGE: EngineTypes['PdfRect'] = [0, 0, 612, 792];

function uniquePageIndices(
  document: mupdf.PDFDocument,
  pageIndices: readonly number[],
  allowEmpty = false,
): number[] {
  if (!allowEmpty && pageIndices.length === 0) throw new Error('Select at least one page.');
  const unique = [...new Set(pageIndices)];
  if (
    unique.some(
      (pageIndex) =>
        !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.countPages(),
    )
  ) {
    throw new Error('One or more selected pages are outside this document.');
  }
  return unique;
}

function saveDocument(arena: Arena, document: mupdf.PDFDocument): ArrayBuffer {
  const buffer = arena.keep(
    document.saveToBuffer({
      garbage: 'deduplicate',
      compress: true,
      'compress-fonts': true,
    }),
  );
  return Uint8Array.from(buffer.asUint8Array()).buffer;
}

function assertPagesHaveNoInteractiveObjects(
  arena: Arena,
  document: mupdf.PDFDocument,
  pageIndices: readonly number[],
  action: string,
): void {
  for (const pageIndex of [...new Set(pageIndices)]) {
    const page = arena.keep(document.loadPage(pageIndex));
    const annotations = page.getAnnotations();
    const widgets = page.getWidgets();
    const links = page.getLinks();
    for (const annotation of annotations) arena.keep(annotation);
    for (const widget of widgets) arena.keep(widget);
    for (const link of links) arena.keep(link);
    if (annotations.length > 0 || widgets.length > 0 || links.length > 0) {
      throw new Error(
        `${action} refused page ${pageIndex + 1} because MuPDF page grafting would omit ${
          annotations.length
        } annotation${annotations.length === 1 ? '' : 's'} and ${widgets.length} form ${
          widgets.length === 1 ? 'widget' : 'widgets'
        } and ${links.length} link${links.length === 1 ? '' : 's'}. Remove or flatten those interactive objects first.`,
      );
    }
  }
}

function extractInto(
  arena: Arena,
  source: mupdf.PDFDocument,
  pageIndices: readonly number[],
): ArrayBuffer {
  assertPagesHaveNoInteractiveObjects(arena, source, pageIndices, 'Page extraction');
  const output = arena.keep(new mupdf.PDFDocument());
  for (const pageIndex of pageIndices) output.graftPage(-1, source, pageIndex);
  return saveDocument(arena, output);
}

export function reorderPages(document: mupdf.PDFDocument, order: readonly number[]): void {
  const pages = uniquePageIndices(document, order);
  if (pages.length !== document.countPages()) {
    throw new Error('A page reorder must include every page exactly once.');
  }
  document.rearrangePages(pages);
}

export function rotatePages(
  arena: Arena,
  document: mupdf.PDFDocument,
  pageIndices: readonly number[],
  degrees: number,
): void {
  const pages = uniquePageIndices(document, pageIndices);
  for (const pageIndex of pages) {
    const pageObject = arena.keep(document.findPage(pageIndex));
    const inherited = arena.keep(pageObject.getInheritable('Rotate'));
    const current = inherited.isNumber() ? inherited.asNumber() : 0;
    const rotation = (((current + degrees) % 360) + 360) % 360;
    arena.keep(pageObject.put('Rotate', rotation));
  }
}

export function insertBlankPage(
  arena: Arena,
  document: mupdf.PDFDocument,
  at: number,
  size: EngineTypes['PdfRect'] = DEFAULT_PAGE,
): void {
  if (!Number.isInteger(at) || at < 0 || at > document.countPages()) {
    throw new Error(`The insertion point ${at + 1} is outside this document.`);
  }
  if (
    size.some((value) => !Number.isFinite(value)) ||
    size[2] <= size[0] ||
    size[3] <= size[1]
  ) {
    throw new Error('A blank page must have finite positive width and height.');
  }
  const page = arena.keep(document.addPage([...size], 0, null, new Uint8Array(0)));
  document.insertPage(at, page);
}

export function deletePages(document: mupdf.PDFDocument, pageIndices: readonly number[]): void {
  const pages = uniquePageIndices(document, pageIndices).sort((left, right) => right - left);
  if (pages.length >= document.countPages()) {
    throw new Error('A PDF must keep at least one page.');
  }
  for (const pageIndex of pages) document.deletePage(pageIndex);
}

export function setPageBoxes(
  arena: Arena,
  document: mupdf.PDFDocument,
  pageIndices: readonly number[],
  box: EngineTypes['PageBox'],
  rect: EngineTypes['PdfRect'],
): void {
  const pages = uniquePageIndices(document, pageIndices);
  if (
    rect.some((value) => !Number.isFinite(value)) ||
    rect[2] <= rect[0] ||
    rect[3] <= rect[1]
  ) {
    throw new Error('A page box must have finite positive width and height.');
  }
  for (const pageIndex of pages) {
    const page = arena.keep(document.loadPage(pageIndex));
    page.setPageBox(box, [...rect]);
  }
}

const PAGE_LABEL_STYLES: Readonly<Record<EngineTypes['PageLabelStyle'], string>> = {
  none: mupdf.PDFDocument.PAGE_LABEL_NONE,
  decimal: mupdf.PDFDocument.PAGE_LABEL_DECIMAL,
  'roman-upper': mupdf.PDFDocument.PAGE_LABEL_ROMAN_UC,
  'roman-lower': mupdf.PDFDocument.PAGE_LABEL_ROMAN_LC,
  'alpha-upper': mupdf.PDFDocument.PAGE_LABEL_ALPHA_UC,
  'alpha-lower': mupdf.PDFDocument.PAGE_LABEL_ALPHA_LC,
};

export function setPageLabels(
  document: mupdf.PDFDocument,
  at: number,
  style: EngineTypes['PageLabelStyle'],
  prefix: string,
  start: number,
): void {
  if (!Number.isInteger(at) || at < 0 || at >= document.countPages()) {
    throw new Error(`Page ${at + 1} is outside this document.`);
  }
  if (!Number.isInteger(start) || start < 1) {
    throw new Error('A page-label start number must be a positive integer.');
  }
  document.setPageLabels(at, PAGE_LABEL_STYLES[style], prefix, start);
}

export function extractPages(
  arena: Arena,
  document: mupdf.PDFDocument,
  pageIndices: readonly number[],
): ArrayBuffer {
  const pages = uniquePageIndices(document, pageIndices);
  return extractInto(arena, document, pages);
}

export function mergeDocument(
  arena: Arena,
  document: mupdf.PDFDocument,
  data: ArrayBuffer,
  insertAt: number,
  sourcePages?: readonly number[],
): number {
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > document.countPages()) {
    throw new Error(`The merge point ${insertAt + 1} is outside this document.`);
  }
  const sourceDocument = arena.keep(
    mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf'),
  );
  if (!(sourceDocument instanceof mupdf.PDFDocument)) {
    throw new Error('The selected merge source is not a PDF document.');
  }
  const pages = sourcePages
    ? uniquePageIndices(sourceDocument, sourcePages)
    : Array.from({ length: sourceDocument.countPages() }, (_, index) => index);
  assertPagesHaveNoInteractiveObjects(arena, sourceDocument, pages, 'Page merge');
  pages.forEach((pageIndex, offset) => {
    document.graftPage(insertAt + offset, sourceDocument, pageIndex);
  });
  return pages.length;
}

export function composePages(
  arena: Arena,
  document: mupdf.PDFDocument,
  data: ArrayBuffer | undefined,
  order: readonly EngineTypes['PageCompositionItem'][],
): void {
  if (order.length === 0) throw new Error('A PDF must keep at least one page.');
  const current = arena.keep(new mupdf.PDFDocument(document));
  const incoming = data
    ? arena.keep(mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf'))
    : null;
  if (incoming && !(incoming instanceof mupdf.PDFDocument)) {
    throw new Error('The selected composition source is not a PDF document.');
  }
  for (const [index, item] of order.entries()) {
    const source = item.source === 'current' ? current : incoming;
    if (!source) {
      throw new Error(`Composition page ${index + 1} refers to a missing source document.`);
    }
    if (
      !Number.isInteger(item.pageIndex) ||
      item.pageIndex < 0 ||
      item.pageIndex >= source.countPages()
    ) {
      throw new Error(`Composition page ${index + 1} is outside its source document.`);
    }
  }
  assertPagesHaveNoInteractiveObjects(
    arena,
    current,
    order.filter((item) => item.source === 'current').map((item) => item.pageIndex),
    'Page composition',
  );
  if (incoming) {
    assertPagesHaveNoInteractiveObjects(
      arena,
      incoming,
      order.filter((item) => item.source === 'incoming').map((item) => item.pageIndex),
      'Page composition',
    );
  }
  const originalCount = document.countPages();
  order.forEach((item, index) => {
    const source = item.source === 'current' ? current : incoming;
    if (!source) throw new Error('The incoming composition source is unavailable.');
    document.graftPage(originalCount + index, source, item.pageIndex);
  });
  for (let index = 0; index < originalCount; index += 1) document.deletePage(0);
}

export function splitDocument(
  document: mupdf.PDFDocument,
  ranges: readonly (readonly [number, number])[],
): EngineTypes['ExportedPdf'][] {
  if (ranges.length === 0) throw new Error('Add at least one split range.');
  return withArenaSync((arena) =>
    ranges.map(([start, end], index) => {
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end <= start ||
        end > document.countPages()
      ) {
        throw new Error(`Split range ${index + 1} is outside this document.`);
      }
      const pages = Array.from({ length: end - start }, (_, offset) => start + offset);
      return {
        name: `part-${index + 1}.pdf`,
        data: extractInto(arena, document, pages),
      };
    }),
  );
}

export default {
  composePages,
  deletePages,
  extractPages,
  insertBlankPage,
  mergeDocument,
  reorderPages,
  rotatePages,
  setPageBoxes,
  setPageLabels,
  splitDocument,
};
