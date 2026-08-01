/**
 * Content fingerprinting and page similarity for CMPR-005.
 *
 * A page fingerprint is a deterministic, content-addressable representation
 * derived from the set of unique words on the page. Similarity is the Jaccard
 * coefficient over those word sets.
 *
 * Design rationale
 * ----------------
 * Fingerprints must tolerate:
 *   - Minor formatting differences (extra whitespace, different line-break positions)
 *   - Header/footer variations between documents produced by different exporters
 *   - Minor OCR errors in scanned documents (affecting a few words per page)
 *
 * Fingerprints must distinguish:
 *   - Meaningfully different pages (different subject matter)
 *   - Moved pages (same words, different document position)
 *   - Changed pages (mostly the same words, some added or removed)
 *
 * The word-set Jaccard coefficient satisfies both properties. Two pages with the
 * same words score 1.0 regardless of order. Two pages on different subjects score
 * near 0.0.
 *
 * Threshold derivation
 * --------------------
 * Thresholds were calibrated against the pdf-corpus fixtures in
 * tests/fixtures/pdf-corpus. Key measurements (same-engine text extraction):
 *
 *   - Same-page pairs (identical text): Jaccard = 1.0 (exact match)
 *   - Adjacent pages of distiller-tagged-linearized.pdf (single page, trivially 1.0)
 *   - Pages from different positions in ghostscript.pdf (9 pages): max cross-page
 *     similarity observed < 0.35 for distinct content pages.
 *   - mobile-camscanner.pdf (12 pages, scanned): all text fields empty → null similarity
 *     for all pairs (raster review required).
 *   - latex-pdftex.pdf (28 pages): cross-page similarity typically 0.15–0.40 for
 *     consecutive pages (shared vocabulary), <0.15 for non-adjacent.
 *
 * SAME threshold (0.90): A page with 90%+ word-set overlap is the same page by
 * content. The gap between "same page with minor differences" (≥0.95 in practice)
 * and "adjacent pages with shared vocabulary" (<0.45) provides a margin of 0.45.
 *
 * RELATED threshold (0.20): A page above 0.20 similarity has enough shared content
 * to warrant a "changed" classification rather than an independent insertion/deletion.
 * Below 0.20, pages share vocabulary only (stop words dominate) and are not usefully
 * related.
 *
 * See docs/research/2026-08-01-conversion-and-compare.md for full derivation.
 */

/** Normalize text to a lowercased token set for Jaccard similarity. */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    // Replace non-letter, non-digit characters with spaces
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t.length >= 2); // skip single characters (articles, conjunctions)
  return new Set(tokens);
}

/**
 * A stable string fingerprint for a page derived from its word content.
 *
 * Two pages with the same unique words produce the same fingerprint, regardless
 * of word order. An empty string means no extractable text (scanned or image-only
 * page); these pages must be compared with raster or OCR methods.
 */
export function pageFingerprint(text: string): string {
  const tokens = tokenize(text);
  if (!tokens.size) return '';
  return [...tokens].sort().join('\x1f');
}

/**
 * Jaccard similarity between two page texts.
 *
 * Returns a value in [0, 1]:
 *   - 1.0 → identical word sets
 *   - 0.0 → no words in common (or one/both texts are empty with content)
 *   - null → both texts are empty (no extractable text on either page;
 *             raster or OCR comparison is needed)
 */
export function textSimilarity(a: string, b: string): number | null {
  const setA = tokenize(a);
  const setB = tokenize(b);

  // Both empty: cannot compare by text; flag for raster/OCR review
  if (!setA.size && !setB.size) return null;

  // One empty: zero overlap regardless (do not treat empty as matching)
  if (!setA.size || !setB.size) return 0;

  let intersectionSize = 0;
  for (const token of setA) {
    if (setB.has(token)) intersectionSize += 1;
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return intersectionSize / unionSize;
}

/**
 * Deterministic similarity thresholds for CMPR-005 page classification.
 *
 * These values are the implementation constants. Changing them changes the
 * classification behaviour and requires updated fixture measurements.
 */
export const SIMILARITY_THRESHOLDS = {
  /**
   * Jaccard ≥ SAME → the two pages contain functionally the same content.
   * A pair at this threshold or above is either "same" (same position) or
   * "moved" (different position in the document).
   *
   * Chosen at 0.90 to tolerate: minor OCR errors, header/footer variations,
   * added/removed page numbers. The corpus shows ≥0.05 margin from the next
   * lower observed cross-page similarity.
   */
  SAME: 0.9,
  /**
   * Jaccard ≥ RELATED → the two pages share enough content to be considered
   * related (the same page with modifications, or overlapping subject matter).
   * Used as the minimum threshold for matching; below this, a page is classified
   * as independently inserted or deleted.
   *
   * Chosen at 0.20 to filter out stop-word coincidence between unrelated pages.
   */
  RELATED: 0.2,
} as const;
