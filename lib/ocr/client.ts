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

function ownOriginAsset(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.origin).href;
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
  const pixelBudget = Math.max(1, Math.floor(maxRenderPixels * 0.9));
  const scale = Math.min(3, Math.sqrt(pixelBudget / (page.width * page.height)));
  return {
    scale,
    width: Math.max(1, Math.floor(page.width * scale)),
    height: Math.max(1, Math.floor(page.height * scale)),
  };
}

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

export async function recognizePage(
  engine: EngineTypes['PdfEngine'],
  pageIndex: number,
): Promise<OcrResult> {
  const page = engine.info.pages[pageIndex];
  if (!page) throw new Error(`Page ${pageIndex + 1} is outside this document.`);

  const { scale, width, height } = projectOcrRenderSize(
    page,
    budgetFor(navigator).maxRenderPixels,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create the local OCR canvas.');
  for (let y = 0; y < height; y += 512) {
    for (let x = 0; x < width; x += 512) {
      const tileWidth = Math.min(512, width - x);
      const tileHeight = Math.min(512, height - y);
      const tile = await engine.renderTile({
        pageIndex,
        scale,
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        priority: Number.MAX_SAFE_INTEGER,
      });
      context.putImageData(
        new ImageData(new Uint8ClampedArray(tile.pixels), tile.width, tile.height),
        x,
        y,
      );
    }
  }

  const { createWorker, OEM } = (await import('tesseract.js/dist/tesseract.esm.min.js'))
    .default;
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
  try {
    const recognized = await worker.recognize(
      canvas,
      {
        pdfTitle: `${engine.info.title || engine.info.name} — page ${pageIndex + 1}`,
        pdfTextOnly: false,
      },
      { text: true, blocks: true, pdf: true },
    );
    return projectOcrResult(recognized.data);
  } finally {
    await worker.terminate();
  }
}

export default { recognizePage, browserOcrDescription };
