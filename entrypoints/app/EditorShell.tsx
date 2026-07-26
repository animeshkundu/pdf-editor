import { useState } from 'react';

/**
 * Structural shell only.
 *
 * The layout follows Acrobat's mental model — global bar, left tools rail, document
 * pane, right contextual panel — because that is the model Acrobat refugees already
 * have. The execution is deliberately not Acrobat's: labels always accompany icons,
 * panels are resizable and may be open simultaneously, and nothing occludes the
 * document.
 *
 * This file stays small on purpose. photo-tools' equivalent grew to 1,725 lines
 * holding menus, shortcuts, seven dialogs, four panels, file I/O and worker
 * orchestration, which is the single worst thing about that codebase. Panels,
 * dialogs, the command bus and the tool registry each live in their own module.
 */
export default function EditorShell() {
  const [theme] = useState<'light' | 'dark'>('light');

  return (
    <div
      data-theme={theme}
      className="grid h-full grid-rows-[auto_1fr]"
      style={{ background: 'var(--surface-canvas)' }}
    >
      <a href="#document-pane" className="sr-only focus:not-sr-only">
        Skip to document
      </a>
      <h1 className="sr-only">PDF editor</h1>

      <header
        className="flex items-center border-b"
        style={{
          height: 'var(--row-height)',
          paddingInline: 'var(--space-200)',
          background: 'var(--surface-chrome)',
          borderColor: 'var(--border-subtle)',
        }}
        aria-label="Global toolbar"
      >
        <span style={{ color: 'var(--text-secondary)' }}>PDF Editor</span>
      </header>

      <main className="grid min-h-0" style={{ gridTemplateColumns: 'var(--rail-width) 1fr' }}>
        <nav
          aria-label="Tools"
          className="border-r"
          style={{ background: 'var(--surface-chrome)', borderColor: 'var(--border-subtle)' }}
        />
        <section
          id="document-pane"
          aria-label="Document"
          className="min-w-0 overflow-auto"
          tabIndex={-1}
        />
      </main>
    </div>
  );
}
