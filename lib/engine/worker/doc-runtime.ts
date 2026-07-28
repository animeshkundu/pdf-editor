import * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import {
  DESKTOP_BUDGET,
  IOS_BUDGET,
  assertFileSize,
  assertHeadroom,
  assertPageCount,
  assertPageSize,
  assertRenderSize,
  type Budget,
} from '../../core/limits';
import { DebouncedPersistence, OpfsSnapshotStore } from '../../persistence/opfs';
import type { EngineTypes } from '../port';
import workerRuntime, { withArenaSync, type Arena } from './arena';
import annotationMutations from './mutations/annotations';
import formMutations from './mutations/forms';
import metadataMutations from './mutations/metadata';
import pageMutations from './mutations/pages';
import redactionMutations from './mutations/redaction';
import { journalHistory, journalOperation, journalState } from './mutations/transaction';
import {
  DocumentSizeAccounting,
  JAVASCRIPT_CONTEXT_MEMORY_LIMIT,
  javaScriptContextProjection,
} from './resource-accounting';
import { persistenceSnapshot, saveDocument, snapshotDocument } from './save';

type AnnotationInfo = EngineTypes['AnnotationInfo'];
type AttachmentInfo = EngineTypes['AttachmentInfo'];
type DocumentInfo = EngineTypes['DocumentInfo'];
type EngineRequest = EngineTypes['EngineRequest'];
type ExportedPdf = EngineTypes['ExportedPdf'];
type MutationResult = EngineTypes['MutationResult'];
type OutlineNode = EngineTypes['OutlineNode'];
type OutputState = EngineTypes['OutputState'];
type PageInfo = EngineTypes['PageInfo'];
type PdfQuad = EngineTypes['PdfQuad'];
type TextSelection = EngineTypes['TextSelection'];
type TileResult = EngineTypes['TileResult'];

const { postEvent, postFailure, postSuccess, releaseRetained, retain, retained, withArena } =
  workerRuntime;
const scope = self as unknown as Parameters<typeof postSuccess>[0];
const DOCUMENT_KEY = 'document:active';
const MAX_SELECTION_QUADS = 4_096;
const MAX_JAVASCRIPT_EVENTS = 200;
const MAX_JAVASCRIPT_EVENT_DETAIL = 4_096;
const cancelled = new Set<number>();
const javaScriptEvents: EngineTypes['JavaScriptEvent'][] = [];
let activeJavaScriptEvents: EngineTypes['JavaScriptEvent'][] | null = null;

let documentName = '';
let iosBudget = false;
const documentSize = new DocumentSizeAccounting();
let journalRevision = 0;
let persistence: DebouncedPersistence | null = null;
let persistenceAvailability: EngineTypes['EngineEvent'] = {
  event: 'persistence-status',
  available: false,
  reason: 'No document is open.',
};

function activeDocument(): mupdf.Document {
  return retained<mupdf.Document>(DOCUMENT_KEY);
}

function asPdfDocument(): mupdf.PDFDocument | null {
  const document = activeDocument();
  return document instanceof mupdf.PDFDocument ? document : null;
}

function requirePdfDocument(): mupdf.PDFDocument {
  const document = asPdfDocument();
  if (!document) throw new Error('This operation requires a PDF document.');
  return document;
}

function activeBudget(): Budget {
  return iosBudget ? IOS_BUDGET : DESKTOP_BUDGET;
}

function assertMutationCost(projectedBytes: number): void {
  assertHeadroom(documentSize.bytes * 2, projectedBytes, activeBudget());
}

function assertOutputCost(): void {
  assertHeadroom(documentSize.bytes, Math.ceil(documentSize.bytes * 1.25), activeBudget());
}

function assertSecondDocumentCost(byteLength: number): void {
  assertHeadroom(documentSize.bytes * 2, byteLength * 2, activeBudget());
}

function projectedJavaScriptMutationBytes(
  document: mupdf.PDFDocument,
  scope: 'document' | 'field',
): number {
  return javaScriptContextProjection(formMutations.countJavaScriptActions(document, scope) > 0);
}

function recordJavaScriptEvent(event: mupdf.PDFJSEvent): void {
  let recorded: EngineTypes['JavaScriptEvent'];
  const bounded = (value: string): string =>
    value.length <= MAX_JAVASCRIPT_EVENT_DETAIL
      ? value
      : `${value.slice(0, MAX_JAVASCRIPT_EVENT_DETAIL - 3)}...`;
  if (event.type === 'alert') {
    recorded = {
      type: event.type,
      detail: bounded(`${event.title}: ${event.message}`),
      blocked: true,
    };
  } else if (event.type === 'launch-url') {
    recorded = {
      type: event.type,
      detail: bounded(`${event.url} was requested and not opened.`),
      blocked: true,
    };
  } else if (event.type === 'mail-doc') {
    recorded = {
      type: event.type,
      detail: bounded(
        `Email to ${event.to || '(unspecified recipient)'} was requested and not sent.`,
      ),
      blocked: true,
    };
  } else if (event.type === 'exec-menu-item') {
    recorded = {
      type: event.type,
      detail: bounded(`Menu command "${event.item}" was requested and not run.`),
      blocked: true,
    };
  } else if (event.type === 'console') {
    recorded = {
      type: event.type,
      detail: bounded(event.action === 'write' ? event.message : `Console ${event.action}.`),
      blocked: false,
    };
  } else {
    recorded = {
      type: event.type,
      detail:
        event.type === 'print'
          ? 'Print was requested and not started.'
          : 'Form submission was requested and not sent.',
      blocked: true,
    };
  }
  javaScriptEvents.push(recorded);
  if (javaScriptEvents.length > MAX_JAVASCRIPT_EVENTS) {
    javaScriptEvents.splice(0, javaScriptEvents.length - MAX_JAVASCRIPT_EVENTS);
  }
  if (activeJavaScriptEvents) {
    activeJavaScriptEvents.push(recorded);
    if (activeJavaScriptEvents.length > MAX_JAVASCRIPT_EVENTS) {
      activeJavaScriptEvents.splice(0, activeJavaScriptEvents.length - MAX_JAVASCRIPT_EVENTS);
    }
  }
}

function pageInfo(
  index: number,
  page: mupdf.Page,
  ios: boolean,
  assertLimits = true,
): PageInfo {
  const bounds = page.getBounds();
  const width = Math.max(0, bounds[2] - bounds[0]);
  const height = Math.max(0, bounds[3] - bounds[1]);
  if (assertLimits) assertPageSize(width, height, ios ? IOS_BUDGET : DESKTOP_BUDGET);
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

function outline(): OutlineNode[] {
  return withArenaSync((arena) => {
    const iterator = arena.keep(activeDocument().outlineIterator());
    return readOutlineLevel(iterator);
  });
}

function attachments(): AttachmentInfo[] {
  const document = asPdfDocument();
  if (!document) return [];
  return withArenaSync((arena) =>
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

function documentInfo(assertLimits = true): DocumentInfo {
  const document = activeDocument();
  const count = document.countPages();
  if (assertLimits) assertPageCount(count, activeBudget());
  const pages = Array.from({ length: count }, (_, index) =>
    withArenaSync((arena) =>
      pageInfo(index, arena.keep(document.loadPage(index)), iosBudget, assertLimits),
    ),
  );
  return {
    name: documentName,
    title: document.getMetaData(mupdf.Document.META_INFO_TITLE) || documentName,
    pages,
    outline: outline(),
    attachments: attachments(),
    permissions: {
      copy: document.hasPermission(mupdf.Document.PERMISSION_COPY),
      print: document.hasPermission(mupdf.Document.PERMISSION_PRINT),
      annotate: document.hasPermission(mupdf.Document.PERMISSION_ANNOTATE),
    },
  };
}

async function configurePersistence(key: string): Promise<void> {
  const result = await OpfsSnapshotStore.open(key);
  persistenceAvailability = {
    event: 'persistence-status',
    ...result.availability,
  };
  postEvent(scope, persistenceAvailability);
  if (!('store' in result)) {
    persistence = null;
    return;
  }
  persistence = new DebouncedPersistence(result.store, (error) => {
    const message =
      error instanceof Error ? error.message : 'Crash recovery could not be saved.';
    postEvent(scope, { event: 'persistence-error', message });
  });
}

function schedulePersistence(): void {
  persistence?.schedule(async () => persistenceSnapshot(requirePdfDocument()));
}

function refreshSourceByteLength(document: mupdf.PDFDocument): void {
  documentSize.refresh(document);
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
    documentName = payload.name;
    iosBudget = payload.ios;
    documentSize.reset(payload.data.byteLength);
    journalRevision = 0;
    javaScriptEvents.length = 0;
    let openedWithJavaScriptMutation = false;
    let openedJavaScriptBytes = 0;
    if (document instanceof mupdf.PDFDocument) {
      document.setJSEventListener(recordJavaScriptEvent);
      document.enableJournal();
      const projectedBytes = projectedJavaScriptMutationBytes(document, 'document');
      if (projectedBytes > 0) assertMutationCost(projectedBytes);
      const before = document.getJournal();
      document.beginOperation('Run document JavaScript');
      try {
        document.enableJS();
        document.endOperation();
      } catch (error) {
        document.abandonOperation();
        throw error;
      }
      if (!document.isJSSupported()) {
        throw new Error('This engine build does not provide PDF JavaScript.');
      }
      const after = document.getJournal();
      openedWithJavaScriptMutation =
        after.position !== before.position || after.steps.length !== before.steps.length;
      if (openedWithJavaScriptMutation) {
        journalRevision = 1;
      }
      openedJavaScriptBytes = projectedBytes;
    }
    const info = documentInfo();
    await configurePersistence(
      payload.persistenceKey ?? `document-${payload.name}-${payload.data.byteLength}`,
    );
    if (openedJavaScriptBytes > 0 && document instanceof mupdf.PDFDocument) {
      refreshSourceByteLength(document);
    }
    if (openedWithJavaScriptMutation) {
      schedulePersistence();
    }
    return info;
  } catch (error) {
    releaseRetained();
    throw error;
  }
}

async function renderTile(
  request: Extract<EngineRequest, { operation: 'renderTile' }>['payload'],
): Promise<TileResult> {
  assertRenderSize(request.width, request.height, activeBudget());
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

function pageText(pageIndex: number) {
  return withArenaSync((arena) => {
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

function selectText(
  payload: Extract<EngineRequest, { operation: 'selectText' }>['payload'],
): TextSelection {
  return withArenaSync((arena) => {
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

function readAttachment(id: string): ArrayBuffer {
  const document = requirePdfDocument();
  return withArenaSync((arena) => {
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

function mutationResult<T extends AnnotationInfo | undefined>(
  name: string,
  projectedBytes: number,
  mutate: (arena: Arena, document: mupdf.PDFDocument) => T,
): MutationResult {
  const document = requirePdfDocument();
  const completed = journalOperation(
    document,
    name,
    () => assertMutationCost(projectedBytes),
    (arena) => {
      const annotation = mutate(arena, document);
      const info = documentInfo(false);
      return annotation ? { info, annotation } : { info };
    },
  );
  refreshSourceByteLength(document);
  schedulePersistence();
  journalRevision += 1;
  return completed.annotation
    ? {
        document: completed.info,
        journal: journalState(document, journalRevision),
        annotation: completed.annotation,
      }
    : {
        document: completed.info,
        journal: journalState(document, journalRevision),
      };
}

function outputState(): OutputState {
  const document = requirePdfDocument();
  return {
    unappliedRedactions: redactionMutations.countUnappliedRedactions(document),
    signatures: redactionMutations.signatureCount(document),
    canPersist:
      persistenceAvailability.event === 'persistence-status' &&
      persistenceAvailability.available,
    ...(persistenceAvailability.event === 'persistence-status' &&
    persistenceAvailability.reason !== undefined
      ? { persistenceReason: persistenceAvailability.reason }
      : {}),
  };
}

function javaScriptState(): EngineTypes['JavaScriptState'] {
  const document = requirePdfDocument();
  return {
    enabled: document.isJSSupported(),
    scripts: formMutations.listJavaScriptActions(document),
    events: [...javaScriptEvents],
  };
}

function executeJavaScript(source: string): EngineTypes['JavaScriptExecutionResult'] {
  const document = requirePdfDocument();
  const trimmed = source.trim();
  if (!trimmed) throw new Error('Enter JavaScript source before running the console.');
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  const documentScriptBytes = projectedJavaScriptMutationBytes(document, 'document');
  const projectedBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    documentSize.bytes * 2 +
      sourceBytes * 4 +
      documentScriptBytes +
      JAVASCRIPT_CONTEXT_MEMORY_LIMIT,
  );
  assertHeadroom(documentSize.bytes * 2, projectedBytes, activeBudget());
  const snapshot = snapshotDocument(document);
  const executionEvents: EngineTypes['JavaScriptEvent'][] = [];
  activeJavaScriptEvents = executionEvents;
  let result: string;
  try {
    result = withArenaSync((arena) => {
      const evaluationDocument = arena.keep(
        mupdf.Document.openDocument(snapshot, 'application/pdf'),
      );
      if (!(evaluationDocument instanceof mupdf.PDFDocument)) {
        throw new Error('The JavaScript evaluation snapshot is not a PDF document.');
      }
      evaluationDocument.setJSEventListener(recordJavaScriptEvent);
      formMutations.disableDocumentScriptsForEvaluation(evaluationDocument);
      evaluationDocument.enableJS();
      return evaluationDocument.executeJS(source, 'Papertrail console');
    });
  } finally {
    activeJavaScriptEvents = null;
  }
  return {
    result,
    events: executionEvents,
    document: documentInfo(),
    journal: journalState(document, journalRevision),
  };
}

function mutateHistory(direction: 'undo' | 'redo'): MutationResult {
  const document = requirePdfDocument();
  if (direction === 'undo' ? !document.canUndo() : !document.canRedo()) {
    throw new Error(`There is nothing to ${direction}.`);
  }
  // Undo and redo only enter states previously admitted by the pre-mutation gates. Re-running
  // throwing ceiling assertions here can trap the user by compensating every attempted undo.
  const info = journalHistory(document, direction, () => documentInfo(false));
  refreshSourceByteLength(document);
  journalRevision += 1;
  schedulePersistence();
  return { document: info, journal: journalState(document, journalRevision) };
}

function saveForOutput(options: EngineTypes['SaveOptions']): ArrayBuffer {
  const document = requirePdfDocument();
  // Shipped callers use garbage collection so removed content cannot survive as unreachable
  // objects. SaveOptions still permits `none`; keep that boundary explicit if callers expand.

  assertNoUnappliedRedactions(document);
  assertOutputCost();
  return saveDocument(document, options);
}

function assertNoUnappliedRedactions(document: mupdf.PDFDocument): void {
  const marks = redactionMutations.countUnappliedRedactions(document);
  if (marks > 0) {
    throw new Error(
      `${marks} unapplied redaction ${marks === 1 ? 'mark blocks' : 'marks block'} Save, Export, and Print. Remove the marks or use a supported content-removal command.`,
    );
  }
}

function inspectIncomingPages(data: ArrayBuffer, sourcePages?: readonly number[]): number {
  assertSecondDocumentCost(data.byteLength);
  return withArenaSync((arena) => {
    const source = arena.keep(
      mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf'),
    );
    if (!(source instanceof mupdf.PDFDocument)) {
      throw new Error('The selected merge source is not a PDF document.');
    }
    const count = source.countPages();
    const pages = sourcePages ?? Array.from({ length: count }, (_, index) => index);
    for (const pageIndex of pages) {
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= count) {
        throw new Error('One or more selected pages are outside the incoming document.');
      }
      const page = arena.keep(source.loadPage(pageIndex));
      const bounds = page.getBounds();
      assertPageSize(bounds[2] - bounds[0], bounds[3] - bounds[1], activeBudget());
    }
    return count;
  });
}

function inspectIncomingDocument(
  name: string,
  data: ArrayBuffer,
): EngineTypes['IncomingDocumentInfo'] {
  assertFileSize(data.byteLength, activeBudget());
  assertSecondDocumentCost(data.byteLength);
  return withArenaSync((arena) => {
    const source = arena.keep(
      mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf'),
    );
    if (!(source instanceof mupdf.PDFDocument)) {
      throw new Error('The selected source is not a PDF document.');
    }
    const pageCount = source.countPages();
    assertPageCount(pageCount, activeBudget());
    return {
      name,
      pageCount,
      pages: Array.from({ length: pageCount }, (_, index) => {
        const page = arena.keep(source.loadPage(index));
        return { index, label: page.getLabel() || String(index + 1) };
      }),
    };
  });
}

function pageComparison(
  current: mupdf.PDFDocument | null,
  incoming: mupdf.PDFDocument,
  pageIndex: number,
): EngineTypes['CompareResult']['pages'][number] {
  if (!current) {
    return withArenaSync((arena) => {
      const page = arena.keep(incoming.loadPage(pageIndex));
      const structuredText = arena.keep(page.toStructuredText());
      const text = structuredText.asText();
      return {
        pageIndex,
        status: 'added',
        incomingLabel: page.getLabel() || String(pageIndex + 1),
        currentCharacters: 0,
        incomingCharacters: text.length,
        dimensionsChanged: true,
        rasterReviewRecommended: !text.trim(),
      };
    });
  }
  return withArenaSync((arena) => {
    const currentPage = arena.keep(current.loadPage(pageIndex));
    const incomingPage = arena.keep(incoming.loadPage(pageIndex));
    const currentStructuredText = arena.keep(currentPage.toStructuredText());
    const incomingStructuredText = arena.keep(incomingPage.toStructuredText());
    const currentText = currentStructuredText.asText();
    const incomingText = incomingStructuredText.asText();
    const currentBounds = currentPage.getBounds();
    const incomingBounds = incomingPage.getBounds();
    const dimensionsChanged = currentBounds.some(
      (value, index) => Math.abs(value - (incomingBounds[index] ?? value)) > 0.001,
    );
    return {
      pageIndex,
      status:
        currentText === incomingText && !dimensionsChanged
          ? ('same' as const)
          : ('changed' as const),
      currentLabel: currentPage.getLabel() || String(pageIndex + 1),
      incomingLabel: incomingPage.getLabel() || String(pageIndex + 1),
      currentCharacters: currentText.length,
      incomingCharacters: incomingText.length,
      dimensionsChanged,
      rasterReviewRecommended: !currentText.trim() || !incomingText.trim(),
    };
  });
}

function compareDocument(name: string, data: ArrayBuffer): EngineTypes['CompareResult'] {
  assertFileSize(data.byteLength, activeBudget());
  assertSecondDocumentCost(data.byteLength);
  const current = requirePdfDocument();
  return withArenaSync((arena) => {
    const incomingDocument = arena.keep(
      mupdf.Document.openDocument(new Uint8Array(data), 'application/pdf'),
    );
    if (!(incomingDocument instanceof mupdf.PDFDocument)) {
      throw new Error('The selected comparison source is not a PDF document.');
    }
    assertPageCount(incomingDocument.countPages(), activeBudget());
    const overlap = Math.min(current.countPages(), incomingDocument.countPages());
    const pages: EngineTypes['CompareResult']['pages'][number][] = [];
    for (let pageIndex = 0; pageIndex < overlap; pageIndex += 1) {
      pages.push(pageComparison(current, incomingDocument, pageIndex));
    }
    for (let pageIndex = overlap; pageIndex < incomingDocument.countPages(); pageIndex += 1) {
      pages.push(pageComparison(null, incomingDocument, pageIndex));
    }
    for (let pageIndex = overlap; pageIndex < current.countPages(); pageIndex += 1) {
      const removed = withArenaSync((arena) => {
        const page = arena.keep(current.loadPage(pageIndex));
        const structuredText = arena.keep(page.toStructuredText());
        const text = structuredText.asText();
        return {
          pageIndex,
          status: 'removed' as const,
          currentLabel: page.getLabel() || String(pageIndex + 1),
          currentCharacters: text.length,
          incomingCharacters: 0,
          dimensionsChanged: true,
          rasterReviewRecommended: !text.trim(),
        };
      });
      pages.push(removed);
    }
    return {
      incomingName: name,
      same: pages.filter((page) => page.status === 'same').length,
      changed: pages.filter((page) => page.status === 'changed').length,
      added: pages.filter((page) => page.status === 'added').length,
      removed: pages.filter((page) => page.status === 'removed').length,
      pages,
    };
  });
}

function validatePdfA(): EngineTypes['PdfAReport'] {
  const document = requirePdfDocument();
  return withArenaSync((arena) => {
    const trailer = arena.keep(document.getTrailer());
    const root = arena.keep(trailer.get('Root'));
    const metadata = arena.keep(root.get('Metadata'));
    let xmp = '';
    if (metadata.isStream()) {
      const contents = arena.keep(metadata.readStream());
      xmp = new TextDecoder().decode(contents.asUint8Array());
    }
    const part = /pdfaid:part\s*=\s*["'](\d+)["']/i.exec(xmp)?.[1];
    const conformance = /pdfaid:conformance\s*=\s*["']([A-Z])["']/i.exec(xmp)?.[1];
    const profile =
      part && conformance ? `PDF/A-${part}${conformance.toLocaleLowerCase()}` : null;
    const outputIntents = arena.keep(root.get('OutputIntents'));
    const encryption = arena.keep(trailer.get('Encrypt'));
    const javaScript = arena.keep(root.get('Names', 'JavaScript'));
    const openAction = arena.keep(root.get('OpenAction'));
    const embeddedFiles = arena.keep(root.get('Names', 'EmbeddedFiles'));
    let fontsEmbedded = true;
    let fontCount = 0;
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const pageResult = withArenaSync((arena) => {
        const page = arena.keep(document.loadPage(pageIndex));
        const trace = arena.keep(page.processContents());
        const fonts = trace
          .getRecords()
          .map((record) => record.font)
          .filter((font): font is mupdf.PDFFontDescriptor => font !== undefined);
        return {
          count: fonts.length,
          embedded: fonts.every((font) => font.isEmbedded()),
        };
      });
      fontCount += pageResult.count;
      fontsEmbedded &&= pageResult.embedded;
    }
    const checks: EngineTypes['PdfAReport']['checks'] = [
      {
        id: 'metadata',
        label: 'PDF/A identification metadata',
        passed: profile !== null,
        detail: profile
          ? `Declares ${profile}.`
          : 'No pdfaid part and conformance declaration.',
      },
      {
        id: 'output-intent',
        label: 'Output intent',
        passed: outputIntents.isArray() && outputIntents.length > 0,
        detail:
          outputIntents.isArray() && outputIntents.length > 0
            ? `${outputIntents.length} output intent found.`
            : 'No output intent is declared.',
      },
      {
        id: 'fonts',
        label: 'Embedded fonts',
        passed: fontsEmbedded,
        detail:
          fontCount === 0
            ? 'No text fonts were used.'
            : fontsEmbedded
              ? `${fontCount} font uses are embedded.`
              : 'At least one used font is not embedded.',
      },
      {
        id: 'encryption',
        label: 'No encryption',
        passed: encryption.isNull(),
        detail: encryption.isNull()
          ? 'The file is not encrypted.'
          : 'PDF/A forbids encryption.',
      },
      {
        id: 'scripts',
        label: 'No document scripts',
        passed: javaScript.isNull() && openAction.isNull(),
        detail:
          javaScript.isNull() && openAction.isNull()
            ? 'No JavaScript name tree or open action was found.'
            : 'Document actions must be removed for PDF/A.',
      },
      {
        id: 'attachments',
        label: 'Attachment profile compatibility',
        passed: embeddedFiles.isNull() || part === '3',
        detail: embeddedFiles.isNull()
          ? 'No embedded files were found.'
          : part === '3'
            ? 'Attachments are permitted by the declared PDF/A-3 profile.'
            : 'Embedded files require a compatible PDF/A-3 profile.',
      },
    ];
    return {
      profile,
      valid: checks.every((check) => check.passed),
      checks,
    };
  });
}

scope.addEventListener('message', (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  if (request.operation === 'cancel') {
    cancelled.add(request.payload.requestId);
    return;
  }

  void (async () => {
    try {
      if (request.operation === 'open') {
        postSuccess(scope, request.id, await openDocument(request.payload));
      } else if (request.operation === 'getDocumentInfo') {
        postSuccess(scope, request.id, documentInfo());
      } else if (request.operation === 'snapshotForSearch') {
        assertOutputCost();
        const data = saveDocument(requirePdfDocument(), {
          mode: 'full',
          garbage: 'none',
          compress: true,
          encrypt: 'keep',
        });
        postSuccess(scope, request.id, data, [data]);
      } else if (request.operation === 'renderTile') {
        const result = await renderTile(request.payload);
        if (!cancelled.delete(request.id)) {
          postSuccess(scope, request.id, result, [result.pixels]);
        }
      } else if (request.operation === 'getPageText') {
        postSuccess(scope, request.id, pageText(request.payload.pageIndex));
      } else if (request.operation === 'selectText') {
        postSuccess(scope, request.id, selectText(request.payload));
      } else if (request.operation === 'getOutline') {
        postSuccess(scope, request.id, outline());
      } else if (request.operation === 'getAttachments') {
        postSuccess(scope, request.id, attachments());
      } else if (request.operation === 'readAttachment') {
        const data = readAttachment(request.payload.id);
        postSuccess(scope, request.id, data, [data]);
      } else if (request.operation === 'listAnnotations') {
        postSuccess(
          scope,
          request.id,
          annotationMutations.listAnnotations(requirePdfDocument(), request.payload.pageIndex),
        );
      } else if (request.operation === 'addAnnotation') {
        const result = mutationResult(
          `Add ${request.payload.type} annotation`,
          annotationMutations.projectedAnnotationBytes(request.payload),
          (arena, document) =>
            annotationMutations.addAnnotation(arena, document, request.payload),
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'addAnnotations') {
        if (request.payload.inputs.length === 0) {
          throw new Error('The imported comment file has no supported comments.');
        }
        const projectedBytes = request.payload.inputs.reduce(
          (total, input) => total + annotationMutations.projectedAnnotationBytes(input),
          0,
        );
        const result = mutationResult(
          `Import ${request.payload.inputs.length} comments`,
          projectedBytes,
          (arena, document) => {
            const created = new Map<
              string,
              { readonly pageIndex: number; readonly annotationId: number }
            >();
            for (const input of request.payload.inputs) {
              const replyTo = input.replyToClientId
                ? created.get(input.replyToClientId)
                : input.replyTo;
              if (input.replyToClientId && !replyTo) {
                throw new Error(
                  `Imported reply "${input.clientId ?? 'unknown'}" refers to a missing parent.`,
                );
              }
              const annotation = annotationMutations.addAnnotation(arena, document, {
                ...input,
                ...(replyTo ? { replyTo } : {}),
              });
              if (input.clientId) {
                created.set(input.clientId, {
                  pageIndex: annotation.pageIndex,
                  annotationId: annotation.id,
                });
              }
            }
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'updateAnnotation') {
        const result = mutationResult(
          'Update annotation',
          annotationMutations.projectedAnnotationBytes(request.payload.changes),
          (arena, document) =>
            annotationMutations.updateAnnotation(
              arena,
              document,
              request.payload.pageIndex,
              request.payload.annotationId,
              request.payload.changes,
            ),
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'deleteAnnotation') {
        const result = mutationResult('Delete annotation', 4_096, (arena, document) => {
          annotationMutations.deleteAnnotation(
            arena,
            document,
            request.payload.pageIndex,
            request.payload.annotationId,
          );
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'reorderPages') {
        const result = mutationResult('Reorder pages', 8_192, (_arena, document) => {
          pageMutations.reorderPages(document, request.payload.order);
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'rotatePages') {
        const result = mutationResult('Rotate pages', 4_096, (arena, document) => {
          pageMutations.rotatePages(
            arena,
            document,
            request.payload.pageIndices,
            request.payload.degrees,
          );
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'insertBlankPage') {
        assertPageCount(requirePdfDocument().countPages() + 1, activeBudget());
        const size = request.payload.size ?? ([0, 0, 612, 792] as const);
        assertPageSize(size[2] - size[0], size[3] - size[1], activeBudget());
        const result = mutationResult('Insert blank page', 32_768, (arena, document) => {
          pageMutations.insertBlankPage(arena, document, request.payload.at, size);
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'deletePages') {
        const result = mutationResult('Delete pages', 8_192, (_arena, document) => {
          pageMutations.deletePages(document, request.payload.pageIndices);
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'setPageBoxes') {
        const rect = request.payload.rect;
        assertPageSize(rect[2] - rect[0], rect[3] - rect[1], activeBudget());
        const result = mutationResult('Set page boxes', 8_192, (arena, document) => {
          pageMutations.setPageBoxes(
            arena,
            document,
            request.payload.pageIndices,
            request.payload.box,
            rect,
          );
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'setPageLabels') {
        const result = mutationResult('Set page labels', 8_192, (_arena, document) => {
          pageMutations.setPageLabels(
            document,
            request.payload.at,
            request.payload.style,
            request.payload.prefix,
            request.payload.start,
          );
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'extractPages') {
        assertNoUnappliedRedactions(requirePdfDocument());
        assertOutputCost();
        const document = requirePdfDocument();
        if (request.payload.deleteOriginals) {
          const completed = journalOperation(
            document,
            'Extract and delete pages',
            () => assertMutationCost(documentSize.bytes),
            (arena) => {
              const data = pageMutations.extractPages(
                arena,
                document,
                request.payload.pageIndices,
              );
              pageMutations.deletePages(document, request.payload.pageIndices);
              return { data, info: documentInfo(false) };
            },
          );
          refreshSourceByteLength(document);
          journalRevision += 1;
          schedulePersistence();
          const exported: ExportedPdf = {
            name: `${documentName.replace(/\.pdf$/i, '')}-pages.pdf`,
            data: completed.data,
          };
          postSuccess(scope, request.id, exported, [exported.data]);
        } else {
          const data = withArenaSync((arena) =>
            pageMutations.extractPages(arena, document, request.payload.pageIndices),
          );
          const exported: ExportedPdf = {
            name: `${documentName.replace(/\.pdf$/i, '')}-pages.pdf`,
            data,
          };
          postSuccess(scope, request.id, exported, [data]);
        }
      } else if (request.operation === 'mergeDocument') {
        assertFileSize(request.payload.data.byteLength, activeBudget());
        const incomingCount = inspectIncomingPages(
          request.payload.data,
          request.payload.sourcePages,
        );
        const selectedCount = request.payload.sourcePages?.length ?? incomingCount;
        assertPageCount(requirePdfDocument().countPages() + selectedCount, activeBudget());
        const result = mutationResult(
          `Merge ${request.payload.name}`,
          request.payload.data.byteLength * 2,
          (arena, document) => {
            pageMutations.mergeDocument(
              arena,
              document,
              request.payload.data,
              request.payload.insertAt,
              request.payload.sourcePages,
            );
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'inspectIncomingDocument') {
        postSuccess(
          scope,
          request.id,
          inspectIncomingDocument(request.payload.name, request.payload.data),
        );
      } else if (request.operation === 'compareDocument') {
        postSuccess(
          scope,
          request.id,
          compareDocument(request.payload.name, request.payload.data),
        );
      } else if (request.operation === 'validatePdfA') {
        postSuccess(scope, request.id, validatePdfA());
      } else if (request.operation === 'composePages') {
        if (request.payload.data) {
          assertFileSize(request.payload.data.byteLength, activeBudget());
          inspectIncomingPages(
            request.payload.data,
            request.payload.order
              .filter((item) => item.source === 'incoming')
              .map((item) => item.pageIndex),
          );
        }
        assertPageCount(request.payload.order.length, activeBudget());
        const projectedBytes = request.payload.data?.byteLength ?? documentSize.bytes;
        const result = mutationResult(
          request.payload.name,
          projectedBytes * 2,
          (arena, document) => {
            pageMutations.composePages(
              arena,
              document,
              request.payload.data,
              request.payload.order,
            );
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'splitDocument') {
        assertNoUnappliedRedactions(requirePdfDocument());
        assertOutputCost();
        const outputs = pageMutations.splitDocument(
          requirePdfDocument(),
          request.payload.ranges,
        );
        postSuccess(
          scope,
          request.id,
          outputs,
          outputs.map((output) => output.data),
        );
      } else if (request.operation === 'listFields') {
        postSuccess(scope, request.id, formMutations.listFields(requirePdfDocument()));
      } else if (request.operation === 'setFieldValue') {
        const document = requirePdfDocument();
        const result = mutationResult(
          `Fill ${request.payload.name}`,
          Math.min(
            Number.MAX_SAFE_INTEGER,
            formMutations.projectedFieldValueBytes(
              request.payload.name,
              request.payload.value,
            ) + projectedJavaScriptMutationBytes(document, 'field'),
          ),
          (arena, document) => {
            formMutations.setFieldValue(
              arena,
              document,
              request.payload.name,
              request.payload.value,
            );
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'setFieldValues') {
        const entries = Object.entries(request.payload.values);
        const projectedBytes = entries.reduce(
          (total, [name, value]) => total + formMutations.projectedFieldValueBytes(name, value),
          0,
        );
        const scriptBytes = projectedJavaScriptMutationBytes(requirePdfDocument(), 'field');
        const result = mutationResult(
          'Import form data',
          Math.min(Number.MAX_SAFE_INTEGER, projectedBytes + scriptBytes),
          (arena, document) => {
            formMutations.setFieldValues(arena, document, request.payload.values);
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'createFormField') {
        const result = mutationResult(
          `Create ${request.payload.type} field`,
          formMutations.projectedFormFieldBytes(request.payload),
          (arena, document) => {
            formMutations.createFormField(arena, document, request.payload);
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'updateFormField') {
        const result = mutationResult(
          `Update ${request.payload.name}`,
          8_192,
          (arena, document) => {
            formMutations.updateFormField(
              arena,
              document,
              request.payload.name,
              request.payload.changes,
            );
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'updateFormFields') {
        const result = mutationResult('Arrange form fields', 16_384, (arena, document) => {
          formMutations.updateFormFields(arena, document, request.payload.updates);
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'reorderFormFields') {
        const result = mutationResult('Set form tab order', 16_384, (arena, document) => {
          formMutations.reorderFormFields(arena, document, request.payload.names);
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'resetForm') {
        const result = mutationResult(
          'Reset form',
          Math.min(
            Number.MAX_SAFE_INTEGER,
            16_384 + projectedJavaScriptMutationBytes(requirePdfDocument(), 'field'),
          ),
          (arena, document) => {
            formMutations.resetForm(arena, document);
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'getJavaScriptState') {
        postSuccess(scope, request.id, javaScriptState());
      } else if (request.operation === 'setJavaScriptAction') {
        const result = mutationResult(
          `Set ${request.payload.scope} JavaScript`,
          formMutations.projectedJavaScriptBytes(request.payload),
          (arena, document) => {
            formMutations.setJavaScriptAction(arena, document, request.payload);
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'deleteJavaScriptAction') {
        const result = mutationResult('Remove JavaScript action', 8_192, (arena, document) => {
          formMutations.deleteJavaScriptAction(arena, document, request.payload);
          return undefined;
        });
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'executeJavaScript') {
        postSuccess(scope, request.id, executeJavaScript(request.payload.source));
      } else if (request.operation === 'updateMetadata') {
        const result = mutationResult(
          'Update document properties',
          metadataMutations.projectedMetadataBytes(request.payload.values),
          (_arena, document) => {
            metadataMutations.updateMetadata(document, request.payload.values);
            return undefined;
          },
        );
        postSuccess(scope, request.id, result);
      } else if (request.operation === 'save' || request.operation === 'exportPdf') {
        const data = saveForOutput(request.payload);
        postSuccess(scope, request.id, data, [data]);
      } else if (request.operation === 'redactPages') {
        const document = requirePdfDocument();
        const signatures = redactionMutations.signatureCount(document);
        const completed = journalOperation(
          document,
          'Remove pages wholesale',
          assertOutputCost,
          () => {
            const report = redactionMutations.redactPages(
              document,
              request.payload.pageIndices,
              signatures,
              request.payload.confirmSignatureInvalidation,
            );
            return { report, info: documentInfo(false) };
          },
        );
        refreshSourceByteLength(document);
        const result: EngineTypes['SanitizeReport'] = {
          ...completed.report,
          document: completed.info,
          journal: journalState(document, ++journalRevision),
        };
        schedulePersistence();
        postSuccess(scope, request.id, result, [result.data]);
      } else if (request.operation === 'sanitize') {
        const document = requirePdfDocument();
        assertNoUnappliedRedactions(document);
        const preflight = redactionMutations.inspectSanitize(document);
        const completed = journalOperation(
          document,
          'Sanitize document',
          assertOutputCost,
          (arena) => {
            const report = redactionMutations.sanitize(
              arena,
              document,
              preflight,
              request.payload.confirmSignatureInvalidation,
            );
            return { report, info: documentInfo(false) };
          },
        );
        refreshSourceByteLength(document);
        const result: EngineTypes['SanitizeReport'] = {
          ...completed.report,
          document: completed.info,
          journal: journalState(document, ++journalRevision),
        };
        schedulePersistence();
        postSuccess(scope, request.id, result, [result.data]);
      } else if (request.operation === 'undo' || request.operation === 'redo') {
        postSuccess(scope, request.id, mutateHistory(request.operation));
      } else if (request.operation === 'getJournal') {
        postSuccess(scope, request.id, journalState(requirePdfDocument(), journalRevision));
      } else if (request.operation === 'getOutputState') {
        postSuccess(scope, request.id, outputState());
      } else if (request.operation === 'close') {
        try {
          await persistence?.discard();
        } finally {
          persistence = null;
          releaseRetained();
        }
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
