// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CommentsTable from '@/entrypoints/app/tools/CommentsTable';
import MarkupTools from '@/entrypoints/app/tools/MarkupTools';
import PrepareForm from '@/entrypoints/app/tools/PrepareForm';
import { formatShortcut } from '@/lib/commands/shortcuts';
import type { EngineTypes } from '@/lib/engine/port';

type PdfEngine = EngineTypes['PdfEngine'];
type AnnotationInfo = EngineTypes['AnnotationInfo'];
type FormFieldInfo = EngineTypes['FormFieldInfo'];

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

const pages: readonly EngineTypes['PageInfo'][] = [
  { index: 0, label: '1', bounds: [0, 0, 200, 200], width: 200, height: 200 },
];

function annotation(overrides: Partial<AnnotationInfo> = {}): AnnotationInfo {
  return {
    id: 1,
    name: 'note-1',
    pageIndex: 0,
    type: 'Text',
    rect: [10, 10, 30, 30],
    contents: 'A note',
    author: 'Reviewer',
    subject: '',
    color: [1, 1, 0],
    opacity: 1,
    borderWidth: 0,
    borderStyle: 'Solid',
    lineEndingStyles: ['None', 'None'],
    icon: 'Comment',
    state: 'None',
    replyToId: null,
    flags: 0,
    ...overrides,
  };
}

function formField(overrides: Partial<FormFieldInfo> = {}): FormFieldInfo {
  return {
    id: 1,
    pageIndex: 0,
    name: 'full_name',
    label: 'Full name',
    type: 'Text',
    value: '',
    readOnly: false,
    required: false,
    multiline: false,
    password: false,
    options: [],
    rect: [0, 0, 100, 20],
    ...overrides,
  };
}

function makeEngine(overrides: Partial<PdfEngine> = {}): PdfEngine {
  return {
    info: {
      name: 'doc.pdf',
      title: 'doc.pdf',
      pages,
      outline: [],
      attachments: [],
      permissions: { copy: true, print: true, annotate: true },
    },
    listAnnotations: vi.fn(async () => []),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    getOutputState: vi.fn(async () => ({
      unappliedRedactions: 0,
      signatures: 0,
      security: emptySecurity,
      canPersist: true,
    })),
    listFields: vi.fn(async () => []),
    getJavaScriptState: vi.fn(async () => ({ enabled: false, scripts: [], events: [] })),
    updateFormField: vi.fn(),
    ...overrides,
  } as unknown as PdfEngine;
}

describe('tool panel empty states with no current selection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
  });

  it('names a markup tool and its shortcut when no annotations exist', async () => {
    const engine = makeEngine({ listAnnotations: vi.fn(async () => []) });
    await act(async () => {
      root.render(
        createElement(MarkupTools, { engine, onMutation: vi.fn(), onError: vi.fn() }),
      );
    });
    const empty = container.querySelector('.empty-message');
    expect(empty?.textContent).toContain('Choose a markup tool to add the first annotation');
    expect(empty?.textContent).toContain('M');
  });

  it('names what to select in MarkupTools when annotations exist but none is selected', async () => {
    const items = [annotation()];
    const engine = makeEngine({ listAnnotations: vi.fn(async () => items) });
    await act(async () => {
      root.render(
        createElement(MarkupTools, {
          engine,
          shortcutRemapping: { 'markup-family': 'Alt+J' },
          onMutation: vi.fn(),
          onError: vi.fn(),
        }),
      );
    });
    // Open the annotation inspector disclosure, which is collapsed by default.
    const trigger = container.querySelector<HTMLButtonElement>(
      '.annotation-inspector .disclosure-trigger',
    );
    expect(trigger).not.toBeNull();
    trigger?.focus();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger?.click());

    const inspector = container.querySelector('.annotation-inspector');
    expect(inspector?.textContent).toContain(
      'Select an annotation above to edit or delete its properties',
    );
    expect(inspector?.textContent).toContain(formatShortcut('Alt+J'));
    expect(inspector?.querySelector('.panel-actions')).toBeNull();
    // The empty-state message must be reachable (in the DOM, no aria-hidden) but must not
    // itself grab focus: it carries no tabindex/autofocus and isn't the active element.
    const message = inspector?.querySelector('.empty-message');
    expect(message?.hasAttribute('tabindex')).toBe(false);
    expect(message?.getAttribute('aria-hidden')).not.toBe('true');
    expect(document.activeElement).toBe(trigger);

    const annotationButton = inspector?.querySelector<HTMLButtonElement>(
      '.annotation-picker button',
    );
    expect(annotationButton).not.toBeNull();
    await act(async () => annotationButton?.click());
    expect(inspector?.querySelector('.panel-actions')).not.toBeNull();
    expect(inspector?.querySelector('.empty-message')).toBeNull();
  });

  it('names what to select in CommentsTable when comments exist but none is selected', async () => {
    const items = [annotation({ type: 'Text', subject: 'Review note' })];
    const engine = makeEngine({ listAnnotations: vi.fn(async () => items) });
    await act(async () => {
      root.render(
        createElement(CommentsTable, {
          engine,
          onNavigate: vi.fn(),
          onMutation: vi.fn(),
          onError: vi.fn(),
        }),
      );
    });
    const empty = [...container.querySelectorAll('.empty-message')].find((node) =>
      node.textContent?.includes('Select a comment above'),
    );
    expect(empty).toBeDefined();
    expect(empty?.textContent).toContain(
      'Select a comment above to reply, edit its body, or change its status.',
    );
    expect(empty?.hasAttribute('tabindex')).toBe(false);
    expect(empty?.getAttribute('aria-hidden')).not.toBe('true');
    expect(container.querySelector('.comment-inspector')).toBeNull();

    const commentButton = container.querySelector<HTMLButtonElement>(
      '.data-table tbody button',
    );
    expect(commentButton).not.toBeNull();
    await act(async () => commentButton?.click());
    expect(container.querySelector('.comment-inspector')).not.toBeNull();
    expect(container.textContent).not.toContain('Select a comment above');
  });

  it('does not show the no-selection message in CommentsTable when there are no comments at all', async () => {
    const engine = makeEngine({ listAnnotations: vi.fn(async () => []) });
    await act(async () => {
      root.render(
        createElement(CommentsTable, {
          engine,
          onNavigate: vi.fn(),
          onMutation: vi.fn(),
          onError: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain('No comments match this view.');
    expect(container.textContent).not.toContain('Select a comment above');
  });

  it('preserves the form panel empty state when there are no fields', async () => {
    const engine = makeEngine({ listFields: vi.fn(async () => []) });
    await act(async () => {
      root.render(
        createElement(PrepareForm, {
          engine,
          onMutation: vi.fn(),
          onNavigate: vi.fn(),
          onError: vi.fn(),
          onNotice: vi.fn(),
        }),
      );
    });
    expect(container.textContent).toContain('This document has no AcroForm fields.');
    expect(container.textContent).not.toContain('Select a field above');
  });

  it('names what to select and the form-field-tool shortcut in PrepareForm when fields exist but none is selected', async () => {
    const items = [formField()];
    const engine = makeEngine({ listFields: vi.fn(async () => items) });
    await act(async () => {
      root.render(
        createElement(PrepareForm, {
          engine,
          shortcutRemapping: { 'form-field-tool': 'Mod+P' },
          onMutation: vi.fn(),
          onNavigate: vi.fn(),
          onError: vi.fn(),
          onNotice: vi.fn(),
        }),
      );
    });
    const empty = [...container.querySelectorAll('.empty-message')].find((node) =>
      node.textContent?.includes('Select a field above'),
    );
    expect(empty).toBeDefined();
    expect(empty?.textContent).toContain(
      'Select a field above to edit its value, position, and properties',
    );
    expect(empty?.textContent).toContain(formatShortcut('Mod+P'));
    expect(empty?.hasAttribute('tabindex')).toBe(false);
    expect(empty?.getAttribute('aria-hidden')).not.toBe('true');
    expect(container.querySelector('.field-editor')).toBeNull();

    const fieldButton = [
      ...container.querySelectorAll<HTMLButtonElement>('.data-table tbody button'),
    ].find((button) => button.textContent === 'full_name');
    expect(fieldButton).not.toBeNull();
    await act(async () => fieldButton?.click());
    expect(container.querySelector('.field-editor')).not.toBeNull();
    expect(container.textContent).not.toContain('Select a field above');
  });
});
