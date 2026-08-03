// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CompareTool from '@/entrypoints/app/tools/CompareTool';
import ConversionTools from '@/entrypoints/app/tools/ConversionTools';
import type { EngineTypes } from '@/lib/engine/port';

const ocr = vi.hoisted(() => ({
  recognizePage: vi.fn(),
}));

vi.mock('@/lib/ocr/client', () => ({
  default: { recognizePage: ocr.recognizePage },
  browserOcrDescription: () => ({
    likelyAvailable: true,
    description: 'Local OCR test.',
  }),
  isAbortError: (error: unknown) =>
    (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError',
}));

const result = {
  available: true as const,
  text: 'recognized',
  confidence: 91,
  blocks: [],
  words: [],
};

function abortError(): DOMException {
  return new DOMException('cancelled', 'AbortError');
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeEngine(name: string): EngineTypes['PdfEngine'] {
  const pages = [
    { index: 0, label: '1', bounds: [0, 0, 100, 100] as const, width: 100, height: 100 },
    { index: 1, label: '2', bounds: [0, 0, 100, 100] as const, width: 100, height: 100 },
  ];
  return {
    info: {
      name,
      title: name,
      pages,
      outline: [],
      attachments: [],
      permissions: { copy: true, print: true, annotate: true },
    },
    compareDocument: vi.fn(async (): Promise<EngineTypes['CompareResult']> => ({
      incomingName: 'incoming.pdf',
      same: 0,
      changed: 2,
      added: 0,
      removed: 0,
      moved: 0,
      truncated: false,
      comparedCurrentPages: 2,
      comparedIncomingPages: 2,
      totalCurrentPages: 2,
      totalIncomingPages: 2,
      pages: pages.map((page) => ({
        pageIndex: page.index,
        currentPageIndex: page.index,
        status: 'changed' as const,
        currentLabel: page.label,
        incomingLabel: page.label,
        currentCharacters: 0,
        incomingCharacters: 0,
        dimensionsChanged: false,
        rasterReviewRecommended: true,
        ocrRequired: true,
        similarity: 0,
      })),
    })),
    validatePdfA: vi.fn(),
    getPageText: vi.fn(),
  } as unknown as EngineTypes['PdfEngine'];
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === name ||
      candidate.textContent?.replace(/\s+/g, ' ').trim() === name,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button "${name}".`);
  return match;
}

describe('OCR callers', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    ocr.recognizePage.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
  });

  it('aborts ConversionTools recognition on engine change and unmount without reporting it', async () => {
    const first = deferred<typeof result>();
    const second = deferred<typeof result>();
    ocr.recognizePage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onError = vi.fn();
    const firstEngine = makeEngine('first.pdf');
    const secondEngine = makeEngine('second.pdf');
    await act(async () => {
      root.render(createElement(ConversionTools, { engine: firstEngine, onError }));
    });
    await act(async () => button(container, 'Recognize current page').click());
    const firstSignal = ocr.recognizePage.mock.calls[0]?.[2] as AbortSignal;

    await act(async () => {
      root.render(createElement(ConversionTools, { engine: secondEngine, onError }));
    });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => first.reject(abortError()));
    expect(onError).not.toHaveBeenCalled();

    await act(async () => button(container, 'Recognize current page').click());
    const secondSignal = ocr.recognizePage.mock.calls[1]?.[2] as AbortSignal;
    await act(async () => root.unmount());
    mounted = false;
    expect(secondSignal.aborted).toBe(true);
    second.reject(abortError());
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps CompareTool busy for the live OCR after a superseded run aborts', async () => {
    const first = deferred<typeof result>();
    const second = deferred<typeof result>();
    ocr.recognizePage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onError = vi.fn();
    await act(async () => {
      root.render(
        createElement(CompareTool, {
          engine: makeEngine('compare.pdf'),
          onNavigate: vi.fn(),
          onError,
        }),
      );
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = {
      name: 'incoming.pdf',
      arrayBuffer: async () => new ArrayBuffer(1),
    };
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input?.dispatchEvent(new Event('change', { bubbles: true })));

    await act(async () => button(container, 'Run OCR on page 1 for comparison').click());
    const firstSignal = ocr.recognizePage.mock.calls[0]?.[2] as AbortSignal;
    await act(async () => button(container, 'Run OCR on page 2 for comparison').click());
    expect(firstSignal.aborted).toBe(true);
    await act(async () => first.reject(abortError()));
    expect(button(container, 'Run OCR on page 2 for comparison').textContent).toContain('…');
    expect(onError).not.toHaveBeenCalled();

    await act(async () => second.resolve(result));
    expect(container.textContent).toContain('OCR: 10 chars');
    expect(onError).not.toHaveBeenCalled();
  });

  it('aborts CompareTool recognition on engine change and unmount', async () => {
    const first = deferred<typeof result>();
    const second = deferred<typeof result>();
    ocr.recognizePage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onError = vi.fn();
    const firstEngine = makeEngine('first.pdf');
    const secondEngine = makeEngine('second.pdf');
    const render = async (engine: EngineTypes['PdfEngine']) => {
      await act(async () => {
        root.render(createElement(CompareTool, { engine, onNavigate: vi.fn(), onError }));
      });
    };
    const loadComparison = async () => {
      const input = container.querySelector<HTMLInputElement>('input[type="file"]');
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{ name: 'incoming.pdf', arrayBuffer: async () => new ArrayBuffer(1) }],
      });
      await act(async () => input?.dispatchEvent(new Event('change', { bubbles: true })));
    };
    await render(firstEngine);
    await loadComparison();
    await act(async () => button(container, 'Run OCR on page 1 for comparison').click());
    const firstSignal = ocr.recognizePage.mock.calls[0]?.[2] as AbortSignal;

    await render(secondEngine);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => first.reject(abortError()));
    await loadComparison();
    await act(async () => button(container, 'Run OCR on page 1 for comparison').click());
    const secondSignal = ocr.recognizePage.mock.calls[1]?.[2] as AbortSignal;

    await act(async () => root.unmount());
    mounted = false;
    expect(secondSignal.aborted).toBe(true);
    second.reject(abortError());
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });
});
