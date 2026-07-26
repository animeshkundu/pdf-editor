/**
 * Resource ceilings, and the discipline that makes them safe.
 *
 * The rule this module exists to enforce: **project, assert, then mutate.** Every
 * operation that can grow memory computes its cost first and throws before touching
 * the document. A rejection must never leave a half-edited document behind, because
 * the alternative — discovering the ceiling mid-mutation — corrupts state in a way no
 * undo can reach.
 *
 * The ceilings are not arbitrary. MuPDF's WASM build is wasm32 with
 * `ALLOW_MEMORY_GROWTH` and no maximum override, which caps its linear memory at
 * 2 GiB; exceeding it aborts the instance rather than throwing something catchable.
 * iOS Safari dies well below that, and kills the tab outright with no catchable error,
 * so graceful degradation can never run there — which is why its budget is a separate,
 * much lower number rather than a fraction of the desktop one.
 */

export type LimitCode =
  | 'file_too_large'
  | 'too_many_pages'
  | 'page_too_large'
  | 'heap_ceiling'
  | 'render_too_large'
  | 'bitmap_budget'
  | 'save_flag_conflict'
  | 'storage_quota';

export class LimitError extends Error {
  override readonly name = 'LimitError';
  constructor(
    readonly code: LimitCode,
    message: string,
    readonly detail?: { projected?: number; ceiling?: number },
  ) {
    super(message);
  }
}

export interface Budget {
  /** Bytes of input PDF we will open at all. */
  readonly maxFileBytes: number;
  readonly maxPages: number;
  /** Longest side of a single page, in PDF points. */
  readonly maxPagePoints: number;
  /** Soft ceiling for the MuPDF linear memory; below the 2 GiB hard wasm32 limit. */
  readonly wasmSoftCeiling: number;
  /** Pixels in one uninterruptible toPixmap call. Larger renders are tiled. */
  readonly maxRenderPixels: number;
  /** Main-thread ImageBitmap cache. */
  readonly bitmapBudget: number;
}

/** wasm32 linear memory cannot exceed this. Exceeding it aborts, it does not throw. */
export const WASM_HARD_CEILING = 2_147_483_648;

export const DESKTOP_BUDGET: Budget = {
  maxFileBytes: 512 * 1024 * 1024,
  maxPages: 10_000,
  maxPagePoints: 14_400, // PDF's own maximum user-space page dimension
  wasmSoftCeiling: 1_400_000_000,
  maxRenderPixels: 4_000_000,
  bitmapBudget: 384 * 1024 * 1024,
};

/**
 * iOS Safari's per-tab WebAssembly budget is far below wasm32's 2 GiB, and it
 * terminates the tab rather than surfacing an error. Every number here is therefore a
 * measured survival threshold, not a scaled-down desktop value.
 */
export const IOS_BUDGET: Budget = {
  maxFileBytes: 200 * 1024 * 1024,
  maxPages: 4_000,
  maxPagePoints: 14_400,
  wasmSoftCeiling: 700_000_000,
  maxRenderPixels: 1_000_000,
  bitmapBudget: 160 * 1024 * 1024,
};

export function isIosLike(nav: { maxTouchPoints: number; userAgent: string }): boolean {
  // iPadOS reports a desktop UA string, so touch capability is the reliable signal.
  return (
    /iP(hone|ad|od)/.test(nav.userAgent) ||
    (nav.maxTouchPoints > 1 && /Macintosh/.test(nav.userAgent))
  );
}

export function budgetFor(nav: { maxTouchPoints: number; userAgent: string }): Budget {
  return isIosLike(nav) ? IOS_BUDGET : DESKTOP_BUDGET;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  return `${Math.round(n / 1024)} kB`;
}

export function assertFileSize(bytes: number, budget: Budget): void {
  if (bytes > budget.maxFileBytes) {
    throw new LimitError(
      'file_too_large',
      `This file is ${fmtBytes(bytes)}. The limit on this device is ${fmtBytes(budget.maxFileBytes)}.`,
      { projected: bytes, ceiling: budget.maxFileBytes },
    );
  }
}

export function assertPageCount(pages: number, budget: Budget): void {
  if (pages > budget.maxPages) {
    throw new LimitError(
      'too_many_pages',
      `This document has ${pages.toLocaleString()} pages. The limit on this device is ${budget.maxPages.toLocaleString()}.`,
      { projected: pages, ceiling: budget.maxPages },
    );
  }
}

export function assertPageSize(widthPt: number, heightPt: number, budget: Budget): void {
  const longest = Math.max(widthPt, heightPt);
  if (longest > budget.maxPagePoints) {
    throw new LimitError(
      'page_too_large',
      `A page measures ${Math.round(longest)} pt on its longest side, beyond the ${budget.maxPagePoints} pt limit.`,
      { projected: longest, ceiling: budget.maxPagePoints },
    );
  }
}

/**
 * Bytes an RGBA raster of these dimensions will occupy. Computed in BigInt because
 * width * height * 4 overflows Number.MAX_SAFE_INTEGER for adversarial inputs, and a
 * silently-wrapped product would sail past the very check meant to catch it.
 */
export function projectRenderBytes(width: number, height: number): number {
  const bytes = BigInt(Math.max(0, Math.ceil(width))) * BigInt(Math.max(0, Math.ceil(height))) * 4n;
  return bytes > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(bytes);
}

export function assertRenderSize(width: number, height: number, budget: Budget): void {
  const pixels = Math.ceil(width) * Math.ceil(height);
  if (pixels > budget.maxRenderPixels) {
    throw new LimitError(
      'render_too_large',
      `A single render of ${Math.round(width)}x${Math.round(height)} exceeds the ${budget.maxRenderPixels.toLocaleString()} pixel limit. Tile it instead.`,
      { projected: pixels, ceiling: budget.maxRenderPixels },
    );
  }
}

/**
 * The check-before-mutate gate. Callers pass the CURRENT heap and the PROJECTED cost
 * of the operation they are about to perform; this throws before that operation runs.
 */
export function assertHeadroom(currentBytes: number, projectedBytes: number, budget: Budget): void {
  const total = BigInt(Math.max(0, currentBytes)) + BigInt(Math.max(0, projectedBytes));
  if (total > BigInt(budget.wasmSoftCeiling)) {
    throw new LimitError(
      'heap_ceiling',
      `This action needs ${fmtBytes(projectedBytes)} more memory than is available. Close a document or reduce the zoom level.`,
      { projected: Number(total), ceiling: budget.wasmSoftCeiling },
    );
  }
}

export type MemoryPressure = 'ok' | 'warn' | 'critical';

export function pressureOf(currentBytes: number, budget: Budget): MemoryPressure {
  const ratio = currentBytes / budget.wasmSoftCeiling;
  if (ratio >= 0.85) return 'critical';
  if (ratio >= 0.65) return 'warn';
  return 'ok';
}

/**
 * MuPDF's save flags are mutually exclusive in ways it enforces by throwing from
 * inside WASM. Validating here means the UI can disable an option rather than letting
 * the user pick it and then fail.
 */
export interface SaveFlags {
  readonly mode: 'full' | 'incremental';
  readonly garbage?: 'none' | 'compact' | 'deduplicate' | 'all';
  readonly changesEncryption?: boolean;
}

export interface SaveCapabilities {
  readonly canIncremental: boolean;
  readonly wasRepaired: boolean;
}

export function assertSaveFlags(flags: SaveFlags, caps: SaveCapabilities): void {
  if (flags.mode !== 'incremental') return;

  if (caps.wasRepaired) {
    throw new LimitError(
      'save_flag_conflict',
      'This document had to be repaired when it was opened, so an incremental save is not possible. Save a full copy instead.',
    );
  }
  if (!caps.canIncremental) {
    throw new LimitError(
      'save_flag_conflict',
      'This document cannot be saved incrementally. Save a full copy instead.',
    );
  }
  if (flags.garbage && flags.garbage !== 'none') {
    throw new LimitError(
      'save_flag_conflict',
      'Incremental save cannot collect unused objects. Choose a full save, or turn off cleanup.',
    );
  }
  if (flags.changesEncryption) {
    throw new LimitError(
      'save_flag_conflict',
      'Changing the password requires a full save.',
    );
  }
}
