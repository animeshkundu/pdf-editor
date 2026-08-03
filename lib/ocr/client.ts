import { budgetFor } from '../core/limits';
import type { EngineTypes } from '../engine/port';

export interface OcrResult {
  readonly available: true;
  readonly text: string;
  readonly confidence: number;
  readonly blocks: readonly {
    readonly text: string;
    readonly confidence: number;
    readonly bounds: readonly [number, number, number, number];
  }[];
  readonly words: readonly {
    readonly text: string;
    readonly confidence: number;
    readonly bounds: readonly [number, number, number, number];
  }[];
  readonly searchablePdf?: ArrayBuffer;
}

export interface OcrRecognitionData {
  readonly text: string;
  readonly confidence: number;
  readonly pdf: readonly number[] | null;
  readonly blocks:
    | readonly {
        readonly text: string;
        readonly confidence: number;
        readonly bbox: {
          readonly x0: number;
          readonly y0: number;
          readonly x1: number;
          readonly y1: number;
        };
        readonly paragraphs: readonly {
          readonly lines: readonly {
            readonly words: readonly {
              readonly text: string;
              readonly confidence: number;
              readonly bbox: {
                readonly x0: number;
                readonly y0: number;
                readonly x1: number;
                readonly y1: number;
              };
            }[];
          }[];
        }[];
      }[]
    | null;
}

const OCR_WORKER = `ocr/tesseract-${__TESSERACT_VERSION__}/worker.min.js`;
const OCR_CORE = `ocr/tesseract-${__TESSERACT_CORE_VERSION__}`;
const OCR_LANGUAGE = `ocr/eng-${__TESSERACT_LANGUAGE_VERSION__}`;
export const MAX_OCR_CANVAS_SIDE = 16_384;

export function ownOriginAsset(
  path: string,
  base = import.meta.env.BASE_URL,
  origin = window.location.origin,
): string {
  const asset = new URL(`${base}${path}`, origin);
  if (asset.origin !== origin) {
    throw new Error(`Local OCR refused an asset from ${asset.origin}.`);
  }
  return asset.href;
}

function bounds(bbox: {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}): readonly [number, number, number, number] {
  return [bbox.x0, bbox.y0, bbox.x1, bbox.y1];
}

export function projectOcrRenderSize(
  page: { readonly width: number; readonly height: number },
  maxRenderPixels: number,
): { readonly scale: number; readonly width: number; readonly height: number } {
  for (const [dimension, value] of [
    ['width', page.width],
    ['height', page.height],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Invalid OCR page ${dimension} ${String(value)}; it must be finite and greater than zero.`,
      );
    }
  }
  const pixelBudget = Math.max(1, Math.floor(maxRenderPixels * 0.9));
  const areaScale = Math.sqrt(pixelBudget) / Math.sqrt(page.width) / Math.sqrt(page.height);
  const sideScale = MAX_OCR_CANVAS_SIDE / Math.max(page.width, page.height);
  const scale = Math.min(3, areaScale, sideScale);
  return {
    scale,
    width: Math.max(1, Math.floor(page.width * scale)),
    height: Math.max(1, Math.floor(page.height * scale)),
  };
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (
    (reason instanceof DOMException || reason instanceof Error) &&
    reason.name === 'AbortError'
  ) {
    return reason;
  }
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason
        ? reason
        : 'The operation was cancelled.';
  return new DOMException(message, 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
  );
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

type OcrEngine = Pick<EngineTypes['PdfEngine'], 'info' | 'renderTile'>;

interface ActiveRecognition {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

let activeRecognition: ActiveRecognition | undefined;

export function projectOcrResult(data: OcrRecognitionData): OcrResult {
  const blocks = (data.blocks ?? [])
    .filter((block) => block.text.trim())
    .map((block) => ({
      text: block.text,
      confidence: block.confidence,
      bounds: bounds(block.bbox),
    }));
  const words = (data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) =>
        line.words
          .filter((word) => word.text.trim())
          .map((word) => ({
            text: word.text,
            confidence: word.confidence,
            bounds: bounds(word.bbox),
          })),
      ),
    ),
  );
  return {
    available: true,
    text: data.text,
    confidence: data.confidence,
    blocks,
    words,
    ...(data.pdf ? { searchablePdf: Uint8Array.from(data.pdf).buffer } : {}),
  };
}

export function browserOcrDescription(): {
  readonly likelyAvailable: boolean;
  readonly description: string;
} {
  const likelyAvailable =
    typeof window !== 'undefined' &&
    typeof Worker === 'function' &&
    typeof WebAssembly === 'object';
  return {
    likelyAvailable,
    description: likelyAvailable
      ? 'Cross-browser English OCR runs locally with a bundled Tesseract LSTM engine. The engine and model load from this origin only when you start recognition; document pixels never leave the browser.'
      : 'OCR needs a browser with Web Workers and WebAssembly. The bundled engine is not loaded until recognition starts.',
  };
}

async function performRecognition(
  engine: OcrEngine,
  pageIndex: number,
  signal: AbortSignal,
): Promise<OcrResult> {
  throwIfAborted(signal);
  const page = engine.info.pages[pageIndex];
  if (!page) throw new Error(`Page ${pageIndex + 1} is outside this document.`);

  const { scale, width, height } = projectOcrRenderSize(
    page,
    budgetFor(navigator).maxRenderPixels,
  );

  const canvas = document.createElement('canvas');
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create the local OCR canvas.');
    for (let y = 0; y < height; y += 512) {
      for (let x = 0; x < width; x += 512) {
        throwIfAborted(signal);
        const tileWidth = Math.min(512, width - x);
        const tileHeight = Math.min(512, height - y);
        let tile: EngineTypes['TileResult'] | undefined = await engine.renderTile(
          {
            pageIndex,
            scale,
            x,
            y,
            width: tileWidth,
            height: tileHeight,
            priority: Number.MAX_SAFE_INTEGER,
          },
          signal,
        );
        try {
          throwIfAborted(signal);
          context.putImageData(
            new ImageData(
              new Uint8ClampedArray(tile.pixels, 0, tile.width * tile.height * 4),
              tile.width,
              tile.height,
            ),
            x,
            y,
          );
        } finally {
          tile = undefined;
        }
      }
    }

    const { createWorker, OEM } = (await import('tesseract.js/dist/tesseract.esm.min.js'))
      .default;
    throwIfAborted(signal);
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: ownOriginAsset(OCR_WORKER),
      corePath: ownOriginAsset(OCR_CORE),
      langPath: ownOriginAsset(OCR_LANGUAGE),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      legacyCore: false,
      legacyLang: false,
    });
    let outcome:
      | { readonly ok: true; readonly value: OcrResult }
      | { readonly ok: false; readonly error: unknown };
    try {
      throwIfAborted(signal);
      const recognized = await awaitWithAbort(
        worker.recognize(
          canvas,
          {
            pdfTitle: `${engine.info.title || engine.info.name} — page ${pageIndex + 1}`,
            pdfTextOnly: false,
          },
          { text: true, blocks: true, pdf: true },
        ),
        signal,
      );
      throwIfAborted(signal);
      outcome = { ok: true, value: projectOcrResult(recognized.data) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    try {
      await worker.terminate();
    } catch (error) {
      if (outcome.ok) throw error;
      console.error('Local OCR could not finish terminating its worker.', error);
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function recognizePage(
  engine: OcrEngine,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<OcrResult> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  const controller = new AbortController();
  const previous = activeRecognition;
  previous?.controller.abort(
    new DOMException('Superseded by a newer OCR recognition.', 'AbortError'),
  );

  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const current = { controller, done };
  activeRecognition = current;

  const forwardAbort = () => controller.abort(signal ? abortReason(signal) : undefined);
  signal?.addEventListener('abort', forwardAbort, { once: true });

  return (async () => {
    try {
      await previous?.done;
      throwIfAborted(controller.signal);
      return await performRecognition(engine, pageIndex, controller.signal);
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      if (activeRecognition === current) activeRecognition = undefined;
      finish();
    }
  })();
}

export default { recognizePage, browserOcrDescription };
