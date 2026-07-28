// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SelectionActionBar, { type SelectionAction } from '@/entrypoints/app/SelectionActionBar';
import { describeRedactionOutcome } from '@/entrypoints/app/redactionOutcome';
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
          engine: { addAnnotation } as unknown as EngineTypes['PdfEngine'],
          action,
          onMutation: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
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
      { characters: 1117 },
      { characters: 1117 },
    );

    expect(notice).toContain('removed no extractable text');
    expect(notice).toContain('Do not treat this redaction as successful');
    expect(notice).not.toContain('Output is unblocked');
  });
});
