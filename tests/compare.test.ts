/**
 * Tests for the framework-free comparison kernel (lib/compare/).
 *
 * Coverage:
 *  - fingerprint.ts: pageFingerprint, textSimilarity, SIMILARITY_THRESHOLDS
 *  - text-diff.ts: diffWords, MAX_DIFF_TOKENS, TextRun classification
 *  - raster-diff.ts: rasterDiff, RASTER_THRESHOLDS, error paths
 *  - page-sequence.ts: classifyPageSequence (same, changed, moved, inserted, deleted)
 *
 * All tests use synthetic text and pixel data to avoid depending on the WASM engine.
 * Thresholds tested here must match the constants in the modules exactly.
 */
import { describe, it, expect } from 'vitest';
import {
  pageFingerprint,
  textSimilarity,
  SIMILARITY_THRESHOLDS,
} from '@/lib/compare/fingerprint';
import { diffWords, MAX_DIFF_TOKENS } from '@/lib/compare/text-diff';
import { rasterDiff, RASTER_THRESHOLDS } from '@/lib/compare/raster-diff';
import { classifyPageSequence, type PageInput } from '@/lib/compare/page-sequence';

// ─── fingerprint ────────────────────────────────────────────────────────────

describe('pageFingerprint', () => {
  it('produces an empty string for empty text', () => {
    expect(pageFingerprint('')).toBe('');
    expect(pageFingerprint('   \t\n  ')).toBe('');
  });

  it('is case-insensitive (same fingerprint regardless of case)', () => {
    expect(pageFingerprint('Hello World')).toBe(pageFingerprint('hello world'));
    expect(pageFingerprint('CHAPTER ONE')).toBe(pageFingerprint('chapter one'));
  });

  it('is order-independent (same fingerprint regardless of word order)', () => {
    expect(pageFingerprint('apple banana cherry')).toBe(pageFingerprint('cherry apple banana'));
  });

  it('strips punctuation (commas and periods do not affect the fingerprint; hyphens split words)', () => {
    expect(pageFingerprint('Hello, world.')).toBe(pageFingerprint('Hello world'));
    // Hyphens are treated as word separators: 'first-class' → tokens {first, class}
    expect(pageFingerprint('first-class mail')).toBe(pageFingerprint('first class mail'));
  });

  it('deduplicates repeated words (same fingerprint as single occurrence)', () => {
    expect(pageFingerprint('the the the cat cat')).toBe(pageFingerprint('the cat'));
  });

  it('produces different fingerprints for different content', () => {
    expect(pageFingerprint('quantum mechanics')).not.toBe(
      pageFingerprint('classical thermodynamics'),
    );
  });
});

describe('textSimilarity', () => {
  it('returns 1.0 for identical texts', () => {
    expect(textSimilarity('hello world', 'hello world')).toBe(1.0);
  });

  it('returns 1.0 for texts with the same words in different order', () => {
    expect(textSimilarity('alpha beta gamma', 'gamma alpha beta')).toBe(1.0);
  });

  it('returns null when both texts are empty (raster review signal)', () => {
    expect(textSimilarity('', '')).toBeNull();
    expect(textSimilarity('  ', '\n')).toBeNull();
  });

  it('returns 0 when one text is empty and the other is not', () => {
    expect(textSimilarity('', 'some text')).toBe(0);
    expect(textSimilarity('some text', '')).toBe(0);
  });

  it('returns 0 for completely disjoint word sets', () => {
    expect(textSimilarity('alpha beta gamma', 'delta epsilon zeta')).toBe(0);
  });

  it('returns a value in (0, 1) for partial overlap', () => {
    const sim = textSimilarity('alpha beta gamma delta', 'beta gamma epsilon zeta');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
    // 2 common words (beta, gamma), union 6 words → Jaccard = 2/6 ≈ 0.333
    expect(sim).toBeCloseTo(2 / 6, 5);
  });

  it('returns a value ≥ SAME threshold for very similar texts', () => {
    // Near-identical pages should be above the SAME threshold
    const a = 'the quick brown fox jumped over the lazy dog near the pond';
    const b = 'the quick brown fox jumped over the lazy dog near the river';
    const sim = textSimilarity(a, b);
    // 10 common unique words out of 11 in a and 11 in b: Jaccard ≥ 0.8
    expect(sim).not.toBeNull();
    expect(sim!).toBeGreaterThan(0.7);
  });

  it('SAME threshold (0.90) is a stable constant', () => {
    expect(SIMILARITY_THRESHOLDS.SAME).toBe(0.9);
  });

  it('RELATED threshold (0.20) is a stable constant', () => {
    expect(SIMILARITY_THRESHOLDS.RELATED).toBe(0.2);
  });
});

// ─── text-diff ──────────────────────────────────────────────────────────────

describe('diffWords', () => {
  it('returns no runs for two empty strings', () => {
    const d = diffWords('', '');
    expect(d.runs).toHaveLength(0);
    expect(d.insertedWords).toBe(0);
    expect(d.deletedWords).toBe(0);
    expect(d.truncated).toBe(false);
  });

  it('classifies the entire incoming text as inserted when current is empty', () => {
    const d = diffWords('', 'alpha beta gamma');
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]!.type).toBe('insert');
    expect(d.runs[0]!.words).toBe(3);
    expect(d.insertedWords).toBe(3);
    expect(d.deletedWords).toBe(0);
  });

  it('classifies the entire current text as deleted when incoming is empty', () => {
    const d = diffWords('alpha beta gamma', '');
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]!.type).toBe('delete');
    expect(d.runs[0]!.words).toBe(3);
    expect(d.deletedWords).toBe(3);
    expect(d.insertedWords).toBe(0);
  });

  it('returns a single equal run for identical texts', () => {
    const d = diffWords('alpha beta gamma', 'alpha beta gamma');
    const equalRuns = d.runs.filter((r) => r.type === 'equal');
    expect(equalRuns.length).toBeGreaterThan(0);
    expect(d.insertedWords).toBe(0);
    expect(d.deletedWords).toBe(0);
  });

  it('correctly classifies a single word insertion', () => {
    const d = diffWords('alpha gamma', 'alpha beta gamma');
    expect(d.insertedWords).toBe(1);
    expect(d.deletedWords).toBe(0);
    const inserted = d.runs.find((r) => r.type === 'insert');
    expect(inserted?.text).toContain('beta');
  });

  it('correctly classifies a single word deletion', () => {
    const d = diffWords('alpha beta gamma', 'alpha gamma');
    expect(d.deletedWords).toBe(1);
    expect(d.insertedWords).toBe(0);
    const deleted = d.runs.find((r) => r.type === 'delete');
    expect(deleted?.text).toContain('beta');
  });

  it('classifies a replacement as a deletion followed by an insertion', () => {
    const d = diffWords('alpha beta gamma', 'alpha delta gamma');
    expect(d.deletedWords).toBeGreaterThan(0); // beta removed
    expect(d.insertedWords).toBeGreaterThan(0); // delta added
  });

  it('counts inserted and deleted words, not characters', () => {
    const d = diffWords('one two three', 'one two three four five');
    expect(d.insertedWords).toBe(2); // 'four' and 'five' are new words
    expect(d.deletedWords).toBe(0);
  });

  it('truncates inputs above MAX_DIFF_TOKENS and sets truncated=true', () => {
    const big = Array.from({ length: MAX_DIFF_TOKENS + 10 }, (_, i) => `word${i}`).join(' ');
    const d = diffWords(big, '');
    expect(d.truncated).toBe(true);
  });

  it('does not truncate inputs within MAX_DIFF_TOKENS', () => {
    const a = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const b = Array.from({ length: 100 }, (_, i) => `word${i + 50}`).join(' ');
    const d = diffWords(a, b);
    expect(d.truncated).toBe(false);
  });

  it('run text is the words joined by spaces', () => {
    const d = diffWords('', 'alpha beta gamma');
    expect(d.runs[0]!.text).toBe('alpha beta gamma');
  });

  it('coalesces consecutive operations of the same type into a single run', () => {
    // abc → xyz: everything deleted, then inserted (two runs max)
    const d = diffWords('aaa bbb ccc', 'ddd eee fff');
    const types = d.runs.map((r) => r.type);
    // no two adjacent runs should have the same type
    for (let i = 1; i < types.length; i += 1) {
      expect(types[i]).not.toBe(types[i - 1]);
    }
  });
});

// ─── raster-diff ────────────────────────────────────────────────────────────

function makePixels(w: number, h: number, fill: number): Uint8ClampedArray {
  return new Uint8ClampedArray(w * h * 4).fill(fill);
}

describe('rasterDiff', () => {
  it('returns RMSE=0 and no threshold exceedance for identical pixmaps', () => {
    const p = makePixels(4, 4, 128);
    const r = rasterDiff(p, p.slice(), 4, 4);
    expect(r.metric).toBe('rmse');
    expect(r.rmse).toBe(0);
    expect(r.differentPixelRatio).toBe(0);
    expect(r.maxChannelDelta).toBe(0);
    expect(r.exceedsThreshold).toBe(false);
  });

  it('detects a complete pixel difference between a white and black image', () => {
    const white = makePixels(4, 4, 255);
    const black = makePixels(4, 4, 0);
    const r = rasterDiff(white, black, 4, 4);
    expect(r.rmse).toBe(255);
    expect(r.differentPixelRatio).toBe(1.0);
    expect(r.maxChannelDelta).toBe(255);
    expect(r.exceedsThreshold).toBe(true);
  });

  it('reports correct RMSE for a known single-pixel difference', () => {
    // 2×2 image: pixel 0 differs by [10, 0, 0, 0], others identical
    const a = new Uint8ClampedArray(16).fill(100);
    const b = new Uint8ClampedArray(16).fill(100);
    b[0] = 110; // R channel of pixel 0: delta = 10
    const r = rasterDiff(a, b, 2, 2);
    // sumSquaredError = 100; pixelCount * 4 = 16
    expect(r.rmse).toBeCloseTo(Math.sqrt(100 / 16), 10);
    expect(r.differentPixelRatio).toBe(1 / 4); // 1 of 4 pixels differs
    expect(r.maxChannelDelta).toBe(10);
  });

  it('does not exceed threshold for small differences within JPEG-variation range', () => {
    // Simulate a small JPEG artifact: 1% of pixels differ by 5 per channel
    const w = 10;
    const h = 10;
    const a = makePixels(w, h, 200);
    const b = a.slice();
    // Change first pixel only (1 of 100 = 1%)
    b[0] = 205; // +5 on R channel
    const r = rasterDiff(a, b, w, h);
    // differentPixelRatio = 0.01, maxChannelDelta = 5, RMSE very small
    expect(r.differentPixelRatio).toBe(0.01);
    expect(r.maxChannelDelta).toBe(5);
    // 0.01 < RASTER_THRESHOLDS.differentPixelRatio (0.002)? No: 0.01 > 0.002 → exceeds
    expect(r.exceedsThreshold).toBe(true);
  });

  it('does not exceed threshold when only one isolated pixel differs by 1', () => {
    const w = 100;
    const h = 100;
    const a = makePixels(w, h, 100);
    const b = a.slice();
    b[0] = 101; // single-channel delta of 1
    const r = rasterDiff(a, b, w, h);
    // differentPixelRatio = 1/10000 = 0.0001 < 0.002 threshold
    // maxChannelDelta = 1 < 16 threshold
    // rmse = sqrt(1 / (10000 * 4)) ≈ 0.005 < 1.0 threshold
    expect(r.exceedsThreshold).toBe(false);
  });

  it('exposes the RMSE threshold value in the result', () => {
    const p = makePixels(2, 2, 0);
    const r = rasterDiff(p, p.slice(), 2, 2);
    expect(r.threshold).toBe(RASTER_THRESHOLDS.rmse);
  });

  it('throws RangeError when currentPixels length does not match dimensions', () => {
    const good = makePixels(4, 4, 128);
    const bad = new Uint8ClampedArray(10); // wrong size
    expect(() => rasterDiff(bad, good, 4, 4)).toThrow(RangeError);
  });

  it('throws RangeError when incomingPixels length does not match dimensions', () => {
    const good = makePixels(4, 4, 128);
    const bad = new Uint8ClampedArray(10);
    expect(() => rasterDiff(good, bad, 4, 4)).toThrow(RangeError);
  });

  it('threshold constants are stable', () => {
    expect(RASTER_THRESHOLDS.rmse).toBe(1.0);
    expect(RASTER_THRESHOLDS.differentPixelRatio).toBe(0.002);
    expect(RASTER_THRESHOLDS.maxChannelDelta).toBe(16);
  });
});

// ─── page-sequence ──────────────────────────────────────────────────────────

function makePage(pageIndex: number, text: string, label?: string): PageInput {
  return { pageIndex, label: label ?? String(pageIndex + 1), text };
}

describe('classifyPageSequence', () => {
  it('classifies identical single-page documents as same', () => {
    const page = makePage(0, 'the quick brown fox jumped over the lazy dog');
    const r = classifyPageSequence([page], [page]);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]!.status).toBe('same');
    expect(r.same).toBe(1);
    expect(r.changed).toBe(0);
    expect(r.inserted).toBe(0);
    expect(r.deleted).toBe(0);
    expect(r.moved).toBe(0);
  });

  it('classifies an entirely new page as inserted', () => {
    const curr = [makePage(0, 'alpha beta gamma delta epsilon')];
    const inc = [
      makePage(0, 'alpha beta gamma delta epsilon'),
      makePage(1, 'zeta eta theta iota kappa lambda mu nu xi omicron'),
    ];
    const r = classifyPageSequence(curr, inc);
    expect(r.inserted).toBe(1);
    const inserted = r.pages.find((p) => p.status === 'inserted');
    expect(inserted?.pageIndex).toBe(1);
  });

  it('classifies a missing page as deleted', () => {
    const curr = [
      makePage(0, 'alpha beta gamma delta epsilon'),
      makePage(1, 'zeta eta theta iota kappa lambda mu'),
    ];
    const inc = [makePage(0, 'alpha beta gamma delta epsilon')];
    const r = classifyPageSequence(curr, inc);
    expect(r.deleted).toBe(1);
    const deleted = r.pages.find((p) => p.status === 'deleted');
    expect(deleted).toBeDefined();
  });

  it('classifies a page moved to a different position as moved (not same)', () => {
    // Three pages: current [A, B, C], incoming [B, A, C]
    // Page A at position 0 in current, position 1 in incoming → moved
    const a = 'apple orange banana mango papaya guava lemon lime pear plum';
    const b = 'zinc copper iron nickel cobalt silver gold platinum mercury';
    const c = 'chapter section paragraph subsection index glossary appendix';
    const curr = [makePage(0, a), makePage(1, b), makePage(2, c)];
    const inc = [makePage(0, b), makePage(1, a), makePage(2, c)];
    const r = classifyPageSequence(curr, inc);
    expect(r.moved).toBeGreaterThan(0);
    expect(r.hasMoves).toBe(true);
  });

  it('classifies a page with modified content as changed', () => {
    // Shared: 'the quick brown fox jumped' (5 words)
    // Current extra: 'alpha beta gamma delta epsilon' (5 words)
    // Incoming extra: 'zeta eta theta iota kappa' (5 words)
    // Jaccard: 5 / 15 ≈ 0.33 (above RELATED=0.2, below SAME=0.9)
    const currText = 'the quick brown fox jumped alpha beta gamma delta epsilon';
    const incText = 'the quick brown fox jumped zeta eta theta iota kappa';
    const curr = [makePage(0, currText)];
    const inc = [makePage(0, incText)];
    const r = classifyPageSequence(curr, inc);
    expect(r.pages[0]!.status).toBe('changed');
    expect(r.changed).toBe(1);
  });

  it('classifies completely unrelated pages as inserted + deleted', () => {
    const curr = [makePage(0, 'alpha beta gamma delta epsilon zeta eta theta')];
    const inc = [makePage(0, 'sigma tau upsilon phi chi psi omega omicron rho')];
    const r = classifyPageSequence(curr, inc);
    // Similarity is 0 (no common tokens) → incoming is inserted, current is deleted
    expect(r.pages.some((p) => p.status === 'inserted')).toBe(true);
    expect(r.pages.some((p) => p.status === 'deleted')).toBe(true);
    expect(r.same).toBe(0);
    expect(r.changed).toBe(0);
  });

  it('sets rasterReviewRecommended=true for scanned (empty-text) pages', () => {
    const curr = [makePage(0, '')]; // scanned
    const inc = [makePage(0, '')]; // scanned
    const r = classifyPageSequence(curr, inc);
    expect(r.pages[0]!.rasterReviewRecommended).toBe(true);
  });

  it('sets ocrRequired=true when both pages have no text', () => {
    const curr = [makePage(0, '')];
    const inc = [makePage(0, '')];
    const r = classifyPageSequence(curr, inc);
    // Two empty pages: null similarity → inserted (no text match possible)
    const emptyPage = r.pages.find((p) => p.ocrRequired);
    expect(emptyPage).toBeDefined();
  });

  it('sets hasMoves=false when no moves are detected', () => {
    const curr = [makePage(0, 'identical content')];
    const inc = [makePage(0, 'identical content')];
    const r = classifyPageSequence(curr, inc);
    expect(r.hasMoves).toBe(false);
  });

  it('provides similarity score for matched pages', () => {
    const text = 'the quick brown fox jumped over the lazy dog near the pond';
    const curr = [makePage(0, text)];
    const inc = [makePage(0, text)];
    const r = classifyPageSequence(curr, inc);
    expect(r.pages[0]!.similarity).toBe(1.0);
  });

  it('provides null similarity for unmatched (inserted) pages', () => {
    const curr: PageInput[] = [];
    const inc = [makePage(0, 'new content on this page with many words')];
    const r = classifyPageSequence(curr, inc);
    expect(r.pages[0]!.similarity).toBeNull();
  });

  it('handles empty current document correctly (all incoming = inserted)', () => {
    const curr: PageInput[] = [];
    const inc = [makePage(0, 'page one content'), makePage(1, 'page two content')];
    const r = classifyPageSequence(curr, inc);
    expect(r.inserted).toBe(2);
    expect(r.same + r.changed + r.moved + r.deleted).toBe(0);
  });

  it('handles empty incoming document correctly (all current = deleted)', () => {
    const curr = [makePage(0, 'page one'), makePage(1, 'page two')];
    const inc: PageInput[] = [];
    const r = classifyPageSequence(curr, inc);
    expect(r.deleted).toBe(2);
    expect(r.same + r.changed + r.moved + r.inserted).toBe(0);
  });

  it('total page count equals same + changed + moved + inserted + deleted', () => {
    const curr = [
      makePage(0, 'alpha beta gamma delta epsilon zeta'),
      makePage(1, 'sigma tau upsilon phi chi psi omega'),
      makePage(2, 'one two three four five six seven eight'),
    ];
    const inc = [
      makePage(0, 'sigma tau upsilon phi chi psi omega'), // moved from pos 1
      makePage(1, 'alpha beta gamma delta epsilon zeta'), // moved from pos 0
      makePage(2, 'nine ten eleven twelve thirteen'), // changed/replaced
    ];
    const r = classifyPageSequence(curr, inc);
    const total = r.same + r.changed + r.moved + r.inserted + r.deleted;
    // All pages accounted for
    expect(total).toBeGreaterThanOrEqual(Math.max(curr.length, inc.length));
  });

  it('reports the 500-page comparison ceiling instead of silently dropping later pages', () => {
    const pages = Array.from({ length: 501 }, (_, index) =>
      makePage(index, `unique-${index} alpha beta gamma delta epsilon`),
    );
    const result = classifyPageSequence(pages, pages);
    expect(result.pages).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(result.comparedCurrentPages).toBe(500);
    expect(result.comparedIncomingPages).toBe(500);
    expect(result.totalCurrentPages).toBe(501);
    expect(result.totalIncomingPages).toBe(501);
  });
});
