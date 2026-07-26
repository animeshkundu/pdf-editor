import { describe, expect, it } from 'vitest';
import {
  DESKTOP_BUDGET,
  IOS_BUDGET,
  LimitError,
  WASM_HARD_CEILING,
  assertFileSize,
  assertHeadroom,
  assertPageCount,
  assertRenderSize,
  assertSaveFlags,
  budgetFor,
  isIosLike,
  pressureOf,
  projectRenderBytes,
} from '@/lib/core/limits';

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof LimitError ? e.code : 'not-a-LimitError';
  }
}

describe('budget selection', () => {
  it('detects iPhone and iPad by user agent', () => {
    expect(isIosLike({ maxTouchPoints: 5, userAgent: 'iPhone' })).toBe(true);
    expect(isIosLike({ maxTouchPoints: 5, userAgent: 'iPad' })).toBe(true);
  });

  it('detects iPadOS, which reports a desktop Macintosh user agent', () => {
    expect(isIosLike({ maxTouchPoints: 5, userAgent: 'Macintosh' })).toBe(true);
  });

  it('does not mistake a Mac with a trackpad for iPadOS', () => {
    expect(isIosLike({ maxTouchPoints: 0, userAgent: 'Macintosh' })).toBe(false);
  });

  it('gives iOS a materially lower budget, not a scaled desktop one', () => {
    expect(budgetFor({ maxTouchPoints: 5, userAgent: 'iPhone' })).toBe(IOS_BUDGET);
    expect(IOS_BUDGET.wasmSoftCeiling).toBeLessThan(DESKTOP_BUDGET.wasmSoftCeiling / 1.5);
  });

  it('keeps every soft ceiling below the wasm32 hard limit', () => {
    expect(DESKTOP_BUDGET.wasmSoftCeiling).toBeLessThan(WASM_HARD_CEILING);
    expect(IOS_BUDGET.wasmSoftCeiling).toBeLessThan(WASM_HARD_CEILING);
  });
});

describe('input ceilings', () => {
  it('accepts a file at exactly the limit and rejects one byte more', () => {
    expect(codeOf(() => assertFileSize(DESKTOP_BUDGET.maxFileBytes, DESKTOP_BUDGET))).toBeNull();
    expect(codeOf(() => assertFileSize(DESKTOP_BUDGET.maxFileBytes + 1, DESKTOP_BUDGET))).toBe(
      'file_too_large',
    );
  });

  it('rejects a page count above the ceiling', () => {
    expect(codeOf(() => assertPageCount(DESKTOP_BUDGET.maxPages, DESKTOP_BUDGET))).toBeNull();
    expect(codeOf(() => assertPageCount(DESKTOP_BUDGET.maxPages + 1, DESKTOP_BUDGET))).toBe(
      'too_many_pages',
    );
  });

  it('explains the limit in the message rather than just failing', () => {
    try {
      assertFileSize(DESKTOP_BUDGET.maxFileBytes + 1, DESKTOP_BUDGET);
      expect.unreachable();
    } catch (e) {
      expect((e as LimitError).message).toMatch(/limit on this device/i);
    }
  });
});

describe('projectRenderBytes', () => {
  it('computes RGBA bytes', () => {
    expect(projectRenderBytes(100, 50)).toBe(20_000);
  });

  it('does not overflow on adversarial dimensions', () => {
    // 2^30 x 2^30 x 4 far exceeds Number.MAX_SAFE_INTEGER. Computed naively this wraps
    // to a small float and sails past the ceiling check it is meant to trigger.
    const huge = projectRenderBytes(2 ** 30, 2 ** 30);
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBe(Number.MAX_SAFE_INTEGER);
    expect(huge).toBeGreaterThan(DESKTOP_BUDGET.wasmSoftCeiling);
  });

  it('treats negative dimensions as zero rather than producing negative cost', () => {
    expect(projectRenderBytes(-10, 100)).toBe(0);
  });
});

describe('assertHeadroom, the check-before-mutate gate', () => {
  it('permits an operation that fits', () => {
    expect(codeOf(() => assertHeadroom(100_000_000, 50_000_000, DESKTOP_BUDGET))).toBeNull();
  });

  it('rejects an operation that would cross the ceiling', () => {
    expect(
      codeOf(() => assertHeadroom(DESKTOP_BUDGET.wasmSoftCeiling - 10, 100, DESKTOP_BUDGET)),
    ).toBe('heap_ceiling');
  });

  it('rejects when the sum overflows safe-integer arithmetic', () => {
    expect(
      codeOf(() => assertHeadroom(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, DESKTOP_BUDGET)),
    ).toBe('heap_ceiling');
  });
});

describe('assertRenderSize', () => {
  it('rejects a render too large for one uninterruptible toPixmap call', () => {
    expect(codeOf(() => assertRenderSize(4000, 4000, DESKTOP_BUDGET))).toBe('render_too_large');
  });

  it('permits a tile', () => {
    expect(codeOf(() => assertRenderSize(512, 512, DESKTOP_BUDGET))).toBeNull();
  });

  it('is stricter on iOS, where a large render kills the tab outright', () => {
    expect(codeOf(() => assertRenderSize(1200, 1200, IOS_BUDGET))).toBe('render_too_large');
    expect(codeOf(() => assertRenderSize(1200, 1200, DESKTOP_BUDGET))).toBeNull();
  });
});

describe('pressureOf', () => {
  it('reports ok, warn and critical across the range', () => {
    const c = DESKTOP_BUDGET.wasmSoftCeiling;
    expect(pressureOf(0, DESKTOP_BUDGET)).toBe('ok');
    expect(pressureOf(c * 0.7, DESKTOP_BUDGET)).toBe('warn');
    expect(pressureOf(c * 0.9, DESKTOP_BUDGET)).toBe('critical');
  });
});

describe('assertSaveFlags', () => {
  const healthy = { canIncremental: true, wasRepaired: false };

  it('allows a plain incremental save', () => {
    expect(codeOf(() => assertSaveFlags({ mode: 'incremental' }, healthy))).toBeNull();
  });

  it('allows any full save', () => {
    expect(
      codeOf(() =>
        assertSaveFlags({ mode: 'full', garbage: 'all', changesEncryption: true }, healthy),
      ),
    ).toBeNull();
  });

  it('refuses incremental on a repaired document', () => {
    expect(
      codeOf(() =>
        assertSaveFlags({ mode: 'incremental' }, { canIncremental: true, wasRepaired: true }),
      ),
    ).toBe('save_flag_conflict');
  });

  it('refuses incremental combined with garbage collection', () => {
    expect(codeOf(() => assertSaveFlags({ mode: 'incremental', garbage: 'all' }, healthy))).toBe(
      'save_flag_conflict',
    );
  });

  it('refuses incremental when the password changes', () => {
    expect(
      codeOf(() => assertSaveFlags({ mode: 'incremental', changesEncryption: true }, healthy)),
    ).toBe('save_flag_conflict');
  });

  it('explains why in terms a user can act on', () => {
    try {
      assertSaveFlags({ mode: 'incremental' }, { canIncremental: true, wasRepaired: true });
      expect.unreachable();
    } catch (e) {
      expect((e as LimitError).message).toMatch(/repaired/i);
      expect((e as LimitError).message).toMatch(/full copy/i);
    }
  });
});
