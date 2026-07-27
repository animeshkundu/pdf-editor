import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  BookOpen,
  ChevronsUpDown,
  Command,
  FileArchive,
  FileSearch,
  FolderOpen,
  Info,
  Moon,
  PanelRightClose,
  Sun,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';
import CommandPalette from './CommandPalette';
import DocumentPanel from './DocumentPanels';
import DocumentViewport from './DocumentViewport';

type Theme = 'light' | 'dark';
type Density = 'compact' | 'comfortable' | 'touch';
type PdfEngine = EngineTypes['PdfEngine'];
type PdfEngineFactory = EngineTypes['PdfEngineFactory'];
type SearchHit = EngineTypes['SearchHit'];
type PanelKind = 'pages' | 'outline' | 'attachments' | 'search' | 'capabilities';
interface EditorCommand {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly run: () => void;
}
interface DocumentViewportHandle {
  goToPage(pageIndex: number): void;
  zoomBy(factor: number): void;
  resetZoom(): void;
  fitWidth(): void;
  toggleSelectionMode(): void;
  focus(): void;
  showSearchHit(hit: SearchHit | null): void;
}

const PANEL_TOOLS: readonly {
  readonly kind: PanelKind;
  readonly label: string;
  readonly icon: typeof BookOpen;
}[] = [
  { kind: 'pages', label: 'Pages', icon: ChevronsUpDown },
  { kind: 'outline', label: 'Outline', icon: BookOpen },
  { kind: 'attachments', label: 'Files', icon: FileArchive },
  { kind: 'search', label: 'Find', icon: FileSearch },
  { kind: 'capabilities', label: 'Scope', icon: Info },
];

export default function EditorShell({
  engineFactory,
}: {
  readonly engineFactory: PdfEngineFactory;
}) {
  const [theme, setTheme] = useState<Theme>('light');
  const [density, setDensity] = useState<Density>('comfortable');
  const [engine, setEngine] = useState<PdfEngine | null>(null);
  const [activePanel, setActivePanel] = useState<PanelKind>('pages');
  const [panelOpen, setPanelOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<DocumentViewportHandle>(null);
  const currentPageRef = useRef<HTMLOutputElement>(null);
  const zoomRef = useRef<HTMLOutputElement>(null);
  const analysisStatusRef = useRef<HTMLOutputElement>(null);
  const selectionModeRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const paletteOriginRef = useRef<HTMLElement | null>(null);
  const openController = useRef<AbortController | null>(null);
  const currentEngineRef = useRef<PdfEngine | null>(null);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    currentEngineRef.current = engine;
  }, [engine]);

  useEffect(
    () => () => {
      openController.current?.abort();
      if (currentEngineRef.current) void currentEngineRef.current.close();
    },
    [],
  );

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);
  const openPalette = useCallback(() => {
    paletteOriginRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    const origin = paletteOriginRef.current;
    paletteOriginRef.current = null;
    requestAnimationFrame(() => origin?.focus());
  }, []);
  const openFind = useCallback(() => {
    if (!engine) return;
    setActivePanel('search');
    setPanelOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [engine]);

  useEffect(() => {
    if (engine && panelOpen && activePanel === 'search') searchInputRef.current?.focus();
  }, [activePanel, engine, panelOpen]);

  const openFile = async (file: File) => {
    openController.current?.abort();
    openController.current = new AbortController();
    setLoading(true);
    setError('');
    try {
      const nextEngine = await engineFactory(file, openController.current.signal);
      const previousEngine = engine;
      currentEngineRef.current = nextEngine;
      setEngine(nextEngine);
      setDocumentEpoch((value) => value + 1);
      setActivePanel('pages');
      setPanelOpen(true);
      if (previousEngine) requestAnimationFrame(() => void previousEngine.close());
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      const detail = caught instanceof Error ? caught.message : 'Unknown document error.';
      setError(`Opening ${file.name} failed. ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const commands = useMemo<readonly EditorCommand[]>(
    () => [
      { id: 'open', label: 'Open PDF', shortcut: 'Ctrl+O', run: openPicker },
      ...(engine
        ? [
            { id: 'find', label: 'Find in document', shortcut: 'Ctrl+F', run: openFind },
            {
              id: 'zoom-in',
              label: 'Zoom in',
              shortcut: 'Ctrl++',
              run: () => viewportRef.current?.zoomBy(1.2),
            },
            {
              id: 'zoom-out',
              label: 'Zoom out',
              shortcut: 'Ctrl+-',
              run: () => viewportRef.current?.zoomBy(1 / 1.2),
            },
            {
              id: 'actual-size',
              label: 'Actual size',
              shortcut: 'Ctrl+0',
              run: () => viewportRef.current?.resetZoom(),
            },
            {
              id: 'fit-width',
              label: 'Fit page width',
              run: () => viewportRef.current?.fitWidth(),
            },
            {
              id: 'pages',
              label: 'Show page thumbnails',
              run: () => {
                setActivePanel('pages');
                setPanelOpen(true);
              },
            },
            {
              id: 'outline',
              label: 'Show document outline',
              run: () => {
                setActivePanel('outline');
                setPanelOpen(true);
              },
            },
          ]
        : []),
      {
        id: 'theme',
        label: theme === 'light' ? 'Use dark theme' : 'Use light theme',
        run: () => setTheme((value) => (value === 'light' ? 'dark' : 'light')),
      },
      {
        id: 'density',
        label: 'Cycle interface density',
        run: () =>
          setDensity((value) =>
            value === 'comfortable' ? 'compact' : value === 'compact' ? 'touch' : 'comfortable',
          ),
      },
    ],
    [engine, openFind, openPicker, theme],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette();
      } else if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openPicker();
      } else if (modifier && event.key.toLowerCase() === 'f' && engine) {
        event.preventDefault();
        openFind();
      } else if (modifier && engine && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        viewportRef.current?.zoomBy(1.2);
      } else if (modifier && engine && event.key === '-') {
        event.preventDefault();
        viewportRef.current?.zoomBy(1 / 1.2);
      } else if (modifier && engine && event.key === '0') {
        event.preventDefault();
        viewportRef.current?.resetZoom();
      } else if (event.key === 'Escape' && !paletteOpen) {
        viewportRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, openFind, openPalette, openPicker, paletteOpen]);

  const choosePanel = (kind: PanelKind) => {
    if (activePanel === kind && panelOpen) {
      setPanelOpen(false);
    } else {
      setActivePanel(kind);
      setPanelOpen(true);
    }
  };

  const onSearchHit = (hit: SearchHit) => viewportRef.current?.showSearchHit(hit);

  return (
    <div data-theme={theme} className="editor-shell">
      <a href="#document-pane" className="skip-link">
        Skip to document
      </a>
      <h1 className="sr-only">PDF editor</h1>

      <header className="global-bar" aria-label="Global toolbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>
            <strong>Papertrail</strong>
            <small>Private PDF workspace</small>
          </span>
        </div>
        <div className="document-title">
          <strong>{engine?.info.title ?? 'No document open'}</strong>
          <small>
            {engine
              ? `${engine.info.pages.length} ${engine.info.pages.length === 1 ? 'page' : 'pages'} · LOCAL`
              : 'Files stay on this device'}
          </small>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={openPicker}>
            <FolderOpen aria-hidden="true" size={16} />
            <span>Open</span>
          </button>
          <button type="button" onClick={openPalette}>
            <Command aria-hidden="true" size={16} />
            <span>Commands</span>
            <kbd>Ctrl K</kbd>
          </button>
          <label className="compact-select">
            <span className="sr-only">Interface density</span>
            <select
              value={density}
              onChange={(event) => setDensity(event.target.value as Density)}
            >
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="touch">Touch</option>
            </select>
          </label>
          <button
            type="button"
            className="icon-control"
            aria-label={theme === 'light' ? 'Use dark theme' : 'Use light theme'}
            onClick={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? (
              <Moon aria-hidden="true" size={17} />
            ) : (
              <Sun aria-hidden="true" size={17} />
            )}
          </button>
        </div>
      </header>

      <main
        className={`workspace${panelOpen && engine ? ' panel-visible' : ''}`}
        aria-busy={loading}
      >
        <nav aria-label="Tools" className="tool-rail">
          {PANEL_TOOLS.map(({ kind, label, icon: Icon }) => (
            <button
              type="button"
              key={kind}
              className={activePanel === kind && panelOpen ? 'active' : ''}
              aria-pressed={activePanel === kind && panelOpen}
              onClick={() => choosePanel(kind)}
              disabled={!engine && kind !== 'capabilities'}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <section
          id="document-pane"
          className="document-pane"
          aria-label="Document"
          tabIndex={-1}
        >
          {engine ? (
            <DocumentViewport
              key={documentEpoch}
              ref={viewportRef}
              engine={engine}
              currentPageRef={currentPageRef}
              zoomRef={zoomRef}
              analysisStatusRef={analysisStatusRef}
              selectionModeRef={selectionModeRef}
              onFind={openFind}
              onError={setError}
            />
          ) : (
            <div
              className="welcome"
              onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void openFile(file);
              }}
            >
              <div className="welcome-icon" aria-hidden="true">
                <FolderOpen size={28} />
              </div>
              <span className="privacy-pill">100% LOCAL · ZERO EGRESS</span>
              <h2>Your PDF never leaves this device.</h2>
              <p>
                Open a document to render, search, select, and navigate it entirely in your
                browser.
              </p>
              <button type="button" className="primary-action" onClick={openPicker}>
                <FolderOpen aria-hidden="true" size={18} />
                Choose a PDF
              </button>
              <small>or drop a PDF here · up to the measured device limit</small>
              <div className="welcome-features" aria-label="Available viewer features">
                <span>512 px tiled rendering</span>
                <span>Whole-document search</span>
                <span>Assistive text surface</span>
              </div>
            </div>
          )}
        </section>

        {engine && panelOpen ? (
          <DocumentPanel
            key={documentEpoch}
            kind={activePanel}
            engine={engine}
            searchInputRef={searchInputRef}
            onNavigate={(pageIndex) => viewportRef.current?.goToPage(pageIndex)}
            onSearchHit={onSearchHit}
            onError={setError}
          />
        ) : null}
      </main>

      <footer className="status-bar" aria-label="Document status">
        {engine ? (
          <button
            ref={selectionModeRef}
            type="button"
            className="status-mode-control"
            aria-pressed="false"
            onClick={() => viewportRef.current?.toggleSelectionMode()}
          >
            Pan mode
          </button>
        ) : (
          <span>Ready</span>
        )}
        {engine ? (
          <div className="view-status">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => viewportRef.current?.zoomBy(1 / 1.2)}
            >
              <ZoomOut aria-hidden="true" size={15} />
            </button>
            <output ref={zoomRef} aria-label="Zoom level">
              100%
            </output>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => viewportRef.current?.zoomBy(1.2)}
            >
              <ZoomIn aria-hidden="true" size={15} />
            </button>
            <output ref={currentPageRef} aria-label="Current page">
              1 / {engine.info.pages.length}
            </output>
            <output ref={analysisStatusRef} aria-label="Analysis scope">
              Analysis pending
            </output>
            <button
              type="button"
              aria-label="Close contextual panel"
              onClick={() => setPanelOpen((value) => !value)}
            >
              <PanelRightClose aria-hidden="true" size={15} />
            </button>
          </div>
        ) : (
          <span>LOCAL processing</span>
        )}
      </footer>

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Open PDF"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openFile(file);
        }}
      />
      {error ? (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="loading-toast" role="status">
          Opening locally…
        </div>
      ) : null}
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
    </div>
  );
}
