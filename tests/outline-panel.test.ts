// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OutlinePanel } from '@/entrypoints/app/DocumentPanels';
import type { EngineTypes } from '@/lib/engine/port';
import { viewportStore } from '@/lib/store/viewport';

type OutlineNode = EngineTypes['OutlineNode'];
type PdfEngine = EngineTypes['PdfEngine'];

function makeEngine(outline: readonly OutlineNode[], pageCount = 4): Pick<PdfEngine, 'info'> {
  return {
    info: {
      name: 'outline.pdf',
      title: 'Outline fixture',
      pages: Array.from({ length: pageCount }, (_, index) => ({
        index,
        label: `${index + 1}`,
        bounds: [0, 0, 100, 120] as const,
        width: 100,
        height: 120,
      })),
      outline,
      attachments: [],
      permissions: { copy: true, print: true, annotate: true },
    },
  };
}

function item(container: HTMLElement, name: string): HTMLLIElement {
  const match = [...container.querySelectorAll<HTMLLIElement>('[role="treeitem"]')].find(
    (candidate) =>
      candidate
        .querySelector<HTMLElement>(':scope > .outline-tree-row')
        ?.textContent?.trim() === name,
  );
  if (!match) throw new Error(`Missing treeitem "${name}".`);
  return match;
}

function press(target: HTMLElement, key: string): boolean {
  return target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

describe('VIEW-021 document outline navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

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
  });

  beforeEach(() => {
    viewportStore.getState().reset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  afterAll(() => vi.unstubAllGlobals());

  it('renders a collapsed ARIA tree and traverses only visible entries with APG keys', async () => {
    const outline: readonly OutlineNode[] = [
      { title: 'Introduction', pageIndex: 0, children: [] },
      {
        title: 'Part one',
        pageIndex: 1,
        children: [
          {
            title: 'Chapter one',
            pageIndex: 1,
            children: [{ title: 'Deep topic', pageIndex: 2, children: [] }],
          },
        ],
      },
      { title: 'Appendix', pageIndex: 3, children: [] },
    ];
    await act(async () =>
      root.render(
        createElement(OutlinePanel, { engine: makeEngine(outline), onNavigate: vi.fn() }),
      ),
    );

    expect(
      container.querySelector('[role="tree"][aria-label="Document outline"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
    expect(item(container, 'Part one').getAttribute('aria-expanded')).toBe('false');
    expect(item(container, 'Part one').getAttribute('aria-label')).toBe('Part one');
    expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
    expect(item(container, 'Introduction').getAttribute('aria-current')).toBe('location');

    item(container, 'Introduction').focus();
    await act(async () => press(item(container, 'Introduction'), 'ArrowDown'));
    expect(document.activeElement).toBe(item(container, 'Part one'));

    await act(async () => press(item(container, 'Part one'), 'ArrowRight'));
    expect(item(container, 'Part one').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);

    await act(async () => press(item(container, 'Part one'), 'ArrowRight'));
    expect(document.activeElement).toBe(item(container, 'Chapter one'));
    await act(async () => press(item(container, 'Chapter one'), 'ArrowRight'));
    await act(async () => press(item(container, 'Chapter one'), 'ArrowRight'));
    expect(document.activeElement).toBe(item(container, 'Deep topic'));
    expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);

    await act(async () => press(item(container, 'Deep topic'), 'Home'));
    expect(document.activeElement).toBe(item(container, 'Introduction'));
    await act(async () => press(item(container, 'Introduction'), 'End'));
    expect(document.activeElement).toBe(item(container, 'Appendix'));
    await act(async () => press(item(container, 'Appendix'), 'ArrowUp'));
    expect(document.activeElement).toBe(item(container, 'Deep topic'));
    await act(async () => press(item(container, 'Deep topic'), 'ArrowLeft'));
    expect(document.activeElement).toBe(item(container, 'Chapter one'));

    let allowed = true;
    await act(async () => {
      allowed = press(item(container, 'Introduction'), 'ArrowLeft');
    });
    expect(allowed).toBe(false);
    await act(async () => {
      allowed = press(item(container, 'Deep topic'), 'ArrowRight');
    });
    expect(allowed).toBe(false);
  });

  it('navigates valid entries, keeps focus in the tree, and follows page changes', async () => {
    const onNavigate = vi.fn();
    const outline: readonly OutlineNode[] = [
      { title: 'Opening', pageIndex: 0, children: [] },
      { title: 'First on page two', pageIndex: 1, children: [] },
      { title: 'Second on page two', pageIndex: 1, children: [] },
      {
        title: 'Part three',
        pageIndex: 2,
        children: [{ title: 'Nested section', pageIndex: 2, children: [] }],
      },
    ];
    await act(async () =>
      root.render(createElement(OutlinePanel, { engine: makeEngine(outline), onNavigate })),
    );

    await act(async () => {
      viewportStore.getState().setCurrentPage(1);
    });
    expect(item(container, 'Second on page two').getAttribute('aria-current')).toBe('location');

    await act(async () => item(container, 'First on page two').click());
    expect(onNavigate).toHaveBeenCalledWith(1, 'auto');
    expect(item(container, 'First on page two').getAttribute('aria-current')).toBe('location');
    expect(document.activeElement).toBe(item(container, 'First on page two'));

    await act(async () => {
      viewportStore.getState().setCurrentPage(2);
    });
    expect(item(container, 'Nested section').getAttribute('aria-current')).toBe('location');
    expect(item(container, 'Part three').dataset.currentAncestor).toBe('true');
    expect(item(container, 'Part three').getAttribute('aria-current')).toBeNull();

    const partThree = item(container, 'Part three');
    const toggle = partThree.querySelector<HTMLElement>('[data-outline-toggle]');
    if (!toggle) throw new Error('Missing Part three disclosure control.');
    await act(async () => toggle.click());
    expect(partThree.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[aria-label="Nested section"]')).toBeNull();

    await act(async () => {
      viewportStore.getState().setCurrentPage(1);
    });
    await act(async () => {
      viewportStore.getState().setCurrentPage(2);
    });
    expect(item(container, 'Part three').getAttribute('aria-expanded')).toBe('true');
    expect(item(container, 'Nested section').getAttribute('aria-current')).toBe('location');
  });

  it('marks nothing before the first destination and restores current state after remount', async () => {
    const outline: readonly OutlineNode[] = [
      {
        title: 'Later part',
        pageIndex: 1,
        children: [{ title: 'Later section', pageIndex: 2, children: [] }],
      },
    ];
    const engine = makeEngine(outline);
    const onNavigate = vi.fn();
    await act(async () => root.render(createElement(OutlinePanel, { engine, onNavigate })));

    expect(container.querySelector('[aria-current]')).toBeNull();
    await act(async () => {
      viewportStore.getState().setCurrentPage(2);
    });
    expect(item(container, 'Later section').getAttribute('aria-current')).toBe('location');

    await act(async () => root.render(null));
    await act(async () => root.render(createElement(OutlinePanel, { engine, onNavigate })));
    expect(item(container, 'Later part').getAttribute('aria-expanded')).toBe('true');
    expect(item(container, 'Later section').getAttribute('aria-current')).toBe('location');
  });

  it('isolates malformed destinations while preserving their subtrees and valid siblings', async () => {
    const onNavigate = vi.fn();
    const outline: readonly OutlineNode[] = [
      {
        title: 'No destination',
        pageIndex: null,
        children: [{ title: 'Reachable child', pageIndex: 1, children: [] }],
      },
      { title: 'Fractional', pageIndex: 0.5, children: [] },
      { title: 'Not a number', pageIndex: Number.NaN, children: [] },
      { title: 'Out of range', pageIndex: 99, children: [] },
      { title: 'Valid sibling', pageIndex: 2, children: [] },
    ];
    await act(async () =>
      root.render(createElement(OutlinePanel, { engine: makeEngine(outline), onNavigate })),
    );

    for (const title of ['No destination', 'Fractional', 'Not a number', 'Out of range']) {
      const treeItem = item(container, title);
      expect(treeItem.getAttribute('aria-disabled')).toBe('true');
      expect(treeItem.hasAttribute('disabled')).toBe(false);
    }

    await act(async () => item(container, 'No destination').click());
    expect(item(container, 'No destination').getAttribute('aria-expanded')).toBe('true');
    expect(onNavigate).not.toHaveBeenCalled();

    await act(async () => item(container, 'Fractional').click());
    await act(async () => item(container, 'Not a number').click());
    await act(async () => item(container, 'Out of range').click());
    expect(onNavigate).not.toHaveBeenCalled();

    item(container, 'Reachable child').focus();
    await act(async () => press(item(container, 'Reachable child'), ' '));
    await act(async () => item(container, 'Valid sibling').click());
    expect(onNavigate.mock.calls).toEqual([
      [1, 'auto'],
      [2, 'auto'],
    ]);
  });

  it('shows a plain empty state instead of an empty tree', async () => {
    await act(async () =>
      root.render(createElement(OutlinePanel, { engine: makeEngine([]), onNavigate: vi.fn() })),
    );

    expect(container.textContent).toContain('This document has no bookmarks.');
    expect(container.querySelector('[role="tree"]')).toBeNull();
  });
});
