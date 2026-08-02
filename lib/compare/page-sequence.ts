/**
 * Page sequence classification for CMPR-005.
 *
 * Classifies each page in an incoming document as:
 *   - 'same'     – same content, same position
 *   - 'changed'  – related content, same position (modified page)
 *   - 'moved'    – same or related content, different position (page reordered)
 *   - 'inserted' – content present in incoming but not matched in current
 *   - 'deleted'  – content present in current but not matched in incoming
 *
 * These five statuses are distinct from the four-value status in the engine's
 * CompareResult type (same/changed/added/removed), which does not detect moves.
 * Full integration requires a driver update to port.ts and doc-runtime.ts.
 * See docs/research/2026-08-01-conversion-and-compare.md §Driver Integration.
 *
 * Algorithm
 * ---------
 * 1. Compute Jaccard similarity for every (current, incoming) page pair that
 *    both have extractable text. O(n²) pairs, each O(|words|) computation.
 *
 * 2. Collect all pairs whose similarity ≥ RELATED threshold (0.20) into a
 *    candidate list, sorted by similarity descending.
 *
 * 3. Greedy assignment: take the highest-similarity unmatched pair, record
 *    the match, repeat until the candidate list is exhausted.
 *
 * 4. Classify each matched pair:
 *    - similarity ≥ SAME (0.90) AND same position → 'same'
 *    - similarity ≥ SAME (0.90) AND different position → 'moved'
 *    - similarity < SAME AND same position → 'changed'
 *    - similarity < SAME AND different position → 'moved' (with changes)
 *
 * 5. Unmatched incoming pages → 'inserted'
 *    Unmatched current pages → 'deleted'
 *
 * The greedy algorithm is not optimal (the optimal bipartite matching would
 * maximise total similarity), but it is deterministic and correct for the common
 * case. For documents where multiple pages share a vocabulary (e.g. multi-chapter
 * books with repeated headings), the greedy approach may produce sub-optimal
 * assignments, which is why CMPR-005 is marked DEGRADED.
 *
 * Scanned pages (no extractable text)
 * ------------------------------------
 * Pages with no text produce null similarity. They are never matched through the
 * similarity matrix. Their classification is 'inserted'/'deleted' with
 * ocrRequired=true, indicating that a meaningful comparison requires OCR output.
 * This dependency is stated explicitly (CMPR-009 DEGRADED).
 *
 * Performance
 * -----------
 * MAX_COMPARABLE_PAGES caps the page slice to 500. For 500×500 pairs with
 * average 300 words per page, the similarity computation is ~75M token lookups.
 * Set<string>.has() is O(1) amortized, so the wall time is typically <500ms.
 * For typical documents (≤50 pages), computation is negligible.
 */

import { textSimilarity, SIMILARITY_THRESHOLDS } from './fingerprint.ts';

/** Classification status for a single page in the sequence comparison. */
export type PageChangeType = 'same' | 'changed' | 'moved' | 'inserted' | 'deleted';

/** A visually changed page is never reported as same, regardless of text similarity. */
export function reconcileVisualChange(
  status: PageChangeType,
  rasterExceedsThreshold: boolean,
): PageChangeType {
  return status === 'same' && rasterExceedsThreshold ? 'changed' : status;
}

/** Input descriptor for one page in a document. */
export interface PageInput {
  /** 0-based page index within the document. */
  readonly pageIndex: number;
  /** User-visible page label (Arabic numeral, Roman numeral, or letter). */
  readonly label: string;
  /**
   * Extracted structured text for the page.
   * An empty string means no extractable text (scanned or image-only page).
   */
  readonly text: string;
}

/** Classification result for one page. */
export interface PageClassification {
  /**
   * Page index in the INCOMING document for inserted/moved/same/changed pages.
   * Page index in the CURRENT document for deleted pages.
   */
  readonly pageIndex: number;
  /**
   * Corresponding page index in the current document.
   * Undefined for purely inserted pages.
   */
  readonly currentPageIndex?: number;
  /** Classification result. */
  readonly status: PageChangeType;
  /** Label from the current document page, when matched. */
  readonly currentLabel?: string;
  /** Label from the incoming document page, when present. */
  readonly incomingLabel?: string;
  /**
   * Jaccard similarity score [0, 1] for matched pairs.
   * Null for unmatched pages (inserted/deleted) or when both pages lack text.
   */
  readonly similarity: number | null;
  /**
   * True when one or both matched pages have no extractable text. These pages
   * need raster-based comparison to determine whether content changed.
   */
  readonly rasterReviewRecommended: boolean;
  /**
   * True when BOTH pages have no extractable text. The comparison result for
   * these pages is unreliable without OCR. The kernel cannot perform OCR;
   * this flag is the caller's signal to attempt it (CMPR-009 DEGRADED).
   */
  readonly ocrRequired: boolean;
}

/** Full sequence comparison result. */
export interface SequenceResult {
  readonly pages: readonly PageClassification[];
  readonly same: number;
  readonly changed: number;
  readonly inserted: number;
  readonly deleted: number;
  readonly moved: number;
  /**
   * Whether move detection found any moved pages. If false, no pages were
   * reclassified from 'same' or 'changed' to 'moved'.
   */
  readonly hasMoves: boolean;
  readonly truncated: boolean;
  readonly comparedCurrentPages: number;
  readonly comparedIncomingPages: number;
  readonly totalCurrentPages: number;
  readonly totalIncomingPages: number;
}

/** Maximum pages from each document considered in the similarity matrix. */
const MAX_COMPARABLE_PAGES = 500;

/**
 * Classify the page sequence of an incoming document against the current document.
 *
 * @param currentPages  Pages of the document currently open in the editor.
 * @param incomingPages Pages of the document being compared against.
 * @returns SequenceResult with per-page classifications and summary counts.
 */
export function classifyPageSequence(
  currentPages: readonly PageInput[],
  incomingPages: readonly PageInput[],
): SequenceResult {
  const curr = currentPages.slice(0, MAX_COMPARABLE_PAGES);
  const inc = incomingPages.slice(0, MAX_COMPARABLE_PAGES);

  // Build similarity candidates (all pairs above RELATED threshold)
  type Candidate = { readonly sim: number; readonly ci: number; readonly ii: number };
  const candidates: Candidate[] = [];

  for (let ci = 0; ci < curr.length; ci += 1) {
    for (let ii = 0; ii < inc.length; ii += 1) {
      const sim = textSimilarity(curr[ci]!.text, inc[ii]!.text);
      // null means both empty; 0 means one empty → neither qualifies
      if (sim !== null && sim >= SIMILARITY_THRESHOLDS.RELATED) {
        candidates.push({ sim, ci, ii });
      }
    }
  }

  // Greedy assignment: highest-similarity first
  candidates.sort((a, b) => b.sim - a.sim);

  const matchedCurrent = new Set<number>();
  const matchedIncoming = new Set<number>();
  // Maps incoming index → { currentIndex, similarity }
  const assignment = new Map<number, { ci: number; sim: number }>();

  for (const { sim, ci, ii } of candidates) {
    if (matchedCurrent.has(ci) || matchedIncoming.has(ii)) continue;
    matchedCurrent.add(ci);
    matchedIncoming.add(ii);
    assignment.set(ii, { ci, sim });
  }

  const pages: PageClassification[] = [];
  let same = 0;
  let changed = 0;
  let inserted = 0;
  let deleted = 0;
  let moved = 0;

  // Classify incoming pages
  for (let ii = 0; ii < inc.length; ii += 1) {
    const incPage = inc[ii]!;
    const match = assignment.get(ii);

    if (match === undefined) {
      // No text-based match found
      const noText = !incPage.text.trim();
      pages.push({
        pageIndex: ii,
        status: 'inserted',
        incomingLabel: incPage.label,
        similarity: null,
        rasterReviewRecommended: noText,
        ocrRequired: noText,
      });
      inserted += 1;
    } else {
      const { ci, sim } = match;
      const currPage = curr[ci]!;
      const noCurrentText = !currPage.text.trim();
      const noIncomingText = !incPage.text.trim();
      const rasterReviewRecommended = noCurrentText || noIncomingText;
      const ocrRequired = noCurrentText && noIncomingText;

      let status: PageChangeType;
      if (sim >= SIMILARITY_THRESHOLDS.SAME) {
        status = ci === ii ? 'same' : 'moved';
      } else {
        // Below SAME threshold: content has changed
        // If the position also changed, it is a moved+changed page; we classify
        // as 'moved' to surface the relocation, which is the more surprising fact.
        status = ci === ii ? 'changed' : 'moved';
      }

      if (status === 'same') same += 1;
      else if (status === 'changed') changed += 1;
      else moved += 1;

      pages.push({
        pageIndex: ii,
        currentPageIndex: ci,
        status,
        currentLabel: currPage.label,
        incomingLabel: incPage.label,
        similarity: sim,
        rasterReviewRecommended,
        ocrRequired,
      });
    }
  }

  // Classify unmatched current pages as deleted
  for (let ci = 0; ci < curr.length; ci += 1) {
    if (!matchedCurrent.has(ci)) {
      const currPage = curr[ci]!;
      const noText = !currPage.text.trim();
      pages.push({
        pageIndex: ci,
        currentPageIndex: ci,
        status: 'deleted',
        currentLabel: currPage.label,
        similarity: null,
        rasterReviewRecommended: noText,
        ocrRequired: noText,
      });
      deleted += 1;
    }
  }

  // Sort output: incoming pages in order, then deleted pages
  pages.sort((a, b) => {
    const aIsDeleted = a.status === 'deleted';
    const bIsDeleted = b.status === 'deleted';
    if (aIsDeleted !== bIsDeleted) return aIsDeleted ? 1 : -1;
    return a.pageIndex - b.pageIndex;
  });

  return {
    pages,
    same,
    changed,
    inserted,
    deleted,
    moved,
    hasMoves: moved > 0,
    truncated: curr.length < currentPages.length || inc.length < incomingPages.length,
    comparedCurrentPages: curr.length,
    comparedIncomingPages: inc.length,
    totalCurrentPages: currentPages.length,
    totalIncomingPages: incomingPages.length,
  };
}
