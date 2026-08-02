/**
 * Raster difference metrics for CMPR-004.
 *
 * Computes the RMSE (root mean squared error) and supporting metrics between
 * two same-size RGBA pixmaps. RMSE is the primary named metric because it is
 * a continuous, interpretable measure of per-channel pixel difference.
 *
 * This module is framework-free and has no DOM or Worker API dependency; it
 * operates on Uint8ClampedArray or Uint8Array pixel data passed by the caller.
 *
 * Threshold derivation (CMPR-004)
 * --------------------------------
 * The comparison scenario is: two different PDFs, both rendered by the same
 * MuPDF engine at the same scale and tile settings. Unlike the C8 oracle
 * (MuPDF vs pdf.js, two different renderers), same-engine renders of identical
 * content produce RMSE = 0.0 exactly; the only variation comes from:
 *
 *   (a) Lossy-compressed images embedded in the PDFs (JPEG artifacts may differ
 *       between documents that encode the same visual content at different quality
 *       settings). JPEG coefficient differences typically produce per-channel
 *       deltas of 2–8 and RMSE of 0.1–0.5 over the affected region.
 *
 *   (b) Different rendering resolution between the two documents if page
 *       dimensions differ (handled by requiring caller to match dimensions).
 *
 * The C8 oracle uses these inter-renderer tolerances:
 *   - rmse: 0.1 (MuPDF vs pdf.js)
 *   - differentPixelRatio: 0.0001
 *   - maxChannelDelta: 32
 *
 * These values are NOT changed; they are oracle measurements for a specific test.
 * The RASTER_THRESHOLDS below are independent, derived as follows:
 *
 *   rmse threshold = 1.0
 *     Set at 10× the C8 oracle RMSE ceiling (0.1) to allow for the JPEG
 *     variation described above while flagging any deliberate content change.
 *     An RMSE of 1.0 on a 0–255 scale corresponds to a mean per-channel
 *     difference of ±1 across the entire image, which is only possible if a
 *     large fraction of pixels changed.
 *
 *   differentPixelRatio threshold = 0.002 (0.2%)
 *     Set at 20× the C8 oracle ratio (0.0001) to tolerate scattered JPEG
 *     artifacts (typically <0.05% of pixels) while flagging regions where
 *     a visible proportion of pixels changed.
 *
 *   maxChannelDelta threshold = 16
 *     Set below the C8 oracle maxChannelDelta (32) because same-engine renders
 *     have no renderer-level anti-aliasing difference; a delta of 16+ on a
 *     single pixel channel indicates a non-trivial image difference.
 *
 * A region exceeds the threshold if ANY of the three metrics is above its limit.
 * This is deliberately conservative: a large JPEG artefact that affects many
 * pixels in a concentrated region will be flagged by differentPixelRatio even if
 * the per-pixel RMSE is low.
 *
 * No C8 test parameters are changed. These thresholds are comparison-kernel
 * parameters distinct from the oracle test. See
 * docs/research/2026-08-01-conversion-and-compare.md for the full derivation.
 */

/** Result returned by rasterDiff for a single same-size pixmap pair. */
export interface RasterDiffResult {
  /** The metric name; always 'rmse' for this implementation. */
  readonly metric: 'rmse';
  /** Root mean squared per-channel error (0–255 scale). */
  readonly rmse: number;
  /** Fraction of pixels where at least one channel differs between the two images. */
  readonly differentPixelRatio: number;
  /** Maximum single-channel absolute difference across any pixel. */
  readonly maxChannelDelta: number;
  /**
   * True when the region is materially changed according to RASTER_THRESHOLDS.
   * A true value means the region should be investigated; it does not identify
   * which object changed or how (CMPR-004 DEGRADED limitation).
   */
  readonly exceedsThreshold: boolean;
  /** The RMSE threshold used for the exceedsThreshold decision. */
  readonly threshold: number;
}

/**
 * Raster comparison thresholds for CMPR-004 document comparison.
 *
 * These are NOT the C8 oracle thresholds; they are independent values for
 * comparing two documents rendered by the same engine.
 *
 * Do not change these without updating the derivation in the research doc.
 */
export const RASTER_THRESHOLDS = {
  /** RMSE above this value classifies the region as materially changed. */
  rmse: 1.0,
  /** Fraction of differing pixels above this value triggers the threshold. */
  differentPixelRatio: 0.002,
  /** Maximum single-channel difference above this value triggers the threshold. */
  maxChannelDelta: 16,
} as const;

/**
 * Named limits and degraded-status reason for CMPR-004.
 *
 * Callers that surface this information to users should include the
 * degradedReason so users understand the limits of raster comparison.
 */
export const RASTER_LIMITS = {
  metric: 'rmse' as const,
  /**
   * CMPR-004 is DEGRADED because raster comparison detects that a region
   * changed but cannot identify which object changed or how. Anti-aliasing and
   * resampling differences require a threshold, so both false positives (near-
   * threshold noise classified as a change) and missed subtle changes (below
   * threshold) are expected.
   */
  degradedReason:
    'Raster comparison detects that a region changed, not which object changed or how. ' +
    'The threshold tolerates rendering variation but may miss subtle changes or flag ' +
    'encoding artefacts near the boundary.',
  thresholds: RASTER_THRESHOLDS,
} as const;

/**
 * Compute raster difference metrics between two same-size RGBA pixmaps.
 *
 * Both pixel arrays must represent width × height pixels, 4 bytes per pixel
 * (R, G, B, A channel order). If the arrays have different lengths, or if the
 * stated dimensions are inconsistent with the array lengths, a RangeError is
 * thrown before any computation.
 *
 * @param currentPixels  RGBA data for the current document page tile.
 * @param incomingPixels RGBA data for the incoming document page tile (same dimensions).
 * @param width          Tile width in pixels.
 * @param height         Tile height in pixels.
 * @throws RangeError if pixel array lengths do not match width * height * 4.
 */
export function rasterDiff(
  currentPixels: Uint8ClampedArray | Uint8Array,
  incomingPixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): RasterDiffResult {
  const expected = width * height * 4;
  if (currentPixels.length !== expected) {
    throw new RangeError(
      `rasterDiff: currentPixels has ${currentPixels.length} bytes; ` +
        `expected ${expected} for ${width}×${height} RGBA.`,
    );
  }
  if (incomingPixels.length !== expected) {
    throw new RangeError(
      `rasterDiff: incomingPixels has ${incomingPixels.length} bytes; ` +
        `expected ${expected} for ${width}×${height} RGBA.`,
    );
  }

  const pixelCount = width * height;
  let sumSquaredError = 0;
  let differentPixels = 0;
  let maxChannelDelta = 0;

  for (let p = 0; p < pixelCount; p += 1) {
    const base = p * 4;
    let pixelHasDiff = false;

    for (let ch = 0; ch < 4; ch += 1) {
      const delta = Math.abs(
        (currentPixels[base + ch] ?? 0) - (incomingPixels[base + ch] ?? 0),
      );
      if (delta > 0) pixelHasDiff = true;
      if (delta > maxChannelDelta) maxChannelDelta = delta;
      sumSquaredError += delta * delta;
    }

    if (pixelHasDiff) differentPixels += 1;
  }

  // channels = 4 (RGBA); RMSE is over all channel samples
  const rmse = Math.sqrt(sumSquaredError / (pixelCount * 4));
  const differentPixelRatio = pixelCount > 0 ? differentPixels / pixelCount : 0;

  const exceedsThreshold =
    rmse > RASTER_THRESHOLDS.rmse ||
    differentPixelRatio > RASTER_THRESHOLDS.differentPixelRatio ||
    maxChannelDelta > RASTER_THRESHOLDS.maxChannelDelta;

  return {
    metric: 'rmse',
    rmse,
    differentPixelRatio,
    maxChannelDelta,
    exceedsThreshold,
    threshold: RASTER_THRESHOLDS.rmse,
  };
}
