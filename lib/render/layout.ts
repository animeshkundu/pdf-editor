import type { EngineTypes } from '../engine/port';

type PageInfo = EngineTypes['PageInfo'];
export type PageRotation = 0 | 90 | 180 | 270;
const PDF_POINT_SCALE = 96 / 72;
const PAGE_GAP = 24;
const MAX_TILE_SIZE = 512;
const MAX_SCROLL_HEIGHT = 8_000_000;

interface PagePlacement {
  readonly index: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TileViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

class PageLayout {
  readonly placements: readonly PagePlacement[];
  readonly totalHeight: number;

  constructor(
    pages: readonly PageInfo[],
    readonly zoom: number,
    readonly gap = PAGE_GAP,
    readonly rotation: PageRotation = 0,
  ) {
    const scale = PDF_POINT_SCALE * zoom;
    const placements: PagePlacement[] = [];
    let top = gap;
    for (const page of pages) {
      const rotated = rotation === 90 || rotation === 270;
      const width = Math.max(1, (rotated ? page.height : page.width) * scale);
      const height = Math.max(1, (rotated ? page.width : page.height) * scale);
      placements.push({ index: page.index, top, width, height });
      top += height + gap;
    }
    this.placements = placements;
    this.totalHeight = top;
  }

  pageAt(offset: number): number {
    if (this.placements.length === 0) return -1;
    let low = 0;
    let high = this.placements.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const placement = this.placements[middle];
      if (!placement) break;
      if (offset < placement.top) {
        high = middle - 1;
      } else if (offset > placement.top + placement.height + this.gap) {
        low = middle + 1;
      } else {
        return placement.index;
      }
    }
    return Math.min(this.placements.length - 1, Math.max(0, low));
  }

  visibleRange(
    scrollTop: number,
    viewportHeight: number,
    overscan = 600,
  ): readonly [number, number] {
    if (this.placements.length === 0) return [0, 0];
    const start = this.pageAt(Math.max(0, scrollTop - overscan));
    const end = this.pageAt(scrollTop + viewportHeight + overscan);
    return [Math.max(0, start), Math.min(this.placements.length, end + 1)];
  }

  offsetFor(pageIndex: number): number {
    return this.placements[pageIndex]?.top ?? 0;
  }

  scrollHeight(): number {
    return Math.min(this.totalHeight, MAX_SCROLL_HEIGHT);
  }

  logicalOffsetForScroll(scrollTop: number, viewportHeight: number): number {
    const physicalRange = Math.max(0, this.scrollHeight() - Math.max(0, viewportHeight));
    const logicalRange = Math.max(0, this.totalHeight - Math.max(0, viewportHeight));
    if (physicalRange === 0 || logicalRange === 0) return 0;
    const ratio = Math.min(1, Math.max(0, scrollTop / physicalRange));
    return ratio * logicalRange;
  }

  scrollOffsetForLogical(logicalOffset: number, viewportHeight: number): number {
    const physicalRange = Math.max(0, this.scrollHeight() - Math.max(0, viewportHeight));
    const logicalRange = Math.max(0, this.totalHeight - Math.max(0, viewportHeight));
    if (physicalRange === 0 || logicalRange === 0) return 0;
    const ratio = Math.min(1, Math.max(0, logicalOffset / logicalRange));
    return ratio * physicalRange;
  }
}

function tileRects(width: number, height: number, maxSize = MAX_TILE_SIZE): TileRect[] {
  const safeWidth = Math.max(0, Math.ceil(width));
  const safeHeight = Math.max(0, Math.ceil(height));
  if (safeWidth === 0 || safeHeight === 0) return [];
  if (!Number.isFinite(maxSize) || maxSize < 1) {
    throw new RangeError('Tile size must be a positive finite number.');
  }

  const tileSize = Math.floor(maxSize);
  const tiles: TileRect[] = [];
  for (let y = 0; y < safeHeight; y += tileSize) {
    for (let x = 0; x < safeWidth; x += tileSize) {
      tiles.push({
        x,
        y,
        width: Math.min(tileSize, safeWidth - x),
        height: Math.min(tileSize, safeHeight - y),
      });
    }
  }
  return tiles;
}

function viewportTileRects(
  width: number,
  height: number,
  viewport: TileViewport,
  maxSize = MAX_TILE_SIZE,
  prefetch = maxSize,
): TileRect[] {
  const safeWidth = Math.max(0, Math.ceil(width));
  const safeHeight = Math.max(0, Math.ceil(height));
  if (safeWidth === 0 || safeHeight === 0) return [];
  if (!Number.isFinite(maxSize) || maxSize < 1) {
    throw new RangeError('Tile size must be a positive finite number.');
  }
  const tileSize = Math.floor(maxSize);
  const ring = Math.max(0, prefetch);
  const startX = Math.max(0, Math.floor((viewport.left - ring) / tileSize) * tileSize);
  const endX = Math.min(
    safeWidth,
    Math.ceil((viewport.left + viewport.width + ring) / tileSize) * tileSize,
  );
  const startY = Math.max(0, Math.floor((viewport.top - ring) / tileSize) * tileSize);
  const endY = Math.min(
    safeHeight,
    Math.ceil((viewport.top + viewport.height + ring) / tileSize) * tileSize,
  );
  const tiles: TileRect[] = [];
  for (let y = startY; y < endY; y += tileSize) {
    for (let x = startX; x < endX; x += tileSize) {
      tiles.push({
        x,
        y,
        width: Math.min(tileSize, safeWidth - x),
        height: Math.min(tileSize, safeHeight - y),
      });
    }
  }
  return tiles;
}

export default {
  MAX_SCROLL_HEIGHT,
  MAX_TILE_SIZE,
  PAGE_GAP,
  PDF_POINT_SCALE,
  PageLayout,
  tileRects,
  viewportTileRects,
};
