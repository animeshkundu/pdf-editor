// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '@/entrypoints/app/App';

type PdfPoint = readonly [number, number];
type PdfQuad = readonly [number, number, number, number, number, number, number, number];
interface TileRequest {
  readonly pageIndex: number;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly priority?: number;
}
interface SearchHit {
  readonly pageIndex: number;
  readonly pageLabel: string;
  readonly quads: readonly PdfQuad[];
}
interface PageText {
  readonly pageIndex: number;
  readonly text: string;
  readonly analysis: 'complete' | 'inferred' | 'partial';
  readonly limitations: readonly ('form-xobject' | 'structure-tree')[];
}
interface PdfEngine {
  readonly info: {
    readonly name: string;
    readonly title: string;
    readonly pages: readonly {
      readonly index: number;
      readonly label: string;
      readonly bounds: readonly [number, number, number, number];
      readonly width: number;
      readonly height: number;
    }[];
    readonly outline: readonly {
      readonly title: string;
      readonly pageIndex: number | null;
      readonly children: readonly [];
    }[];
    readonly attachments: readonly [];
    readonly permissions: {
      readonly copy: boolean;
      readonly print: boolean;
      readonly annotate: boolean;
    };
  };
  renderTile(
    request: TileRequest,
    signal?: AbortSignal,
  ): Promise<TileRequest & { readonly pixels: ArrayBuffer }>;
  getPageText(pageIndex: number, signal?: AbortSignal): Promise<PageText>;
  selectText(
    pageIndex: number,
    start: PdfPoint,
    end: PdfPoint,
    signal?: AbortSignal,
  ): Promise<{
    readonly pageIndex: number;
    readonly text: string;
    readonly quads: readonly PdfQuad[];
    readonly truncated: boolean;
  }>;
  search(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ readonly hits: readonly SearchHit[]; readonly truncated: boolean }>;
  readAttachment(id: string, signal?: AbortSignal): Promise<ArrayBuffer>;
  close(): Promise<void>;
}
type PdfEngineFactory = (file: File, signal?: AbortSignal) => Promise<PdfEngine>;

const searchHit: SearchHit = {
  pageIndex: 1,
  pageLabel: 'ii',
  quads: [[1, 1, 20, 1, 20, 10, 1, 10]],
};

function makeEngine(
  title = 'Local contract',
  limitations: PageText['limitations'] = [],
): PdfEngine {
  return {
    info: {
      name: 'contract.pdf',
      title,
      pages: [
        { index: 0, label: 'i', bounds: [0, 0, 100, 120], width: 100, height: 120 },
        { index: 1, label: 'ii', bounds: [0, 0, 100, 120], width: 100, height: 120 },
      ],
      outline: [{ title: 'Terms', pageIndex: 1, children: [] }],
      attachments: [],
      permissions: { copy: true, print: true, annotate: true },
    },
    renderTile: vi.fn(async (request: TileRequest) => ({
      ...request,
      pixels: new Uint8ClampedArray(request.width * request.height * 4).buffer,
    })),
    getPageText: vi.fn(async (pageIndex: number) => ({
      pageIndex,
      text: pageIndex === 0 ? 'First page in logical reading order.' : 'Second page.',
      analysis: limitations.length > 0 ? ('partial' as const) : ('complete' as const),
      limitations,
    })),
    selectText: vi.fn(async (pageIndex, _start, _end) => ({
      pageIndex,
      text: 'selected text',
      quads: searchHit.quads,
      truncated: false,
    })),
    search: vi.fn(async () => ({ hits: [searchHit], truncated: false })),
    readAttachment: vi.fn(async () => new ArrayBuffer(0)),
    close: vi.fn(async () => undefined),
  };
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button "${name}".`);
  return button;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('The DOM input value setter is unavailable.');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Phase 3 viewer acceptance', () => {
  let container: HTMLDivElement;
  let root: Root;
  let engine: PdfEngine;
  let engineFactory: PdfEngineFactory;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ImageData',
      class {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          putImageData: vi.fn(),
          fillStyle: '',
        }) as unknown as CanvasRenderingContext2D,
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(options: ScrollToOptions) {
        if (typeof options.top === 'number') this.scrollTop = options.top;
      },
    });
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    engine = makeEngine();
    engineFactory = vi.fn(async () => engine);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('VIEW-001/FIND-001 opens a real file flow and routes Ctrl+F to local engine search', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));

    expect(container.textContent).toContain('Your PDF never leaves this device.');
    expect(container.textContent).toContain('100% LOCAL · ZERO EGRESS');

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(engineFactory).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(container.textContent).toContain('Local contract');
    expect(container.textContent).toContain('2 pages · LOCAL');
    expect(container.querySelector('[aria-label="Document pages"]')).not.toBeNull();
    expect(container.textContent).toContain('LOCAL · page text analysed');
    await act(async () => buttonNamed(container, 'Pan mode').click());
    expect(buttonNamed(container, 'Select mode').getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
      );
    });
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Find in document"]',
    );
    expect(document.activeElement).toBe(searchInput);

    await act(async () => {
      if (!searchInput) throw new Error('Missing search input.');
      setInputValue(searchInput, 'needle');
    });
    await act(async () => {
      searchInput?.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(engine.search).toHaveBeenCalledWith('needle', expect.any(AbortSignal));
    expect(container.textContent).toContain('1 matches');
    expect(container.textContent).toContain('Page ii');
  });

  it('A1/H1 exposes keyboard commands and names degraded, excluded, and open limits', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Open PDF');

    await act(async () => {
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Scope').click());
    expect(container.textContent).toContain('Existing-text editing');
    expect(container.textContent).toContain('DEGRADED');
    expect(container.textContent).toContain('True redaction');
    expect(container.textContent).toContain('EXCLUDED');
    expect(container.textContent).toContain('Digital signing');
    expect(container.textContent).toContain('OPEN');
  });

  it('FIND-001 discloses when the bounded result list omits additional matches', async () => {
    engine.search = vi.fn(async () => ({ hits: [searchHit], truncated: true }));
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
      );
    });
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Find in document"]',
    );
    await act(async () => {
      if (!searchInput) throw new Error('Missing search input.');
      setInputValue(searchInput, 'needle');
    });
    await act(async () => {
      searchInput?.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'First 1 matches · refine your search to see every result',
    );
  });

  it('H1 discloses both tagged-order and Form XObject analysis limits', async () => {
    engine = makeEngine('Partly analysable document', ['structure-tree', 'form-xobject']);
    engineFactory = vi.fn(async () => engine);
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'forms.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="Analysis scope"]')?.textContent).toBe(
      'DEGRADED · structure order unavailable; form run analysis partial',
    );
  });

  it('VIEW-001 resets mounted document state before closing a replaced engine', async () => {
    const firstEngine = makeEngine('First document');
    const secondEngine = makeEngine('Second document');
    engineFactory = vi
      .fn<PdfEngineFactory>()
      .mockResolvedValueOnce(firstEngine)
      .mockResolvedValueOnce(secondEngine);
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');

    for (const filename of ['first.pdf', 'second.pdf']) {
      const file = new File(['%PDF-1.7'], filename, { type: 'application/pdf' });
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
      await act(async () => {
        fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(container.textContent).toContain('Second document');
    expect(container.querySelector('[aria-label="Current page"]')?.textContent).toBe('1 / 2');
    expect(firstEngine.close).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
