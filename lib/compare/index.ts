/**
 * Framework-free comparison kernel for CMPR-001 through CMPR-009.
 *
 * All exports are pure functions over plain values; no DOM, Worker, or React
 * API is used. The kernel is suitable for use in doc.worker, search.worker,
 * or any test environment.
 *
 * For driver integration requirements (what must change in doc-runtime.ts and
 * port.ts to surface the full capability), see:
 *   docs/research/2026-08-01-conversion-and-compare.md §Driver Integration
 */

export { pageFingerprint, textSimilarity, SIMILARITY_THRESHOLDS } from './fingerprint.ts';

export {
  diffWords,
  MAX_DIFF_TOKENS,
  type TextDiff,
  type TextRun,
  type TextRunType,
} from './text-diff.ts';

export {
  rasterDiff,
  RASTER_THRESHOLDS,
  RASTER_LIMITS,
  type RasterDiffResult,
} from './raster-diff.ts';

export {
  classifyPageSequence,
  type PageChangeType,
  type PageClassification,
  type PageInput,
  type SequenceResult,
} from './page-sequence.ts';
