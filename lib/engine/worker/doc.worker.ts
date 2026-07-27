import * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import {
  DESKTOP_BUDGET,
  IOS_BUDGET,
  assertFileSize,
  assertPageCount,
  assertPageSize,
  assertRenderSize,
} from '../../core/limits';
import type { EngineTypes } from '../port';
import workerRuntime from './arena';

type AttachmentInfo = EngineTypes['AttachmentInfo'];
type DocumentInfo = EngineTypes['DocumentInfo'];
type EngineRequest = EngineTypes['EngineRequest'];
type OutlineNode = EngineTypes['OutlineNode'];
type PageInfo = EngineTypes['PageInfo'];
type PdfQuad = EngineTypes['PdfQuad'];
type TextSelection = EngineTypes['TextSelection'];
type TileResult = EngineTypes['TileResult'];
const { postFailure, postSuccess, releaseRetained, retain, retained, withArena } =
  workerRuntime;
const scope = self as unknown as Parameters<typeof postSuccess>[0];
const DOCUMENT_KEY = 'document:active';
const MAX_SELECTION_QUADS = 4_096;
const cancelled = new Set<number>();

function activeDocument(): mupdf.Document {
  return retained<mupdf.Document>(DOCUMENT_KEY);
}

function asPdfDocument(): mupdf.PDFDocument | null {
  const document = activeDocument();
  return document instanceof mupdf.PDFDocument ? document : null;
}

function pageInfo(index: number, page: mupdf.Page, ios: boolean): PageInfo {
  const bounds = page.getBounds();
  const width = Math.max(0, bounds[2] - bounds[0]);
  const height = Math.max(0, bounds[3] - bounds[1]);
  assertPageSize(width, height, ios ? IOS_BUDGET : DESKTOP_BUDGET);
  return {
    index,
    label: page.getLabel() || String(index + 1),
    bounds,
    width,
    height,
  };
}

function readOutlineLevel(iterator: mupdf.OutlineIterator): OutlineNode[] {
  const document = activeDocument();
  const nodes: OutlineNode[] = [];
  while (true) {
    const item = iterator.item();
    if (!item) break;
    let pageIndex: number | null = null;
    if (item.uri) {
      const resolved = document.resolveLink(item.uri);
      pageIndex = resolved >= 0 ? resolved : null;
    }
    let children: OutlineNode[] = [];
    if (iterator.down() === mupdf.OutlineIterator.ITERATOR_AT_ITEM) {
      children = readOutlineLevel(iterator);
      iterator.up();
    }
    nodes.push({
      title: item.title || 'Untitled bookmark',
      pageIndex,
      children,
    });
    if (iterator.next() !== mupdf.OutlineIterator.ITERATOR_AT_ITEM) break;
  }
  return nodes;
}

function outline(): Promise<OutlineNode[]> {
  return withArena((arena) => {
    const iterator = arena.keep(activeDocument().outlineIterator());
    return readOutlineLevel(iterator);
  });
}

async function attachments(): Promise<AttachmentInfo[]> {
  const document = asPdfDocument();
  if (!document) return [];
  return withArena((arena) =>
    Object.entries(document.getEmbeddedFiles()).map(([id, reference]) => {
      const ownedReference = arena.keep(reference);
      const params = document.getFilespecParams(ownedReference);
      return {
        id,
        filename: params.filename || id,
        mimeType: params.mimetype || 'application/octet-stream',
      };
    }),
  );
}

async function openDocument(
  payload: Extract<EngineRequest, { operation: 'open' }>['payload'],
): Promise<DocumentInfo> {
  const budget = payload.ios ? IOS_BUDGET : DESKTOP_BUDGET;
  assertFileSize(payload.data.byteLength, budget);
  releaseRetained();
  const input = new Uint8Array(payload.data);
  const document = retain(DOCUMENT_KEY, mupdf.Document.openDocument(input, 'application/pdf'));

  try {
    const count = document.countPages();
    assertPageCount(count, budget);
    const pages: PageInfo[] = [];
    for (let index = 0; index < count; index += 1) {
      pages.push(
        await withArena((arena) =>
          pageInfo(index, arena.keep(document.loadPage(index)), payload.ios),
        ),
      );
    }
    return {
      name: payload.name,
      title: document.getMetaData(mupdf.Document.META_INFO_TITLE) || payload.name,
      pages,
      outline: await outline(),
      attachments: await attachments(),
      permissions: {
        copy: document.hasPermission(mupdf.Document.PERMISSION_COPY),
        print: document.hasPermission(mupdf.Document.PERMISSION_PRINT),
        annotate: document.hasPermission(mupdf.Document.PERMISSION_ANNOTATE),
      },
    };
  } catch (error) {
    releaseRetained();
    throw error;
  }
}

async function renderTile(
  request: Extract<EngineRequest, { operation: 'renderTile' }>['payload'],
  ios: boolean,
): Promise<TileResult> {
  assertRenderSize(request.width, request.height, ios ? IOS_BUDGET : DESKTOP_BUDGET);
  if (request.width > 512 || request.height > 512) {
    throw new Error('A render tile may not exceed 512 by 512 device pixels.');
  }
  return withArena((arena) => {
    const page = arena.keep(activeDocument().loadPage(request.pageIndex));
    const bounds = page.getBounds();
    const matrix: mupdf.Matrix = [
      request.scale,
      0,
      0,
      request.scale,
      -bounds[0] * request.scale,
      -bounds[1] * request.scale,
    ];
    const pixmap = arena.keep(
      new mupdf.Pixmap(
        mupdf.ColorSpace.DeviceRGB,
        [request.x, request.y, request.x + request.width, request.y + request.height],
        true,
      ),
    );
    pixmap.clear(255);
    const device = arena.keep(new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap));
    try {
      page.run(device, matrix);
    } finally {
      device.close();
    }
    const pixels = Uint8ClampedArray.from(pixmap.getPixels()).buffer;
    return {
      pageIndex: request.pageIndex,
      x: request.x,
      y: request.y,
      width: request.width,
      height: request.height,
      pixels,
    };
  });
}

async function pageText(pageIndex: number) {
  return withArena((arena) => {
    const page = arena.keep(activeDocument().loadPage(pageIndex));
    const text = arena.keep(page.toStructuredText());
    const limitations: ('form-xobject' | 'structure-tree')[] = [];
    const pdfPage = page instanceof mupdf.PDFPage ? page : null;
    if (pdfPage) {
      const trace = arena.keep(pdfPage.processContents());
      if (trace.getRecords().some((record) => record.operator === 'Do_form')) {
        limitations.push('form-xobject');
      }
    }
    const pdfDocument = asPdfDocument();
    if (pdfDocument) {
      const trailer = arena.keep(pdfDocument.getTrailer());
      const marked = arena.keep(trailer.get('Root', 'MarkInfo', 'Marked'));
      if (marked.isBoolean() && marked.asBoolean()) limitations.push('structure-tree');
    }
    return {
      pageIndex,
      text: text.asText(),
      analysis: limitations.length > 0 ? ('partial' as const) : ('inferred' as const),
      limitations,
    };
  });
}

async function selectText(
  payload: Extract<EngineRequest, { operation: 'selectText' }>['payload'],
): Promise<TextSelection> {
  return withArena((arena) => {
    const page = arena.keep(activeDocument().loadPage(payload.pageIndex));
    const text = arena.keep(page.toStructuredText());
    const quads = text.highlight(
      [payload.start[0], payload.start[1]],
      [payload.end[0], payload.end[1]],
      MAX_SELECTION_QUADS + 1,
    ) as PdfQuad[];
    return {
      pageIndex: payload.pageIndex,
      text: text.copy([payload.start[0], payload.start[1]], [payload.end[0], payload.end[1]]),
      quads: quads.slice(0, MAX_SELECTION_QUADS),
      truncated: quads.length > MAX_SELECTION_QUADS,
    };
  });
}

async function readAttachment(id: string): Promise<ArrayBuffer> {
  const document = asPdfDocument();
  if (!document) throw new Error('This document is not a PDF.');
  return withArena((arena) => {
    const files = document.getEmbeddedFiles();
    for (const reference of Object.values(files)) arena.keep(reference);
    const reference = files[id];
    if (!reference) throw new Error(`Attachment "${id}" no longer exists.`);
    const contents = document.getEmbeddedFileContents(reference);
    if (!contents) throw new Error(`Attachment "${id}" has no readable content.`);
    const ownedContents = arena.keep(contents);
    return Uint8Array.from(ownedContents.asUint8Array()).buffer;
  });
}

let iosBudget = false;

scope.addEventListener('message', (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  if (request.operation === 'cancel') {
    cancelled.add(request.payload.requestId);
    return;
  }

  void (async () => {
    try {
      if (request.operation === 'open') {
        iosBudget = request.payload.ios;
        postSuccess(scope, request.id, await openDocument(request.payload));
      } else if (request.operation === 'renderTile') {
        const result = await renderTile(request.payload, iosBudget);
        if (!cancelled.delete(request.id)) {
          postSuccess(scope, request.id, result, [result.pixels]);
        }
      } else if (request.operation === 'getPageText') {
        postSuccess(scope, request.id, await pageText(request.payload.pageIndex));
      } else if (request.operation === 'selectText') {
        postSuccess(scope, request.id, await selectText(request.payload));
      } else if (request.operation === 'getOutline') {
        postSuccess(scope, request.id, await outline());
      } else if (request.operation === 'getAttachments') {
        postSuccess(scope, request.id, await attachments());
      } else if (request.operation === 'readAttachment') {
        const data = await readAttachment(request.payload.id);
        postSuccess(scope, request.id, data, [data]);
      } else if (request.operation === 'close') {
        releaseRetained();
        postSuccess(scope, request.id, undefined);
      } else {
        throw new Error(
          `Operation "${request.operation}" is not available in the document worker.`,
        );
      }
    } catch (error) {
      postFailure(scope, request.id, error);
    }
  })();
});

postSuccess(scope, 0, undefined);
