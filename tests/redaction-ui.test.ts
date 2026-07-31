// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SelectionActionBar, { type SelectionAction } from '@/entrypoints/app/SelectionActionBar';
import {
  describeRedactionOutcome,
  snapshotRedactionText,
} from '@/entrypoints/app/redactionOutcome';
import type { EngineTypes } from '@/lib/engine/port';

function mutation(): EngineTypes['MutationResult'] {
  return {
    document: {
      name: 'redaction.pdf',
      title: 'Redaction',
      pages: [{ index: 0, label: '1', bounds: [0, 0, 200, 200], width: 200, height: 200 }],
      outline: [],
      attachments: [],
      permissions: { copy: true, print: true, annotate: true },
    },
    journal: {
      position: 1,
      steps: ['Add redaction'],
      canUndo: true,
      canRedo: false,
      revision: 1,
    },
  };
}

describe('redaction UI safety', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('creates text redaction geometry from every selected structured-text quad', async () => {
    const addAnnotation = vi.fn(async () => mutation());
    const onNotice = vi.fn();
    const action: SelectionAction = {
      selection: {
        pageIndex: 0,
        text: 'private name',
        quads: [
          [31, 42, 80, 42, 80, 55, 31, 55],
          [12, 61, 74, 61, 74, 75, 12, 75],
        ],
        truncated: false,
      },
      viewportBounds: [100, 100, 200, 140],
    };
    await act(async () =>
      root.render(
        createElement(SelectionActionBar, {
          engine: {
            info: mutation().document,
            addAnnotation,
          } as unknown as EngineTypes['PdfEngine'],
          action,
          onMutation: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
          onNotice,
        }),
      ),
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Mark selected text for redaction"]')
        ?.click();
      await Promise.resolve();
    });

    expect(addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        pageIndex: 0,
        type: 'Redact',
        rect: [12, 42, 80, 75],
        quadPoints: action.selection.quads,
      }),
    );
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('announces glyph replacement only after the verified edit succeeds', async () => {
    const editExistingText = vi.fn(async () => mutation());
    const onNotice = vi.fn();
    const action: SelectionAction = {
      selection: {
        pageIndex: 0,
        text: 'Original',
        quads: [[31, 42, 80, 42, 80, 55, 31, 55]],
        truncated: false,
      },
      viewportBounds: [100, 100, 200, 140],
    };
    await act(async () =>
      root.render(
        createElement(SelectionActionBar, {
          engine: {
            info: mutation().document,
            editExistingText,
          } as unknown as EngineTypes['PdfEngine'],
          action,
          onMutation: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
          onNotice,
        }),
      ),
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Edit selected text"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.primary-action')?.click();
      await Promise.resolve();
    });

    expect(editExistingText).toHaveBeenCalledWith(
      expect.objectContaining({
        originalText: 'Original',
        replacementText: 'Original',
      }),
    );
    expect(onNotice).toHaveBeenCalledWith(
      expect.stringContaining('Replaced the selected ASCII'),
    );
  });

  it('does not describe a redaction that removed no extractable text as success', () => {
    const notice = describeRedactionOutcome(
      {
        ...mutation(),
        data: new ArrayBuffer(0),
        fidelity: 'DEGRADED',
        applied: 1,
        pages: 1,
      },
      { characters: 1117, pageFingerprints: new Map([[0, 'same']]) },
      { characters: 1117, pageFingerprints: new Map([[0, 'same']]) },
    );

    expect(notice).toContain('no extractable characters were removed');
    expect(notice).toContain('sampled marked region did not change');
    expect(notice).toContain('Inspect the marked region');
  });

  it('reports a visual-only redaction without inventing a text count', () => {
    const notice = describeRedactionOutcome(
      {
        ...mutation(),
        data: new ArrayBuffer(0),
        fidelity: 'DEGRADED',
        applied: 1,
        pages: 1,
      },
      { characters: 6, pageFingerprints: new Map([[0, 'before']]) },
      { characters: 6, pageFingerprints: new Map([[0, 'after']]) },
    );

    expect(notice).toContain('No extractable characters were removed');
    expect(notice).toContain('rendered marked region changed');
    expect(notice).toContain('image or line-art content');
  });

  it('fingerprints only the marked region instead of rasterizing the whole page', async () => {
    const renderTile = vi.fn(async (request: EngineTypes['TileRequest']) => ({
      ...request,
      pixels: new Uint8ClampedArray(request.width * request.height * 4).buffer,
    }));
    const engine = {
      info: mutation().document,
      getPageText: vi.fn(async () => ({
        pageIndex: 0,
        text: 'private',
        characters: 7,
        analysis: 'complete' as const,
        limitations: [],
      })),
      renderTile,
    } as unknown as EngineTypes['PdfEngine'];

    const snapshot = await snapshotRedactionText(engine, [
      { pageIndex: 0, rect: [72, 96, 144, 128] },
    ]);

    expect(snapshot.characters).toBe(7);
    expect(renderTile).toHaveBeenCalledTimes(1);
    expect(renderTile).toHaveBeenCalledWith(
      expect.objectContaining({ x: 72, y: 96, width: 72, height: 32 }),
    );
  });

  it('bounds visual redaction sampling for an oversized marked region', async () => {
    let renderedPixels = 0;
    const renderTile = vi.fn(async (request: EngineTypes['TileRequest']) => {
      renderedPixels += request.width * request.height;
      return {
        ...request,
        pixels: new Uint8ClampedArray(request.width * request.height * 4).buffer,
      };
    });
    const engine = {
      info: {
        ...mutation().document,
        pages: [
          {
            index: 0,
            label: '1',
            bounds: [0, 0, 14_400, 14_400],
            width: 14_400,
            height: 14_400,
          },
        ],
      },
      getPageText: vi.fn(async () => ({
        pageIndex: 0,
        text: '',
        characters: 0,
        analysis: 'complete' as const,
        limitations: [],
      })),
      renderTile,
    } as unknown as EngineTypes['PdfEngine'];

    await snapshotRedactionText(engine, [{ pageIndex: 0, rect: [0, 0, 14_400, 14_400] }]);

    expect(renderedPixels).toBeLessThanOrEqual(1_000_000);
  });
});
