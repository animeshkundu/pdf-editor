// @vitest-environment jsdom

import type { EngineTypes } from '@/lib/engine/port';
import { recognizePage } from '@/lib/ocr/client';

const tesseract = vi.hoisted(() => ({
  createWorker: vi.fn(),
}));

vi.mock('tesseract.js/dist/tesseract.esm.min.js', () => ({
  default: {
    createWorker: tesseract.createWorker,
    OEM: { LSTM_ONLY: 1 },
  },
}));

const recognitionData = {
  text: 'recognized',
  confidence: 90,
  pdf: null,
  blocks: [],
};

function abortError(message = 'cancelled'): DOMException {
  return new DOMException(message, 'AbortError');
}

function makeEngine(
  renderTile: EngineTypes['PdfEngine']['renderTile'] = async (request) => ({
    ...request,
    pixels: new Uint8ClampedArray(request.width * request.height * 4).buffer,
  }),
  page = { width: 2, height: 2 },
): EngineTypes['PdfEngine'] {
  return {
    info: {
      name: 'scan.pdf',
      title: 'Scan',
      pages: [
        {
          index: 0,
          label: '1',
          bounds: [0, 0, page.width, page.height],
          width: page.width,
          height: page.height,
        },
      ],
      outline: [],
      attachments: [],
      permissions: { copy: true, print: true, annotate: true },
    },
    renderTile,
  } as unknown as EngineTypes['PdfEngine'];
}

async function until(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await Promise.resolve();
    }
  }
  assertion();
}

describe('OCR cancellation and single-flight', () => {
  beforeEach(() => {
    tesseract.createWorker.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
        ) {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('honors an already-aborted signal before allocating OCR resources', async () => {
    const controller = new AbortController();
    controller.abort(abortError());

    await expect(recognizePage(makeEngine(), 0, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(tesseract.createWorker).not.toHaveBeenCalled();
  });

  it('passes cancellation through the tile loop and releases the canvas', async () => {
    let finishTile: (() => void) | undefined;
    const renderTile = vi.fn<EngineTypes['PdfEngine']['renderTile']>(
      (request, signal) =>
        new Promise((resolve, reject) => {
          finishTile = () => {
            if (signal?.aborted) reject(signal.reason ?? abortError());
            else {
              resolve({
                ...request,
                pixels: new Uint8ClampedArray(request.width * request.height * 4).buffer,
              });
            }
          };
        }),
    );
    const controller = new AbortController();
    const createElement = vi.spyOn(document, 'createElement');
    tesseract.createWorker.mockResolvedValue({
      recognize: vi.fn(async () => ({ data: recognitionData })),
      terminate: vi.fn(async () => undefined),
    });

    const recognition = recognizePage(
      makeEngine(renderTile, { width: 200, height: 200 }),
      0,
      controller.signal,
    );
    await until(() => expect(renderTile).toHaveBeenCalledOnce());
    controller.abort(abortError());
    finishTile?.();

    await expect(recognition).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderTile).toHaveBeenCalledOnce();
    expect(tesseract.createWorker).not.toHaveBeenCalled();
    const canvas = createElement.mock.results.find(
      ({ value }) => value instanceof HTMLCanvasElement,
    )?.value as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('terminates a worker created after cancellation without starting recognition', async () => {
    let finishCreate: ((worker: unknown) => void) | undefined;
    const recognize = vi.fn(async () => ({ data: recognitionData }));
    const terminate = vi.fn(async () => undefined);
    tesseract.createWorker.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve;
        }),
    );
    const controller = new AbortController();
    const recognition = recognizePage(makeEngine(), 0, controller.signal);
    await until(() => expect(tesseract.createWorker).toHaveBeenCalledOnce());

    controller.abort(abortError());
    finishCreate?.({ recognize, terminate });

    await expect(recognition).rejects.toMatchObject({ name: 'AbortError' });
    expect(recognize).not.toHaveBeenCalled();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('terminates active recognition on abort before its result settles', async () => {
    let finishRecognition: ((value: { data: typeof recognitionData }) => void) | undefined;
    const recognize = vi.fn(
      () =>
        new Promise<{ data: typeof recognitionData }>((resolve) => {
          finishRecognition = resolve;
        }),
    );
    const terminate = vi.fn(async () => undefined);
    tesseract.createWorker.mockResolvedValue({ recognize, terminate });
    const controller = new AbortController();
    const recognition = recognizePage(makeEngine(), 0, controller.signal);
    await until(() => expect(recognize).toHaveBeenCalledOnce());

    controller.abort(abortError());
    await until(() => expect(terminate).toHaveBeenCalledOnce());
    finishRecognition?.({ data: recognitionData });

    await expect(recognition).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles and releases the predecessor before allocating a successor', async () => {
    let finishFirstRecognition: ((value: { data: typeof recognitionData }) => void) | undefined;
    let finishFirstTermination: (() => void) | undefined;
    const firstWorker = {
      recognize: vi.fn(
        () =>
          new Promise<{ data: typeof recognitionData }>((resolve) => {
            finishFirstRecognition = resolve;
          }),
      ),
      terminate: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishFirstTermination = resolve;
          }),
      ),
    };
    const secondWorker = {
      recognize: vi.fn(async () => ({ data: recognitionData })),
      terminate: vi.fn(async () => undefined),
    };
    tesseract.createWorker
      .mockResolvedValueOnce(firstWorker)
      .mockResolvedValueOnce(secondWorker);
    const createElement = vi.spyOn(document, 'createElement');

    const first = recognizePage(makeEngine(), 0);
    await until(() => expect(firstWorker.recognize).toHaveBeenCalledOnce());
    const second = recognizePage(makeEngine(), 0);
    await Promise.resolve();
    await Promise.resolve();
    const workerAllocationsBeforeRelease = tesseract.createWorker.mock.calls.length;

    finishFirstRecognition?.({ data: recognitionData });
    finishFirstTermination?.();
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);

    expect(workerAllocationsBeforeRelease).toBe(1);
    expect(firstResult).toMatchObject({
      status: 'rejected',
      reason: { name: 'AbortError' },
    });
    expect(secondResult.status).toBe('fulfilled');
    const canvases = createElement.mock.results
      .map(({ value }) => value)
      .filter((value): value is HTMLCanvasElement => value instanceof HTMLCanvasElement);
    expect(canvases).toHaveLength(2);
    expect(canvases[0] && [canvases[0].width, canvases[0].height]).toEqual([0, 0]);
  });

  it('limits the pixel view to the exact tile byte length', async () => {
    const seenLengths: number[] = [];
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(data: Uint8ClampedArray) {
          seenLengths.push(data.length);
        }
      },
    );
    const engine = makeEngine(async (request) => ({
      ...request,
      pixels: new Uint8ClampedArray(request.width * request.height * 4 + 32).buffer,
    }));
    tesseract.createWorker.mockResolvedValue({
      recognize: vi.fn(async () => ({ data: recognitionData })),
      terminate: vi.fn(async () => undefined),
    });

    await recognizePage(engine, 0);

    expect(seenLengths).toEqual([6 * 6 * 4]);
  });
});
