// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '@/entrypoints/app/App';
import type { EngineTypes } from '@/lib/engine/port';
import engineErrors from '@/lib/engine/port';
import { useDocumentStore } from '@/lib/store/document';

type PageText = EngineTypes['PageText'];
type PdfEngine = EngineTypes['PdfEngine'];
type PdfEngineFactory = EngineTypes['PdfEngineFactory'];
type SearchHit = EngineTypes['SearchHit'];
type TileRequest = EngineTypes['TileRequest'];
const { EngineRequestError } = engineErrors;

const searchHit: SearchHit = {
  pageIndex: 1,
  pageLabel: 'ii',
  quads: [[1, 1, 20, 1, 20, 10, 1, 10]],
};
const secondSearchHit: SearchHit = {
  pageIndex: 0,
  pageLabel: 'i',
  quads: [[4, 20, 28, 20, 28, 30, 4, 30]],
};
const emptySecurity: EngineTypes['DocumentSecurityInspection'] = {
  encryption: {
    protected: false,
    algorithm: 'none',
    version: null,
    revision: null,
    readOnly: false,
  },
  signatures: [],
  limitations: [
    'No timestamping',
    'No fresh revocation checking',
    'No long-term validation (LTV)',
  ],
};

function protectedEncryption(
  authenticatedAs: 'user' | 'owner',
): NonNullable<EngineTypes['DocumentInfo']['encryption']> {
  return {
    protected: true,
    authenticatedAs,
    algorithm: 'aes-256',
    readOnly: false,
  };
}

function makeEngine(
  title = 'Local contract',
  limitations: PageText['limitations'] = [],
  encryption?: EngineTypes['DocumentInfo']['encryption'],
  name = 'contract.pdf',
): PdfEngine {
  const info: EngineTypes['DocumentInfo'] = {
    name,
    title,
    pages: [
      { index: 0, label: 'i', bounds: [0, 0, 100, 120], width: 100, height: 120 },
      { index: 1, label: 'ii', bounds: [0, 0, 100, 120], width: 100, height: 120 },
    ],
    outline: [{ title: 'Terms', pageIndex: 1, children: [] }],
    attachments: [],
    permissions: { copy: true, print: true, annotate: true },
    ...(encryption ? { encryption } : {}),
  };
  const mutation: EngineTypes['MutationResult'] = {
    document: info,
    journal: {
      position: 0,
      steps: [],
      canUndo: false,
      canRedo: false,
      revision: 0,
    },
  };
  return {
    info,
    renderTile: vi.fn(async (request: TileRequest) => ({
      ...request,
      pixels: new Uint8ClampedArray(request.width * request.height * 4).buffer,
    })),
    getPageText: vi.fn(async (pageIndex: number) => ({
      pageIndex,
      text: pageIndex === 0 ? 'First page in logical reading order.' : 'Second page.',
      characters: pageIndex === 0 ? 36 : 12,
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
    listAnnotations: vi.fn(async () => []),
    addAnnotation: vi.fn(async () => mutation),
    editExistingText: vi.fn(async () => ({
      ...mutation,
      fidelity: 'DEGRADED' as const,
      analysis: 'inferred' as const,
      fontName: 'F1',
      mechanism: 'redaction-overlay' as const,
    })),
    addAnnotations: vi.fn(async () => mutation),
    updateAnnotation: vi.fn(async () => mutation),
    deleteAnnotation: vi.fn(async () => mutation),
    reorderPages: vi.fn(async () => mutation),
    rotatePages: vi.fn(async () => mutation),
    insertBlankPage: vi.fn(async () => mutation),
    deletePages: vi.fn(async () => mutation),
    setPageBoxes: vi.fn(async () => mutation),
    setPageLabels: vi.fn(async () => mutation),
    extractPages: vi.fn(async () => ({ name: 'pages.pdf', data: new ArrayBuffer(0) })),
    mergeDocument: vi.fn(async () => mutation),
    composePages: vi.fn(async () => mutation),
    inspectIncomingDocument: vi.fn(async (name: string) => ({
      name,
      pageCount: 1,
      pages: [{ index: 0, label: '1' }],
    })),
    compareDocument: vi.fn(async (name: string): Promise<EngineTypes['CompareResult']> => ({
      incomingName: name,
      same: 0,
      changed: 1,
      added: 0,
      removed: 0,
      moved: 0,
      truncated: false,
      comparedCurrentPages: 1,
      comparedIncomingPages: 1,
      totalCurrentPages: 1,
      totalIncomingPages: 1,
      pages: [
        {
          pageIndex: 0,
          status: 'changed',
          currentLabel: 'i',
          incomingLabel: '1',
          currentCharacters: 18,
          incomingCharacters: 24,
          dimensionsChanged: false,
          rasterReviewRecommended: false,
          ocrRequired: false,
          similarity: 0.5,
        },
      ],
    })),
    validatePdfA: vi.fn(async () => ({
      profile: 'PDF/A-2b',
      valid: true,
      checks: [
        {
          id: 'metadata',
          label: 'PDF/A identification metadata',
          passed: true,
          detail: 'Declares PDF/A-2b.',
        },
      ],
    })),
    splitDocument: vi.fn(async () => []),
    listFields: vi.fn(async () => []),
    setFieldValue: vi.fn(async () => mutation),
    setFieldValues: vi.fn(async () => mutation),
    createFormField: vi.fn(async () => mutation),
    updateFormField: vi.fn(async () => mutation),
    updateFormFields: vi.fn(async () => mutation),
    reorderFormFields: vi.fn(async () => mutation),
    resetForm: vi.fn(async () => mutation),
    getJavaScriptState: vi.fn(async () => ({ enabled: true, scripts: [], events: [] })),
    setJavaScriptAction: vi.fn(async () => mutation),
    deleteJavaScriptAction: vi.fn(async () => mutation),
    executeJavaScript: vi.fn(async () => ({
      result: 'undefined',
      events: [],
      document: info,
      journal: mutation.journal,
    })),
    authenticateOwner: vi.fn(async () => ({
      ...info,
      encryption: protectedEncryption('owner'),
    })),
    updateMetadata: vi.fn(async () => mutation),
    save: vi.fn(async () => new ArrayBuffer(0)),
    exportPdf: vi.fn(async () => new ArrayBuffer(0)),
    applyRedactions: vi.fn(async () => ({
      data: new ArrayBuffer(0),
      document: info,
      journal: mutation.journal,
      fidelity: 'DEGRADED' as const,
      applied: 1,
      pages: 1,
    })),
    redactPages: vi.fn(async () => ({
      data: new ArrayBuffer(0),
      document: info,
      journal: mutation.journal,
      removed: {
        scripts: 0,
        embeddedFiles: 0,
        metadata: 0,
        formValues: 0,
        hiddenAnnotations: 0,
        pages: 1,
      },
    })),
    sanitize: vi.fn(async () => ({
      data: new ArrayBuffer(0),
      document: info,
      journal: mutation.journal,
      removed: {
        scripts: 0,
        embeddedFiles: 0,
        metadata: 0,
        formValues: 0,
        hiddenAnnotations: 0,
        pages: 0,
      },
    })),
    undo: vi.fn(async () => mutation),
    redo: vi.fn(async () => mutation),
    getJournal: vi.fn(async () => mutation.journal),
    getOutputState: vi.fn(async () => ({
      unappliedRedactions: 0,
      signatures: 0,
      security: emptySecurity,
      canPersist: false,
    })),
    subscribe: vi.fn(() => () => undefined),
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

function setTextAreaValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('The DOM textarea value setter is unavailable.');
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
          fillText: vi.fn(),
          putImageData: vi.fn(),
          scale: vi.fn(),
          direction: 'ltr',
          fillStyle: '',
          font: '',
          textAlign: 'start',
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
    window.localStorage.clear();
    useDocumentStore.getState().clear();
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
    expect(container.textContent).toContain('contract.pdf');
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

    const markupButton = buttonNamed(container, 'Markup');
    markupButton.focus();
    await act(async () => markupButton.click());
    expect(document.activeElement).toBe(markupButton);
    expect(document.activeElement).not.toBe(searchInput);

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
    expect(container.textContent).toContain('1 match');
    expect(container.textContent).toContain('Page ii');
  });

  it('SIGN-018 retries a protected document through an accessible password dialog', async () => {
    engine = makeEngine('Local contract', [], undefined, 'protected.pdf');
    engineFactory = vi
      .fn<PdfEngineFactory>()
      .mockRejectedValueOnce(
        new EngineRequestError(
          'password_required',
          'This PDF is password-protected. Enter the document password to continue.',
        ),
      )
      .mockResolvedValueOnce(engine);
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'protected.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('protected.pdf');
    const password = document.querySelector<HTMLInputElement>('input[type="password"]');
    expect(password).not.toBeNull();
    await act(async () => {
      if (!password) throw new Error('Missing document password input.');
      setInputValue(password, 'reader-secret');
      password.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(engineFactory).toHaveBeenNthCalledWith(
      2,
      file,
      expect.any(AbortSignal),
      'reader-secret',
    );
    expect(container.textContent).toContain('protected.pdf');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('SIGN-019 unlocks owner-only protection from the Protect panel', async () => {
    engine = makeEngine('Owner-only PDF', [], protectedEncryption('user'));
    engineFactory = vi.fn(async () => engine);
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'owner-only.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Protect').click());
    const ownerPassword = container.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    );
    expect(ownerPassword).not.toBeNull();
    await act(async () => {
      if (!ownerPassword) throw new Error('Missing current owner-password input.');
      setInputValue(ownerPassword, 'owner-secret');
      ownerPassword.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(engine.authenticateOwner).toHaveBeenCalledWith('owner-secret');
    expect(container.textContent).toContain('Owner controls unlocked for this local session.');
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
    expect(container.textContent).toContain('OPEN');
    expect(container.textContent).toContain('True redaction');
    expect(container.textContent).toContain('content-stream filter can perturb rendering');
    expect(container.textContent).toContain('Digital signing');
    expect(container.textContent).toContain('OPEN');
  });

  it('H1/H2 keeps excluded conversion and comparison paths labelled at their controls', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => buttonNamed(container, 'Convert').click());
    const conversionPanel = container.querySelector('[aria-label="Convert and validate"]');
    expect(conversionPanel?.textContent).toContain('CONV-020');
    expect(conversionPanel?.textContent).toContain('EXCLUDED');
    expect(conversionPanel?.textContent).toContain(
      'this build has no independently accepted writer',
    );
    expect(conversionPanel?.textContent).toContain('Download Markdown');
    expect(conversionPanel?.textContent).toContain('Download RTF');
    expect(conversionPanel?.textContent).not.toContain('Markdown and RTF export are excluded');

    await act(async () => buttonNamed(container, 'Compare').click());
    const comparePanel = container.querySelector('[aria-label="Compare documents"]');
    expect(comparePanel?.textContent).toContain('Scanned-against-digital comparison');
    expect(comparePanel?.textContent).toContain('EXCLUDED');
    expect(comparePanel?.textContent).toContain('never reported as a comparison result');
  });

  it('SIGN-031 makes applying redactions reachable beside marks and unblocks output', async () => {
    let applied = false;
    engine.getOutputState = vi.fn(async () => ({
      unappliedRedactions: applied ? 0 : 1,
      signatures: 0,
      security: emptySecurity,
      canPersist: true,
    }));
    engine.applyRedactions = vi.fn(async () => {
      applied = true;
      return {
        data: new ArrayBuffer(0),
        document: engine.info,
        journal: await engine.getJournal(),
        fidelity: 'DEGRADED' as const,
        applied: 1,
        pages: 1,
      };
    });
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'marked.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => buttonNamed(container, 'Markup').click());
    expect(container.textContent).toContain('Apply 1 redaction mark');
    expect(container.textContent).toContain(
      'redaction writes through a content-stream filter that perturbs rendering on some documents',
    );
    await act(async () => {
      buttonNamed(container, 'Apply redaction marks').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(engine.applyRedactions).toHaveBeenCalledWith(false);
    expect(container.textContent).toContain('no extractable characters were removed');
    expect(container.textContent).toContain('sampled marked region did not change');
    expect(container.textContent).toContain('Inspect the marked region');
  });

  it('SIGN-031 renders a refusal category and remedy at the apply action', async () => {
    engine.getOutputState = vi.fn(async () => ({
      unappliedRedactions: 1,
      signatures: 0,
      security: emptySecurity,
      canPersist: true,
    }));
    engine.applyRedactions = vi.fn(async () => {
      throw new Error(
        'Apply redactions refused because Form XObject content on page 1. Remove the marks, run Sanitize, then place the marks again. The document was not changed.',
      );
    });
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'unsupported.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Markup').click());
    await act(async () => {
      buttonNamed(container, 'Apply redaction marks').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Form XObject content on page 1');
    expect(container.textContent).toContain(
      'Remove the marks, run Sanitize, then place the marks again',
    );
    expect(container.textContent).not.toContain('Adding redaction failed');
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
      'First 1 match · refine your search to see every result',
    );
  });

  it('FIND-002 traverses matches forward and backward with wraparound', async () => {
    engine.search = vi.fn(async () => ({
      hits: [searchHit, secondSearchHit],
      truncated: false,
    }));
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Find').click());
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Find in document"]',
    );
    if (!searchInput) throw new Error('Missing search input.');
    await act(async () => setInputValue(searchInput, 'needle'));
    await act(async () => {
      searchInput.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Match 1 of 2');
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Page ii');
    await act(async () => {
      searchInput.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain('Match 2 of 2');
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Page i');

    await act(async () => {
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(container.textContent).toContain('Match 1 of 2');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', shiftKey: true }));
    });
    expect(container.textContent).toContain('Match 2 of 2');
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
    const firstEngine = makeEngine('First document', [], undefined, 'first.pdf');
    const secondEngine = makeEngine('Second document', [], undefined, 'second.pdf');
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

    expect(container.textContent).toContain('second.pdf');
    expect(container.querySelector('[aria-label="Current page"]')?.textContent).toBe('1 / 2');
    expect(firstEngine.close).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('operates the command palette with arrow keys, Enter, and Escape', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));

    const commandsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Commands"]',
    );
    if (!commandsButton) throw new Error('Missing Commands button.');
    await act(async () => commandsButton.click());
    const filter = document.querySelector<HTMLInputElement>(
      'input[aria-label="Filter commands"]',
    );
    if (!filter) throw new Error('Missing command filter.');
    await act(async () => setInputValue(filter, 'Use dark theme'));
    await act(async () => {
      filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const option = document.querySelector<HTMLButtonElement>('[role="option"]');
    expect(option?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(option);
    await act(async () => {
      option?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('.command-palette')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');

    await act(async () => commandsButton.click());
    const reopened = document.querySelector<HTMLInputElement>(
      'input[aria-label="Filter commands"]',
    );
    await act(async () => {
      reopened?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.command-palette')).toBeNull();
  });

  it('EDIT-001 captures active overlay input before the React event target clears', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Markup').click());
    const textBox = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Text box'),
    );
    if (!(textBox instanceof HTMLButtonElement)) throw new Error('Missing Text box tool.');
    await act(async () => textBox.click());
    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Overlay text"]',
    );
    if (!input) throw new Error('Missing active overlay input.');

    await act(async () => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('textarea[aria-label="Overlay text"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    await act(async () => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });

    await act(async () => setTextAreaValue(input, 'مرحبا'));
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    expect(engine.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FreeText', contents: 'مرحبا' }),
    );
    expect(container.querySelector('textarea[aria-label="Overlay text"]')).toBeNull();
  });

  it('VIEW-037 requires explicit discard before replacing unsaved document state', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const first = new File(['%PDF-1.7'], 'first.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [first] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      useDocumentStore.getState().applyMutation({
        document: engine.info,
        journal: {
          position: 1,
          steps: ['Add sticky note'],
          canUndo: true,
          canRedo: false,
          revision: 1,
        },
      });
    });

    const second = new File(['%PDF-1.7'], 'second.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [second] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Save changes before opening another PDF?',
    );
    expect(engineFactory).toHaveBeenCalledOnce();
    expect(engine.close).not.toHaveBeenCalled();

    await act(async () => buttonNamed(document.body, 'Cancel').click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(engineFactory).toHaveBeenCalledOnce();

    Object.defineProperty(fileInput, 'files', { configurable: true, value: [second] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      buttonNamed(document.body, 'Discard').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(engineFactory).toHaveBeenCalledTimes(2);
    expect(engine.close).toHaveBeenCalledOnce();
  });

  it('VIEW-037 opens the replacement only after output succeeds', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:local-output');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const first = new File(['%PDF-1.7'], 'first.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [first] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      useDocumentStore.getState().applyMutation({
        document: engine.info,
        journal: {
          position: 1,
          steps: ['Add sticky note'],
          canUndo: true,
          canRedo: false,
          revision: 1,
        },
      });
    });

    const second = new File(['%PDF-1.7'], 'second.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [second] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    vi.mocked(engine.save).mockRejectedValueOnce(new Error('Disk unavailable.'));
    await act(async () => {
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) throw new Error('Missing unsaved-changes dialog.');
      buttonNamed(dialog, 'Download').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(engineFactory).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Downloading the PDF failed. Disk unavailable.',
    );

    await act(async () => {
      buttonNamed(container, 'Dismiss').click();
      await Promise.resolve();
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) throw new Error('Missing unsaved-changes dialog.');
      buttonNamed(dialog, 'Download').click();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(engineFactory).toHaveBeenCalledTimes(2);
    expect(engine.close).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(click).toHaveBeenCalledOnce();

    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('PAGE-001 through PAGE-020 expose composition workflows behind result previews', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Organize').click());

    expect(buttonNamed(container, 'Rotate view left').disabled).toBe(false);
    expect(buttonNamed(container, 'Insert blank page').disabled).toBe(false);
    expect(buttonNamed(container, 'Extract selected').disabled).toBe(true);
    expect(buttonNamed(container, 'Split in half').disabled).toBe(false);
    expect(buttonNamed(container, 'Alternate & mix').disabled).toBe(true);
    expect(container.querySelector('[aria-label="Page order"]')).not.toBeNull();
  });

  it('SIGN-024 preserves the specific RC4 refusal when form authoring fails generically', async () => {
    const disclosure =
      'This PDF uses broken RC4 encryption. It is open for reading only and must be replaced with a full garbage-collecting AES-256 copy before output.';
    engine = makeEngine(
      'RC4 contract',
      [],
      {
        protected: true,
        authenticatedAs: 'user',
        algorithm: 'rc4',
        readOnly: true,
        disclosure,
      },
      'rc4.pdf',
    );
    vi.mocked(engine.createFormField).mockRejectedValueOnce(
      new Error('This PDF is password-protected. Enter the document password to continue.'),
    );
    engineFactory = vi.fn(async () => engine);
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'rc4.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Forms').click());
    const name = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Unique name'))
      ?.querySelector('input');
    if (!(name instanceof HTMLInputElement)) throw new Error('Missing field name input.');
    await act(async () => setInputValue(name, 'must-not-write'));
    await act(async () => {
      buttonNamed(container, 'Create field').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'broken RC4 encryption',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(
      'Enter the document password',
    );
  });

  it('FORM-001 authors a real field path instead of reporting authoring unavailable', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => buttonNamed(container, 'Forms').click());
    const name = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Unique name'))
      ?.querySelector('input');
    if (!(name instanceof HTMLInputElement)) throw new Error('Missing field name input.');
    await act(async () => setInputValue(name, 'customer_name'));
    await act(async () => buttonNamed(container, 'Create field').click());
    expect(engine.createFormField).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'customer_name', type: 'text', pageIndex: 0 }),
    );
    expect(container.textContent).not.toContain('Authoring controls remain unavailable');
  });

  it('CMPR-001 and CONV-024 expose working local comparison and PDF/A reports', async () => {
    await act(async () => root.render(createElement(App, { engineFactory })));
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => buttonNamed(container, 'Compare').click());
    const comparison = container.querySelector<HTMLInputElement>(
      'input[aria-label="PDF to compare"]',
    );
    expect(comparison?.hidden).toBe(false);
    expect(comparison?.classList.contains('sr-only')).toBe(true);
    const other = new File(['%PDF-1.7'], 'other.pdf', { type: 'application/pdf' });
    Object.defineProperty(comparison, 'files', { configurable: true, value: [other] });
    await act(async () => {
      comparison?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(engine.compareDocument).toHaveBeenCalledWith('other.pdf', expect.any(ArrayBuffer));
    expect(container.textContent).toContain('1 changed');

    await act(async () => buttonNamed(container, 'Convert').click());
    await act(async () => buttonNamed(container, 'Validate PDF/A').click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(engine.validatePdfA).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('PDF/A-2b checks pass');
  });
});
