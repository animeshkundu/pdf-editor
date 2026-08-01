import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import engineErrors, { type EngineTypes } from '@/lib/engine/port';
import renderLayout from '@/lib/render/layout';
import type { PageRotation } from '@/lib/render/layout';
import { useToolStore } from '@/lib/store/tools';
import { viewportStore } from '@/lib/store/viewport';
import type { SelectionAction } from './SelectionActionBar';

type PageInfo = EngineTypes['PageInfo'];
type PdfEngine = EngineTypes['PdfEngine'];
type PdfPoint = EngineTypes['PdfPoint'];
type PdfQuad = EngineTypes['PdfQuad'];
type SearchHit = EngineTypes['SearchHit'];
type TextSelection = EngineTypes['TextSelection'];
type TileRect = ReturnType<typeof renderLayout.viewportTileRects>[number];
const { WorkerCrashedError } = engineErrors;
const { PAGE_GAP, PDF_POINT_SCALE, PageLayout, viewportTileRects } = renderLayout;

interface DocumentViewportHandle {
  goToPage(pageIndex: number): void;
  zoomBy(factor: number): void;
  resetZoom(): void;
  fitWidth(): void;
  rotateView(degrees: 90 | -90): void;
  toggleSelectionMode(): void;
  focus(): void;
  showSearchHit(hit: SearchHit | null): void;
}

interface DocumentViewportProps {
  readonly engine: PdfEngine;
  readonly currentPageRef: RefObject<HTMLOutputElement | null>;
  readonly zoomRef: RefObject<HTMLOutputElement | null>;
  readonly analysisStatusRef: RefObject<HTMLOutputElement | null>;
  readonly selectionModeRef: RefObject<HTMLButtonElement | null>;
  readonly onFind: () => void;
  readonly onSelectionAction: (action: SelectionAction | null) => void;
  readonly onMutation: (result: EngineTypes['MutationResult']) => void;
  readonly onError: (message: string) => void;
}

interface PageNode {
  readonly element: HTMLDivElement;
  readonly surface: HTMLDivElement;
  readonly controller: AbortController;
  readonly tiles: Map<
    string,
    {
      readonly canvas: HTMLCanvasElement;
      readonly overlay: HTMLCanvasElement;
      readonly tile: TileRect;
      readonly controller: AbortController;
    }
  >;
}

function surfaceTransform(rotation: PageRotation): string {
  if (rotation === 90) return 'rotate(90deg) translateY(-100%)';
  if (rotation === 180) return 'rotate(180deg) translate(-100%, -100%)';
  if (rotation === 270) return 'rotate(270deg) translateX(-100%)';
  return 'none';
}

function unrotatePoint(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: PageRotation,
): readonly [number, number] {
  if (rotation === 90) return [y, height - x];
  if (rotation === 180) return [width - x, height - y];
  if (rotation === 270) return [width - y, x];
  return [x, y];
}

function unrotatedViewport(
  left: number,
  top: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
  rotation: PageRotation,
): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const corners = [
    unrotatePoint(left, top, pageWidth, pageHeight, rotation),
    unrotatePoint(left + width, top, pageWidth, pageHeight, rotation),
    unrotatePoint(left, top + height, pageWidth, pageHeight, rotation),
    unrotatePoint(left + width, top + height, pageWidth, pageHeight, rotation),
  ];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const minX = Math.max(0, Math.min(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxX = Math.min(pageWidth, Math.max(...xs));
  const maxY = Math.min(pageHeight, Math.max(...ys));
  return {
    left: minX,
    top: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

interface HighlightState {
  readonly pageIndex: number;
  readonly quads: readonly PdfQuad[];
}

function quadBounds(quad: PdfQuad): readonly [number, number, number, number] {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function drawHighlight(
  context: CanvasRenderingContext2D,
  tile: TileRect,
  page: PageInfo,
  scale: number,
  quads: readonly PdfQuad[],
  fillStyle: string,
): void {
  context.fillStyle = fillStyle;
  for (const quad of quads) {
    const bounds = quadBounds(quad);
    const x = (bounds[0] - page.bounds[0]) * scale - tile.x;
    const y = (bounds[1] - page.bounds[1]) * scale - tile.y;
    const width = (bounds[2] - bounds[0]) * scale;
    const height = (bounds[3] - bounds[1]) * scale;
    if (x + width >= 0 && y + height >= 0 && x <= tile.width && y <= tile.height) {
      context.fillRect(x, y, width, height);
    }
  }
}

const DocumentViewport = forwardRef<DocumentViewportHandle, DocumentViewportProps>(
  function DocumentViewport(
    {
      engine,
      currentPageRef,
      zoomRef,
      analysisStatusRef,
      selectionModeRef,
      onFind,
      onSelectionAction,
      onMutation,
      onError,
    },
    ref,
  ) {
    const scrollerRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const readingRef = useRef<HTMLDivElement>(null);
    const analysisRef = useRef<HTMLParagraphElement>(null);
    const selectionStatusRef = useRef<HTMLParagraphElement>(null);
    const apiRef = useRef<DocumentViewportHandle | null>(null);
    const activeTool = useToolStore((state) => state.activeTool);
    const formFields = useToolStore((state) => state.formFields);
    const formFieldsHighlighted = useToolStore((state) => state.formFieldsHighlighted);
    const resetTool = useToolStore((state) => state.resetTool);

    useImperativeHandle(ref, () => ({
      goToPage(pageIndex) {
        apiRef.current?.goToPage(pageIndex);
      },
      zoomBy(factor) {
        apiRef.current?.zoomBy(factor);
      },
      resetZoom() {
        apiRef.current?.resetZoom();
      },
      fitWidth() {
        apiRef.current?.fitWidth();
      },
      rotateView(degrees) {
        apiRef.current?.rotateView(degrees);
      },
      toggleSelectionMode() {
        apiRef.current?.toggleSelectionMode();
      },
      focus() {
        apiRef.current?.focus();
      },
      showSearchHit(hit) {
        apiRef.current?.showSearchHit(hit);
      },
    }));

    useEffect(() => {
      const scroller = scrollerRef.current;
      const content = contentRef.current;
      const reading = readingRef.current;
      const analysis = analysisRef.current;
      const selectionStatus = selectionStatusRef.current;
      if (!scroller || !content || !reading || !analysis || !selectionStatus) return;

      const pageNodes = new Map<number, PageNode>();
      const widestPagePoints = engine.info.pages.reduce(
        (widest, page) => Math.max(widest, page.width),
        1,
      );
      const fitWidthZoom = () =>
        Math.min(
          1,
          Math.max(
            0.25,
            (scroller.clientWidth - PAGE_GAP * 2) / (widestPagePoints * PDF_POINT_SCALE),
          ),
        );
      let zoom = fitWidthZoom();
      let rotation: PageRotation = 0;
      let layout = new PageLayout(engine.info.pages, zoom, PAGE_GAP, rotation);
      let generation = 0;
      let frame = 0;
      let currentPage = -1;
      let selection: TextSelection | null = null;
      let searchHighlight: HighlightState | null = null;
      let dragStart: { readonly pageIndex: number; readonly point: PdfPoint } | null = null;
      let readingController: AbortController | null = null;
      let keyboardSelectionController: AbortController | null = null;
      let selectionMode = false;
      let currentPageText = '';
      let keyboardWordCount = 0;
      let selectionGeneration = 0;
      viewportStore.getState().reset();
      viewportStore.getState().setZoom(zoom);
      scroller.dataset.selectionMode = 'false';
      if (selectionModeRef.current) {
        selectionModeRef.current.textContent = 'Pan mode';
        selectionModeRef.current.setAttribute('aria-pressed', 'false');
      }

      const logicalScrollTop = () =>
        layout.logicalOffsetForScroll(scroller.scrollTop, scroller.clientHeight);

      const scrollToLogical = (top: number, behavior: ScrollBehavior = 'auto') => {
        scroller.scrollTo({
          top: layout.scrollOffsetForLogical(top, scroller.clientHeight),
          behavior,
        });
      };

      const positionPage = (pageIndex: number, node: PageNode, logicalTop: number) => {
        const placement = layout.placements[pageIndex];
        if (placement) {
          node.element.style.top = `${scroller.scrollTop + placement.top - logicalTop}px`;
        }
      };

      const reportError = (action: string, error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof WorkerCrashedError && error.code === 'engine_closed') return;
        const detail = error instanceof Error ? error.message : 'Unknown engine failure.';
        onError(`${action} failed. ${detail}`);
      };

      const paintOverlays = () => {
        const deviceScale = PDF_POINT_SCALE * zoom * window.devicePixelRatio;
        const selectionColor = getComputedStyle(scroller)
          .getPropertyValue('--selection-overlay')
          .trim();
        const searchColor = getComputedStyle(scroller)
          .getPropertyValue('--search-overlay')
          .trim();
        for (const [pageIndex, node] of pageNodes) {
          const page = engine.info.pages[pageIndex];
          if (!page) continue;
          for (const renderedTile of node.tiles.values()) {
            const context = renderedTile.overlay.getContext('2d');
            if (!context) continue;
            context.clearRect(0, 0, renderedTile.overlay.width, renderedTile.overlay.height);
            if (searchHighlight?.pageIndex === pageIndex) {
              drawHighlight(
                context,
                renderedTile.tile,
                page,
                deviceScale,
                searchHighlight.quads,
                searchColor,
              );
            }
            if (selection?.pageIndex === pageIndex) {
              drawHighlight(
                context,
                renderedTile.tile,
                page,
                deviceScale,
                selection.quads,
                selectionColor,
              );
            }
            if (formFieldsHighlighted) {
              context.fillStyle = searchColor;
              for (const field of formFields) {
                if (field.pageIndex !== pageIndex) continue;
                const x = (field.rect[0] - page.bounds[0]) * deviceScale - renderedTile.tile.x;
                const y = (field.rect[1] - page.bounds[1]) * deviceScale - renderedTile.tile.y;
                const width = (field.rect[2] - field.rect[0]) * deviceScale;
                const height = (field.rect[3] - field.rect[1]) * deviceScale;
                if (
                  x + width >= 0 &&
                  y + height >= 0 &&
                  x <= renderedTile.tile.width &&
                  y <= renderedTile.tile.height
                ) {
                  context.fillRect(x, y, width, height);
                }
              }
            }
          }
        }
      };

      const pointFromEvent = (event: PointerEvent, pageIndex: number): PdfPoint => {
        const node = pageNodes.get(pageIndex);
        const page = engine.info.pages[pageIndex];
        if (!node || !page) return [0, 0];
        const rect = node.element.getBoundingClientRect();
        const scale = PDF_POINT_SCALE * zoom;
        const [x, y] = unrotatePoint(
          event.clientX - rect.left,
          event.clientY - rect.top,
          page.width * scale,
          page.height * scale,
          rotation,
        );
        return [page.bounds[0] + x / scale, page.bounds[1] + y / scale];
      };

      const presentSelection = (
        result: TextSelection,
        pageIndex: number,
        element: HTMLDivElement,
      ) => {
        selection = result;
        if (result.truncated && analysisStatusRef.current) {
          analysisStatusRef.current.textContent =
            'DEGRADED · selection highlight limited to 4,096 regions';
          analysisStatusRef.current.dataset.analysis = 'partial';
        }
        paintOverlays();
        selectionStatus.textContent = result.text
          ? `Selected text: ${result.text}`
          : 'Text selection cleared.';
        if (result.quads.length === 0) {
          onSelectionAction(null);
          return;
        }
        const bounds = result.quads.map(quadBounds);
        const page = engine.info.pages[pageIndex];
        if (!page) return;
        const rect = element.getBoundingClientRect();
        const scale = PDF_POINT_SCALE * zoom;
        onSelectionAction({
          selection: result,
          viewportBounds: [
            rect.left + (Math.min(...bounds.map((value) => value[0])) - page.bounds[0]) * scale,
            rect.top + (Math.min(...bounds.map((value) => value[1])) - page.bounds[1]) * scale,
            rect.left + (Math.max(...bounds.map((value) => value[2])) - page.bounds[0]) * scale,
            rect.top + (Math.max(...bounds.map((value) => value[3])) - page.bounds[1]) * scale,
          ],
        });
      };

      const loadReadingOrder = (pageIndex: number) => {
        readingController?.abort();
        readingController = new AbortController();
        void engine
          .getPageText(pageIndex, readingController.signal)
          .then((pageText) => {
            reading.textContent = pageText.text;
            currentPageText = pageText.text;
            keyboardWordCount = 0;
            const structureUnavailable = pageText.limitations.includes('structure-tree');
            const formAnalysisPartial = pageText.limitations.includes('form-xobject');
            analysis.textContent =
              structureUnavailable && formAnalysisPartial
                ? 'Reading order is inferred because tagged structure traversal is unavailable; operator-run analysis excludes Form XObjects.'
                : structureUnavailable
                  ? 'Reading order is inferred because this build cannot traverse the tagged structure tree.'
                  : formAnalysisPartial
                    ? 'Text inside Form XObjects is available to reading, but excluded from operator-run analysis.'
                    : pageText.analysis === 'inferred'
                      ? 'Reading order is inferred from structured-text blocks and lines.'
                      : 'Structured text analysis complete for this page.';
            analysis.dataset.analysis = pageText.analysis;
            if (analysisStatusRef.current) {
              analysisStatusRef.current.textContent =
                structureUnavailable && formAnalysisPartial
                  ? 'DEGRADED · structure order unavailable; form run analysis partial'
                  : structureUnavailable
                    ? 'DEGRADED · structure order unavailable'
                    : formAnalysisPartial
                      ? 'DEGRADED · form run analysis partial'
                      : pageText.analysis === 'inferred'
                        ? 'DEGRADED · reading order inferred'
                        : 'LOCAL · page text analysed';
              analysisStatusRef.current.dataset.analysis = pageText.analysis;
            }
          })
          .catch((error: unknown) => reportError('Reading page text', error));
      };

      const renderPage = (pageIndex: number): PageNode | null => {
        const page = engine.info.pages[pageIndex];
        const placement = layout.placements[pageIndex];
        if (!page || !placement) return null;
        const controller = new AbortController();
        const element = document.createElement('div');
        element.className = 'pdf-page';
        element.setAttribute('aria-hidden', 'true');
        element.dataset.pageIndex = String(pageIndex);
        element.style.top = `${scroller.scrollTop + placement.top - logicalScrollTop()}px`;
        element.style.width = `${placement.width}px`;
        element.style.height = `${placement.height}px`;
        const surface = document.createElement('div');
        surface.className = 'pdf-page-surface';
        surface.style.width = `${page.width * PDF_POINT_SCALE * zoom}px`;
        surface.style.height = `${page.height * PDF_POINT_SCALE * zoom}px`;
        surface.style.transform = surfaceTransform(rotation);
        element.append(surface);
        content.append(element);
        const node: PageNode = { element, surface, controller, tiles: new Map() };

        element.addEventListener('pointerdown', (event) => {
          if (
            event.pointerType === 'touch' &&
            !selectionMode &&
            useToolStore.getState().activeTool === 'default'
          ) {
            return;
          }
          element.setPointerCapture(event.pointerId);
          dragStart = { pageIndex, point: pointFromEvent(event, pageIndex) };
        });
        element.addEventListener('pointerup', (event) => {
          if (!dragStart || dragStart.pageIndex !== pageIndex) return;
          const start = dragStart.point;
          const end = pointFromEvent(event, pageIndex);
          const activeTool = useToolStore.getState().activeTool;
          dragStart = null;
          if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1) {
            const hit = [...formFields]
              .reverse()
              .find(
                (field) =>
                  field.pageIndex === pageIndex &&
                  end[0] >= field.rect[0] &&
                  end[0] <= field.rect[2] &&
                  end[1] >= field.rect[1] &&
                  end[1] <= field.rect[3],
              );
            if (hit) {
              scroller.dispatchEvent(
                new CustomEvent('pdf-form-field-click', {
                  bubbles: true,
                  detail: { name: hit.name, pageIndex },
                }),
              );
              return;
            }
          }
          if (activeTool === 'redaction-mark') {
            const rect: EngineTypes['PdfRect'] = [
              Math.min(start[0], end[0]),
              Math.min(start[1], end[1]),
              Math.max(start[0], end[0]),
              Math.max(start[1], end[1]),
            ];
            if (rect[2] - rect[0] < 1 || rect[3] - rect[1] < 1) {
              onError('Drag over the exact region to redact. No mark was created.');
              return;
            }
            void engine
              .addAnnotation({
                pageIndex,
                type: 'Redact',
                rect,
                contents: 'Unapplied region redaction mark',
                color: [0, 0, 0],
                opacity: 1,
                flags: 4,
              })
              .then((result) => {
                onMutation(result);
                resetTool();
              })
              .catch((error: unknown) => reportError('Adding region redaction mark', error));
            return;
          }
          if (
            activeTool === 'note' ||
            activeTool === 'ink' ||
            activeTool === 'shape' ||
            activeTool === 'form-field'
          ) {
            const page = engine.info.pages[pageIndex];
            if (!page) return;
            const left = Math.min(start[0], end[0]);
            const top = Math.min(start[1], end[1]);
            const width = Math.max(72, Math.abs(end[0] - start[0]));
            const height = Math.max(32, Math.abs(end[1] - start[1]));
            const rect: EngineTypes['PdfRect'] = [
              left,
              top,
              Math.min(page.bounds[2], left + width),
              Math.min(page.bounds[3], top + height),
            ];
            const mutation =
              activeTool === 'form-field'
                ? engine.createFormField({
                    pageIndex,
                    name: `Field-${Date.now()}`,
                    label: 'New form field',
                    type: 'text',
                    rect,
                    required: false,
                    readOnly: false,
                  })
                : engine.addAnnotation({
                    pageIndex,
                    type:
                      activeTool === 'note' ? 'Text' : activeTool === 'ink' ? 'Ink' : 'Square',
                    rect,
                    contents:
                      activeTool === 'note'
                        ? 'New note'
                        : activeTool === 'ink'
                          ? 'Ink drawing'
                          : 'Shape',
                    color: [0.22, 0.33, 0.85],
                    opacity: 1,
                    flags: 4,
                    ...(activeTool === 'ink'
                      ? {
                          inkList: [
                            [
                              [start[0], start[1]],
                              [end[0], end[1]],
                            ],
                          ],
                        }
                      : {}),
                  });
            void mutation
              .then((result) => {
                onMutation(result);
                resetTool();
              })
              .catch((error: unknown) =>
                reportError(
                  activeTool === 'form-field'
                    ? 'Creating a form field'
                    : 'Adding the selected markup',
                  error,
                ),
              );
            return;
          }
          void engine
            .selectText(pageIndex, start, end, controller.signal)
            .then((result) => {
              if (activeTool === 'highlight' && result.quads.length > 0) {
                const bounds = result.quads.map(quadBounds);
                const rect: EngineTypes['PdfRect'] = [
                  Math.min(...bounds.map((value) => value[0])),
                  Math.min(...bounds.map((value) => value[1])),
                  Math.max(...bounds.map((value) => value[2])),
                  Math.max(...bounds.map((value) => value[3])),
                ];
                return engine
                  .addAnnotation({
                    pageIndex,
                    type: 'Highlight',
                    rect,
                    contents: result.text,
                    quadPoints: result.quads,
                    color: [0.96, 0.75, 0.28],
                    opacity: 0.35,
                    flags: 4,
                  })
                  .then((mutation) => {
                    onMutation(mutation);
                    resetTool();
                  });
              }
              presentSelection(result, pageIndex, element);
              return undefined;
            })
            .catch((error: unknown) => reportError('Selecting text', error));
        });
        element.addEventListener('pointercancel', () => {
          dragStart = null;
        });

        return node;
      };

      const updatePageTiles = (pageIndex: number, node: PageNode, logicalTop: number) => {
        const page = engine.info.pages[pageIndex];
        const placement = layout.placements[pageIndex];
        if (!page || !placement) return;
        const ratio = window.devicePixelRatio;
        const surfaceWidth = page.width * PDF_POINT_SCALE * zoom;
        const surfaceHeight = page.height * PDF_POINT_SCALE * zoom;
        const deviceWidth = Math.ceil(surfaceWidth * ratio);
        const deviceHeight = Math.ceil(surfaceHeight * ratio);
        const pageLeft = (content.clientWidth - placement.width) / 2;
        const needed = new Set<string>();
        const deviceScale = PDF_POINT_SCALE * zoom * ratio;
        const nodeGeneration = generation;
        const viewport = unrotatedViewport(
          scroller.scrollLeft - pageLeft,
          logicalTop - placement.top,
          scroller.clientWidth,
          scroller.clientHeight,
          surfaceWidth,
          surfaceHeight,
          rotation,
        );

        for (const tile of viewportTileRects(deviceWidth, deviceHeight, {
          left: viewport.left * ratio,
          top: viewport.top * ratio,
          width: viewport.width * ratio,
          height: viewport.height * ratio,
        })) {
          const key = `${tile.x}:${tile.y}`;
          needed.add(key);
          if (node.tiles.has(key)) continue;

          const tileController = new AbortController();
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-tile';
          canvas.width = tile.width;
          canvas.height = tile.height;
          canvas.style.left = `${tile.x / ratio}px`;
          canvas.style.top = `${tile.y / ratio}px`;
          canvas.style.width = `${tile.width / ratio}px`;
          canvas.style.height = `${tile.height / ratio}px`;
          node.surface.append(canvas);

          const overlay = document.createElement('canvas');
          overlay.className = 'pdf-tile pdf-highlight-tile';
          overlay.width = tile.width;
          overlay.height = tile.height;
          overlay.style.left = canvas.style.left;
          overlay.style.top = canvas.style.top;
          overlay.style.width = canvas.style.width;
          overlay.style.height = canvas.style.height;
          node.surface.append(overlay);
          node.tiles.set(key, { canvas, overlay, tile, controller: tileController });

          void engine
            .renderTile(
              {
                pageIndex,
                scale: deviceScale,
                x: tile.x,
                y: tile.y,
                width: tile.width,
                height: tile.height,
                priority:
                  Math.abs(
                    tile.x +
                      tile.width / 2 -
                      (viewport.left * ratio + (viewport.width * ratio) / 2),
                  ) +
                  Math.abs(
                    tile.y +
                      tile.height / 2 -
                      (viewport.top * ratio + (viewport.height * ratio) / 2),
                  ),
              },
              tileController.signal,
            )
            .then((result) => {
              if (nodeGeneration !== generation || tileController.signal.aborted) return;
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
              context.putImageData(
                new ImageData(
                  new Uint8ClampedArray(result.pixels),
                  result.width,
                  result.height,
                ),
                0,
                0,
              );
            })
            .catch((error: unknown) => reportError(`Rendering page ${pageIndex + 1}`, error));
        }

        for (const [key, renderedTile] of node.tiles) {
          if (needed.has(key)) continue;
          renderedTile.controller.abort();
          renderedTile.canvas.remove();
          renderedTile.overlay.remove();
          node.tiles.delete(key);
        }
      };

      const updateVisiblePages = () => {
        frame = 0;
        const logicalTop = logicalScrollTop();
        const [start, end] = layout.visibleRange(logicalTop, scroller.clientHeight);
        for (const [index, node] of pageNodes) {
          if (index < start || index >= end) {
            node.controller.abort();
            for (const tile of node.tiles.values()) tile.controller.abort();
            node.element.remove();
            pageNodes.delete(index);
          }
        }
        for (let index = start; index < end; index += 1) {
          if (!pageNodes.has(index)) {
            const node = renderPage(index);
            if (node) pageNodes.set(index, node);
          }
          const node = pageNodes.get(index);
          if (node) {
            positionPage(index, node, logicalTop);
            updatePageTiles(index, node, logicalTop);
          }
        }

        const nextPage = layout.pageAt(logicalTop + scroller.clientHeight * 0.35);
        if (nextPage !== currentPage && nextPage >= 0) {
          currentPage = nextPage;
          viewportStore.getState().setCurrentPage(nextPage);
          if (currentPageRef.current) {
            currentPageRef.current.textContent = `${nextPage + 1} / ${engine.info.pages.length}`;
          }
          loadReadingOrder(nextPage);
        }
        paintOverlays();
      };

      const scheduleVisiblePages = () => {
        if (!frame) frame = requestAnimationFrame(updateVisiblePages);
      };

      const rebuild = (anchorRatio = 0, pointerY = 0) => {
        generation += 1;
        for (const node of pageNodes.values()) {
          node.controller.abort();
          for (const tile of node.tiles.values()) tile.controller.abort();
          node.element.remove();
        }
        pageNodes.clear();
        layout = new PageLayout(engine.info.pages, zoom, PAGE_GAP, rotation);
        content.style.height = `${layout.scrollHeight()}px`;
        const widestPage = layout.placements.reduce(
          (widest, placement) => Math.max(widest, placement.width),
          0,
        );
        content.style.width = `${Math.max(scroller.clientWidth, widestPage + layout.gap * 2)}px`;
        const logicalTop = Math.max(0, layout.totalHeight * anchorRatio - pointerY);
        scroller.scrollTop = layout.scrollOffsetForLogical(logicalTop, scroller.clientHeight);
        if (zoomRef.current) zoomRef.current.textContent = `${Math.round(zoom * 100)}%`;
        scheduleVisiblePages();
      };

      const setZoom = (nextZoom: number, pointerY = scroller.clientHeight / 2) => {
        const clamped = Math.min(8, Math.max(0.25, nextZoom));
        if (clamped === zoom) return;
        const anchor = logicalScrollTop() + pointerY;
        const oldHeight = layout.totalHeight;
        const ratio = oldHeight > 0 ? anchor / oldHeight : 0;
        zoom = clamped;
        viewportStore.getState().setZoom(zoom);
        rebuild(ratio, pointerY);
      };

      const onWheel = (event: WheelEvent) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const bounds = scroller.getBoundingClientRect();
        setZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientY - bounds.top);
      };

      const changeKeyboardSelection = async (direction: 1 | -1) => {
        if (currentPage < 0) return;
        keyboardSelectionController?.abort();
        keyboardSelectionController = new AbortController();
        const signal = keyboardSelectionController.signal;
        if (!currentPageText) {
          currentPageText = (await engine.getPageText(currentPage, signal)).text;
        }
        const words = [...currentPageText.matchAll(/\S+/g)];
        keyboardWordCount = Math.min(words.length, Math.max(0, keyboardWordCount + direction));
        if (keyboardWordCount === 0) {
          selection = null;
          selectionStatus.textContent = 'Text selection cleared.';
          onSelectionAction(null);
          paintOverlays();
          return;
        }
        const firstWord = words[0];
        const lastWord = words[keyboardWordCount - 1];
        const node = pageNodes.get(currentPage);
        if (!firstWord || firstWord.index === undefined || !lastWord || !node) return;
        const end = (lastWord.index ?? 0) + lastWord[0].length;
        const selectedText = currentPageText
          .slice(firstWord.index, end)
          .replace(/\s+/g, ' ')
          .trim();
        const requestGeneration = ++selectionGeneration;
        const result = await engine.search(selectedText, signal);
        if (requestGeneration !== selectionGeneration) return;
        const hit = result.hits.find((candidate) => candidate.pageIndex === currentPage);
        if (!hit) {
          throw new Error(
            'The selected reading-order text could not be mapped back to page geometry.',
          );
        }
        presentSelection(
          {
            pageIndex: currentPage,
            text: selectedText,
            quads: hit.quads,
            truncated: result.truncated,
          },
          currentPage,
          node.element,
        );
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          onFind();
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'c' &&
          selection?.text
        ) {
          event.preventDefault();
          if (!navigator.clipboard) {
            onError('Copy failed. Clipboard access is not available in this browser.');
            return;
          }
          void navigator.clipboard
            .writeText(selection.text)
            .catch((error: unknown) => reportError('Copying selected text', error));
          return;
        }
        if (
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
        ) {
          event.preventDefault();
          void changeKeyboardSelection(event.key === 'ArrowRight' ? 1 : -1).catch(
            (error: unknown) => reportError('Selecting text with the keyboard', error),
          );
        }
      };

      const onScroll = () => {
        onSelectionAction(null);
        viewportStore.getState().setScroll(scroller.scrollLeft, scroller.scrollTop);
        scheduleVisiblePages();
      };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      scroller.addEventListener('wheel', onWheel, { passive: false });
      scroller.addEventListener('keydown', onKeyDown);
      content.style.height = `${layout.scrollHeight()}px`;
      const initialWidth = layout.placements.reduce(
        (widest, placement) => Math.max(widest, placement.width + layout.gap * 2),
        scroller.clientWidth,
      );
      content.style.width = `${initialWidth}px`;
      scroller.scrollLeft = Math.max(0, (initialWidth - scroller.clientWidth) / 2);
      apiRef.current = {
        goToPage(pageIndex) {
          const safeIndex = Math.min(engine.info.pages.length - 1, Math.max(0, pageIndex));
          scrollToLogical(layout.offsetFor(safeIndex), 'smooth');
          scroller.focus();
        },
        zoomBy(factor) {
          setZoom(zoom * factor);
        },
        resetZoom() {
          setZoom(1);
        },
        fitWidth() {
          setZoom(fitWidthZoom());
        },
        rotateView(degrees) {
          const anchor = logicalScrollTop() + scroller.clientHeight / 2;
          const ratio = layout.totalHeight > 0 ? anchor / layout.totalHeight : 0;
          rotation = ((((rotation + degrees) % 360) + 360) % 360) as PageRotation;
          rebuild(ratio, scroller.clientHeight / 2);
        },
        toggleSelectionMode() {
          selectionMode = !selectionMode;
          scroller.dataset.selectionMode = String(selectionMode);
          if (selectionModeRef.current) {
            selectionModeRef.current.textContent = selectionMode ? 'Select mode' : 'Pan mode';
            selectionModeRef.current.setAttribute('aria-pressed', String(selectionMode));
          }
        },
        focus() {
          scroller.focus();
        },
        showSearchHit(hit) {
          searchHighlight = hit ? { pageIndex: hit.pageIndex, quads: hit.quads } : null;
          if (hit) {
            const page = engine.info.pages[hit.pageIndex];
            const firstQuad = hit.quads[0];
            const matchTop =
              page && firstQuad
                ? (quadBounds(firstQuad)[1] - page.bounds[1]) * PDF_POINT_SCALE * zoom
                : 0;
            scrollToLogical(
              Math.max(
                0,
                layout.offsetFor(hit.pageIndex) + matchTop - scroller.clientHeight * 0.25,
              ),
              'smooth',
            );
          }
          paintOverlays();
        },
      };
      if (zoomRef.current) zoomRef.current.textContent = `${Math.round(zoom * 100)}%`;
      updateVisiblePages();

      return () => {
        apiRef.current = null;
        readingController?.abort();
        keyboardSelectionController?.abort();
        if (frame) cancelAnimationFrame(frame);
        for (const node of pageNodes.values()) {
          node.controller.abort();
          for (const tile of node.tiles.values()) tile.controller.abort();
          node.element.remove();
        }
        scroller.removeEventListener('scroll', onScroll);
        scroller.removeEventListener('wheel', onWheel);
        scroller.removeEventListener('keydown', onKeyDown);
      };
    }, [
      analysisStatusRef,
      currentPageRef,
      engine,
      formFields,
      formFieldsHighlighted,
      onError,
      onFind,
      onMutation,
      onSelectionAction,
      resetTool,
      selectionModeRef,
      zoomRef,
    ]);

    return (
      <section
        ref={scrollerRef}
        className="document-viewport"
        aria-label="Document pages"
        aria-keyshortcuts="Shift+ArrowRight Shift+ArrowLeft"
        aria-describedby="document-keyboard-help"
        tabIndex={0}
      >
        <div ref={contentRef} className="document-content" />
        <div ref={readingRef} className="sr-only" aria-label="Current page reading order" />
        <p ref={analysisRef} className="sr-only" aria-live="polite" />
        <p
          ref={selectionStatusRef}
          className="sr-only"
          aria-label="Text selection status"
          aria-live="polite"
        />
        <p id="document-keyboard-help" className="sr-only">
          Hold Shift and press Right Arrow to extend text selection by word. Press Shift and
          Left Arrow to reduce it.
        </p>
      </section>
    );
  },
);

export default DocumentViewport;
