import type { EngineTypes } from '../engine/port';

export interface OcrResult {
  readonly available: boolean;
  readonly text: string;
  readonly blocks: readonly {
    readonly text: string;
    readonly bounds?: readonly [number, number, number, number];
  }[];
  readonly reason?: string;
}

type OcrResponse =
  | { readonly id: number; readonly ok: true; readonly value: OcrResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

/**
 * Describes on-device OCR availability in the current browser environment.
 *
 * TextDetector is a Chromium-origin API (Shape Detection API). As of the
 * supported browser floor (Chrome 95, Firefox 131, Safari 15.2):
 *   - Chrome/Chromium/Edge: TextDetector is available when the platform
 *     provides an on-device text recognition engine (typically desktop and
 *     mobile Chrome on supported OS versions).
 *   - Firefox 131+: TextDetector is not available. The API was never shipped
 *     in Firefox's release channel.
 *   - Safari 15.2+: TextDetector is not available. Safari does not implement
 *     the Shape Detection API.
 *
 * The authoritative availability check happens inside the OCR worker, where
 * `typeof TextDetector !== 'undefined'` is the only reliable test. This
 * function provides a synchronous pre-flight description for UI rendering.
 *
 * No OCR model is downloaded and no data leaves the device. The application
 * has zero egress (ADR 0002). If TextDetector is absent, no fallback model
 * is available because loading one would require adding a dependency or a
 * remote asset, neither of which is permitted.
 */
export function browserOcrDescription(): {
  /** Heuristic: likely available based on user-agent string parsing. */
  readonly likelyAvailable: boolean;
  /** Human-readable description for display in the conversion panel. */
  readonly description: string;
} {
  const detector = (globalThis as { TextDetector?: unknown }).TextDetector;
  if (typeof detector === 'function') {
    return {
      likelyAvailable: true,
      description:
        'On-device text recognition is available in this browser. ' +
        'It uses the installed platform model; no data leaves the device.',
    };
  }
  if (typeof navigator === 'undefined') {
    return {
      likelyAvailable: false,
      description: 'OCR availability unknown (no navigator context).',
    };
  }
  const ua = navigator.userAgent;
  const isChromiumFamily =
    /Chrome\/|Chromium\/|Edg\/|EdgA\/|EdgHTML\//.test(ua) && !/Firefox\//.test(ua);
  if (isChromiumFamily) {
    return {
      likelyAvailable: false,
      description:
        'This Chromium runtime does not provide an installed TextDetector model. ' +
        'No OCR model is downloaded because the application has zero egress (ADR 0002).',
    };
  }
  return {
    likelyAvailable: false,
    description:
      'On-device text recognition is unavailable in this browser. ' +
      'TextDetector is a Chromium-only API not implemented in Firefox or Safari. ' +
      'No OCR model is downloaded because the application has zero egress (ADR 0002).',
  };
}

export async function recognizePage(
  engine: EngineTypes['PdfEngine'],
  pageIndex: number,
): Promise<OcrResult> {
  const page = engine.info.pages[pageIndex];
  if (!page) throw new Error(`Page ${pageIndex + 1} is outside this document.`);
  const scale = Math.min(1, 512 / Math.max(page.width, page.height));
  const width = Math.max(1, Math.ceil(page.width * scale));
  const height = Math.max(1, Math.ceil(page.height * scale));
  const tile = await engine.renderTile({
    pageIndex,
    scale,
    x: 0,
    y: 0,
    width,
    height,
    priority: 0,
  });
  const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<OcrResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('The local OCR worker did not respond in time.'));
      }, 30_000);
      worker.addEventListener(
        'message',
        (event: MessageEvent<OcrResponse>) => {
          window.clearTimeout(timeout);
          if (event.data.ok) resolve(event.data.value);
          else reject(new Error(event.data.error));
        },
        { once: true },
      );
      worker.addEventListener(
        'error',
        () => {
          window.clearTimeout(timeout);
          reject(new Error('The local OCR worker stopped unexpectedly.'));
        },
        { once: true },
      );
      worker.postMessage(
        {
          id: 1,
          pixels: tile.pixels,
          width: tile.width,
          height: tile.height,
        },
        [tile.pixels],
      );
    });
  } finally {
    worker.terminate();
  }
}

export default { recognizePage, browserOcrDescription };
