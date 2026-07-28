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

export default { recognizePage };
