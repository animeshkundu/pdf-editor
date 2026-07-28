import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import engineErrors, { type EngineTypes } from '@/lib/engine/port';
import renderLayout from '@/lib/render/layout';
import type { PageRotation } from '@/lib/render/layout';
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
      onError,
    },
    ref,
  ) {
    const scrollerRef = useRef<HTMLElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const readingRef = useRef<HTMLDivElement>(null);
    const analysisRef = useRef<HTMLParagraphElement>(null);
    const apiRef = useRef<DocumentViewportHandle | null>(null);

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
      if (!scroller || !content || !reading || !analysis) return;

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
      let selectionMode = false;
      viewportStore.getState().reset();
      viewportStore.getState().setZoom(zoom);

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

      const loadReadingOrder = (pageIndex: number) => {
        readingController?.abort();
        readingController = new AbortController();
        void engine
          .getPageText(pageIndex, readingController.signal)
          .then((pageText) => {
            reading.textContent = pageText.text;
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
          if (event.pointerType === 'touch' && !selectionMode) return;
          element.setPointerCapture(event.pointerId);
          dragStart = { pageIndex, point: pointFromEvent(event, pageIndex) };
        });
        element.addEventListener('pointerup', (event) => {
          if (!dragStart || dragStart.pageIndex !== pageIndex) return;
          const start = dragStart.point;
          const end = pointFromEvent(event, pageIndex);
          dragStart = null;
          void engine
            .selectText(pageIndex, start, end, controller.signal)
            .then((result) => {
              selection = result;
              if (result.truncated && analysisStatusRef.current) {
                analysisStatusRef.current.textContent =
                  'DEGRADED · selection highlight limited to 4,096 regions';
                analysisStatusRef.current.dataset.analysis = 'partial';
              }
              paintOverlays();
              if (result.quads.length > 0) {
                const bounds = result.quads.map(quadBounds);
                const rect = element.getBoundingClientRect();
                const scale = PDF_POINT_SCALE * zoom;
                onSelectionAction({
                  selection: result,
                  viewportBounds: [
                    rect.left +
                      (Math.min(...bounds.map((value) => value[0])) - page.bounds[0]) * scale,
                    rect.top +
                      (Math.min(...bounds.map((value) => value[1])) - page.bounds[1]) * scale,
                    rect.left +
                      (Math.max(...bounds.map((value) => value[2])) - page.bounds[0]) * scale,
                    rect.top +
                      (Math.max(...bounds.map((value) => value[3])) - page.bounds[1]) * scale,
                  ],
                });
              } else {
                onSelectionAction(null);
              }
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
      onError,
      onFind,
      onSelectionAction,
      selectionModeRef,
      zoomRef,
    ]);

    return (
      <section
        ref={scrollerRef}
        className="document-viewport"
        aria-label="Document pages"
        tabIndex={0}
      >
        <div ref={contentRef} className="document-content" />
        <div ref={readingRef} className="sr-only" aria-label="Current page reading order" />
        <p ref={analysisRef} className="sr-only" aria-live="polite" />
      </section>
    );
  },
);

export default DocumentViewport;
