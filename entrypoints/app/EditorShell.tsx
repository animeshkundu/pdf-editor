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
  Accessibility,
  Check,
  ChevronsUpDown,
  Command,
  Download,
  FilePenLine,
  FileArchive,
  FileSearch,
  GitCompareArrows,
  FolderOpen,
  History,
  Info,
  MessageSquareText,
  Moon,
  NotebookTabs,
  PanelTop,
  Printer,
  PanelRightClose,
  Redo2,
  Save,
  ShieldCheck,
  ScanText,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
  Workflow,
} from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import type { EngineTypes } from '@/lib/engine/port';
import commandRegistry, {
  type CommandAction,
  type CommandContext,
  type CommandState,
  type ResolvedCommand,
} from '@/lib/commands/registry';
import { formatShortcut } from '@/lib/commands/shortcuts';
import { OpfsSnapshotStore, type RecoveryEntry } from '@/lib/persistence/opfs';
import { useDocumentStore } from '@/lib/store/document';
import CommandPalette from './CommandPalette';
import DocumentPanel from './DocumentPanels';
import DocumentViewport from './DocumentViewport';
import SelectionActionBar, { type SelectionAction } from './SelectionActionBar';

type Theme = 'light' | 'dark';
type Density = 'compact' | 'comfortable' | 'touch';
type PdfEngine = EngineTypes['PdfEngine'];
type PdfEngineFactory = EngineTypes['PdfEngineFactory'];
type SearchHit = EngineTypes['SearchHit'];
type PanelKind =
  | 'pages'
  | 'outline'
  | 'attachments'
  | 'search'
  | 'markup'
  | 'comments'
  | 'organize'
  | 'forms'
  | 'security'
  | 'compare'
  | 'convert'
  | 'accessibility'
  | 'print'
  | 'automation'
  | 'history'
  | 'capabilities';
interface DocumentViewportHandle {
  goToPage(pageIndex: number): void;
  zoomBy(factor: number): void;
  resetZoom(): void;
  fitWidth(): void;
  rotateView(degrees: 90 | -90): void;
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
  { kind: 'markup', label: 'Markup', icon: FilePenLine },
  { kind: 'comments', label: 'Comments', icon: MessageSquareText },
  { kind: 'organize', label: 'Organize', icon: PanelTop },
  { kind: 'forms', label: 'Forms', icon: NotebookTabs },
  { kind: 'security', label: 'Protect', icon: ShieldCheck },
  { kind: 'compare', label: 'Compare', icon: GitCompareArrows },
  { kind: 'convert', label: 'Convert', icon: ScanText },
  { kind: 'accessibility', label: 'Access', icon: Accessibility },
  { kind: 'print', label: 'Print', icon: Printer },
  { kind: 'automation', label: 'Automate', icon: Workflow },
  { kind: 'history', label: 'History', icon: History },
  { kind: 'capabilities', label: 'Scope', icon: Info },
];

interface LocalWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface LocalFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<LocalWritable>;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker(options?: {
    readonly multiple?: boolean;
    readonly types?: readonly {
      readonly description: string;
      readonly accept: Readonly<Record<string, readonly string[]>>;
    }[];
  }): Promise<readonly LocalFileHandle[]>;
  showSaveFilePicker(options?: {
    readonly suggestedName?: string;
    readonly types?: readonly {
      readonly description: string;
      readonly accept: Readonly<Record<string, readonly string[]>>;
    }[];
  }): Promise<LocalFileHandle>;
}

function hasOpenFilePicker(value: Window): value is FilePickerWindow {
  return 'showOpenFilePicker' in value;
}

function hasSaveFilePicker(value: Window): value is FilePickerWindow {
  return 'showSaveFilePicker' in value;
}

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
  const [fileHandle, setFileHandle] = useState<LocalFileHandle | null>(null);
  const [recoveries, setRecoveries] = useState<readonly RecoveryEntry[]>([]);
  const [recoverySource, setRecoverySource] = useState<RecoveryEntry | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const commandShortcut = useMemo(() => formatShortcut('Mod+K'), []);
  const journal = useDocumentStore((state) => state.journal);
  const outputState = useDocumentStore((state) => state.output);
  const redactionNotice = useDocumentStore((state) => state.redactionNotice);
  const dirty = useDocumentStore((state) => state.dirty);
  const applyStoredMutation = useDocumentStore((state) => state.applyMutation);
  const setStoredEngine = useDocumentStore((state) => state.setEngine);
  const setStoredOutput = useDocumentStore((state) => state.setOutput);
  const handleEngineEvent = useDocumentStore((state) => state.handleEngineEvent);
  const markSaved = useDocumentStore((state) => state.markSaved);
  const markRecovered = useDocumentStore((state) => state.markRecovered);
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
  const unsubscribeEngineRef = useRef<(() => void) | null>(null);

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
      unsubscribeEngineRef.current?.();
      if (currentEngineRef.current) void currentEngineRef.current.close();
    },
    [],
  );

  useEffect(() => {
    if (!navigator.storage?.getDirectory) return;
    let active = true;
    void OpfsSnapshotStore.sweep(7 * 24 * 60 * 60 * 1_000)
      .then(() => OpfsSnapshotStore.list())
      .then((entries) => {
        if (active)
          setRecoveries(entries.sort((left, right) => right.modified - left.modified));
      })
      .catch((recoveryError: unknown) => {
        if (!active) return;
        const detail =
          recoveryError instanceof Error
            ? recoveryError.message
            : 'Unknown recovery storage error.';
        setError(`Checking crash recovery failed. ${detail}`);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const choosePanel = useCallback(
    (kind: PanelKind) => {
      if (activePanel === kind && panelOpen) {
        setPanelOpen(false);
      } else {
        setActivePanel(kind);
        setPanelOpen(true);
      }
    },
    [activePanel, panelOpen],
  );

  const showPanel = useCallback((kind: PanelKind) => {
    setActivePanel(kind);
    setPanelOpen(true);
  }, []);

  const openFile = useCallback(
    async (
      file: File,
      handle: LocalFileHandle | null = null,
      recoveredEntry: RecoveryEntry | null = null,
    ) => {
      if (
        dirty &&
        currentEngineRef.current &&
        !window.confirm(
          'This document has unsaved changes. Download or save it before opening another file. Select OK only to discard those changes.',
        )
      ) {
        return false;
      }
      openController.current?.abort();
      openController.current = new AbortController();
      setLoading(true);
      setError('');
      try {
        const nextEngine = await engineFactory(file, openController.current.signal);
        const previousEngine = currentEngineRef.current;
        unsubscribeEngineRef.current?.();
        unsubscribeEngineRef.current = nextEngine.subscribe((event) => {
          handleEngineEvent(event);
          if (event.event === 'persistence-error') {
            setError(`Crash recovery failed. ${event.message}`);
          } else if (event.event === 'javascript-disabled') {
            setError(event.message);
          }
        });
        currentEngineRef.current = nextEngine;
        setEngine(nextEngine);
        setStoredEngine(nextEngine);
        if (recoveredEntry) markRecovered();
        setFileHandle(handle);
        setRecoverySource(recoveredEntry);
        setDocumentEpoch((value) => value + 1);
        setSelectionAction(null);
        setActivePanel('pages');
        setPanelOpen(true);
        void nextEngine
          .getOutputState()
          .then(setStoredOutput)
          .catch((outputError: unknown) => {
            const detail =
              outputError instanceof Error
                ? outputError.message
                : 'Unknown output-state error.';
            setError(`Inspecting output safety failed. ${detail}`);
          });
        if (recoverySource && recoverySource.name !== recoveredEntry?.name) {
          await OpfsSnapshotStore.remove(recoverySource);
        }
        if (previousEngine) requestAnimationFrame(() => void previousEngine.close());
        return true;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return false;
        const detail = caught instanceof Error ? caught.message : 'Unknown document error.';
        setError(`Opening ${file.name} failed. ${detail}`);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [
      dirty,
      engineFactory,
      handleEngineEvent,
      markRecovered,
      recoverySource,
      setStoredEngine,
      setStoredOutput,
    ],
  );

  const openPicker = useCallback(() => {
    if (!hasOpenFilePicker(window)) {
      fileInputRef.current?.click();
      return;
    }
    void window
      .showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'PDF document',
            accept: { 'application/pdf': ['.pdf'] },
          },
        ],
      })
      .then(async ([handle]) => {
        if (handle) await openFile(await handle.getFile(), handle);
      })
      .catch((pickerError: unknown) => {
        if (pickerError instanceof DOMException && pickerError.name === 'AbortError') return;
        const detail =
          pickerError instanceof Error ? pickerError.message : 'Unknown file-picker error.';
        setError(`Opening a PDF failed. ${detail}`);
      });
  }, [openFile]);

  const onOutput = useCallback((data: ArrayBuffer, name: string) => {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const saveOutput = useCallback(
    async (saveAs: boolean) => {
      if (!engine) return;
      try {
        let target = saveAs ? null : fileHandle;
        if (saveAs && hasSaveFilePicker(window)) {
          target = await window.showSaveFilePicker({
            suggestedName: engine.info.name,
            types: [
              {
                description: 'PDF document',
                accept: { 'application/pdf': ['.pdf'] },
              },
            ],
          });
          setFileHandle(target);
        }
        const data = await engine.save({
          mode: 'full',
          garbage: 'deduplicate',
          compress: true,
          encrypt: 'keep',
        });
        if (target) {
          const writable = await target.createWritable();
          try {
            await writable.write(new Blob([data], { type: 'application/pdf' }));
            await writable.close();
          } catch (writeError) {
            await writable.abort?.();
            throw new Error('The selected file could not be updated.', { cause: writeError });
          }
        } else {
          onOutput(data, engine.info.name);
        }
        markSaved();
        if (recoverySource) {
          await OpfsSnapshotStore.remove(recoverySource);
          setRecoverySource(null);
        }
      } catch (saveError) {
        if (saveError instanceof DOMException && saveError.name === 'AbortError') return;
        const detail = saveError instanceof Error ? saveError.message : 'Unknown save error.';
        setError(
          `${fileHandle && !saveAs ? 'Saving' : 'Downloading'} the PDF failed. ${detail}`,
        );
      }
    },
    [engine, fileHandle, markSaved, onOutput, recoverySource],
  );

  const onMutation = useCallback(
    (result: EngineTypes['MutationResult']) => {
      applyStoredMutation(result);
      setDocumentEpoch((value) => value + 1);
      const current = currentEngineRef.current;
      if (current) {
        void current
          .getOutputState()
          .then(setStoredOutput)
          .catch((outputError: unknown) => {
            const detail =
              outputError instanceof Error
                ? outputError.message
                : 'Unknown output-state error.';
            setError(`Inspecting output safety failed. ${detail}`);
          });
      }
    },
    [applyStoredMutation, setStoredOutput],
  );

  const actions = useMemo<Readonly<Record<CommandAction, () => void | Promise<void>>>>(
    () => ({
      open: openPicker,
      palette: openPalette,
      save: () => saveOutput(false),
      saveAs: () => saveOutput(true),
      undo: async () => {
        if (engine) onMutation(await engine.undo());
      },
      redo: async () => {
        if (engine) onMutation(await engine.redo());
      },
      find: openFind,
      zoomIn: () => viewportRef.current?.zoomBy(1.2),
      zoomOut: () => viewportRef.current?.zoomBy(1 / 1.2),
      actualSize: () => viewportRef.current?.resetZoom(),
      fitWidth: () => viewportRef.current?.fitWidth(),
      pages: () => showPanel('pages'),
      outline: () => showPanel('outline'),
      comments: () => showPanel('comments'),
      organize: () => showPanel('organize'),
      forms: () => showPanel('forms'),
      security: () => showPanel('security'),
      redaction: () => showPanel('markup'),
      compare: () => showPanel('compare'),
      convert: () => showPanel('convert'),
      accessibility: () => showPanel('accessibility'),
      print: () => showPanel('print'),
      automation: () => showPanel('automation'),
      capabilities: () => showPanel('capabilities'),
      toggleTheme: () => setTheme((value) => (value === 'light' ? 'dark' : 'light')),
      cycleDensity: () =>
        setDensity((value) =>
          value === 'comfortable' ? 'compact' : value === 'compact' ? 'touch' : 'comfortable',
        ),
    }),
    [engine, onMutation, openFind, openPalette, openPicker, saveOutput, showPanel],
  );

  const commandState = useMemo<CommandState>(
    () => ({
      hasDocument: Boolean(engine),
      canUndo: journal.canUndo,
      canRedo: journal.canRedo,
      outputActionLabel: fileHandle ? 'Save' : 'Download',
      saveAsActionLabel: hasSaveFilePicker(window) ? 'Save As' : 'Download copy',
      theme,
    }),
    [engine, fileHandle, journal.canRedo, journal.canUndo, theme],
  );
  const commandContext = useMemo<CommandContext>(
    () => ({ ...commandState, actions }),
    [actions, commandState],
  );
  const commandMetadata = useMemo(
    () => commandRegistry.resolveCommandMetadata(commandState),
    [commandState],
  );
  const commands = useMemo<readonly ResolvedCommand[]>(
    () =>
      commandMetadata.map((command) => ({
        ...command,
        run: actions[command.action],
      })),
    [actions, commandMetadata],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && !paletteOpen) {
        viewportRef.current?.focus();
        return;
      }
      const command = commandRegistry.commandForKeyboardEvent(event, commandContext);
      if (!command) return;
      event.preventDefault();
      if (command.disabled) {
        setError(command.disabledReason ?? `${command.label} is unavailable.`);
        return;
      }
      try {
        const result = command.run();
        void Promise.resolve(result).catch((commandError: unknown) => {
          const detail =
            commandError instanceof Error ? commandError.message : 'Unknown command error.';
          setError(`${command.label} failed. ${detail}`);
        });
      } catch (commandError) {
        const detail =
          commandError instanceof Error ? commandError.message : 'Unknown command error.';
        setError(`${command.label} failed. ${detail}`);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandContext, paletteOpen]);

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
              ? `${engine.info.pages.length} ${
                  engine.info.pages.length === 1 ? 'page' : 'pages'
                } · LOCAL${outputState && !outputState.canPersist ? ' · recovery DEGRADED' : ''}`
              : 'Files stay on this device'}
          </small>
        </div>
        <div className="toolbar-actions">
          <button type="button" aria-label="Open document" onClick={openPicker}>
            <FolderOpen aria-hidden="true" size={16} />
            <span>Open</span>
          </button>
          {engine ? (
            <>
              <button
                type="button"
                aria-label={fileHandle ? 'Save PDF' : 'Download PDF'}
                onClick={() => void saveOutput(false)}
              >
                {fileHandle ? (
                  <Save aria-hidden="true" size={16} />
                ) : (
                  <Download aria-hidden="true" size={16} />
                )}
                <span>{fileHandle ? 'Save' : 'Download'}</span>
              </button>
              <button
                type="button"
                className="icon-control"
                aria-label="Undo document change"
                title={
                  journal.canUndo
                    ? 'Undo document change'
                    : 'There is no document change to undo.'
                }
                disabled={!journal.canUndo}
                onClick={() => {
                  void engine
                    .undo()
                    .then(onMutation)
                    .catch((undoError: unknown) => {
                      const detail =
                        undoError instanceof Error ? undoError.message : 'Unknown undo error.';
                      setError(`Undo failed. ${detail}`);
                    });
                }}
              >
                <Undo2 aria-hidden="true" size={16} />
              </button>
              <button
                type="button"
                className="icon-control"
                aria-label="Redo document change"
                title={
                  journal.canRedo
                    ? 'Redo document change'
                    : 'There is no document change to redo.'
                }
                disabled={!journal.canRedo}
                onClick={() => {
                  void engine
                    .redo()
                    .then(onMutation)
                    .catch((redoError: unknown) => {
                      const detail =
                        redoError instanceof Error ? redoError.message : 'Unknown redo error.';
                      setError(`Redo failed. ${detail}`);
                    });
                }}
              >
                <Redo2 aria-hidden="true" size={16} />
              </button>
            </>
          ) : null}
          <button type="button" aria-label="Commands" onClick={openPalette}>
            <Command aria-hidden="true" size={16} />
            <span>Commands</span>
            <kbd>{commandShortcut}</kbd>
          </button>
          <div className="density-control">
            <Select.Root
              value={density}
              onValueChange={(value) => setDensity(value as Density)}
            >
              <Select.Trigger className="density-select" aria-label="Interface density">
                <Select.Value />
                <Select.Icon>
                  <ChevronsUpDown aria-hidden="true" size={14} />
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="density-menu" position="popper" sideOffset={4}>
                  <Select.Viewport>
                    {(['compact', 'comfortable', 'touch'] as const).map((value) => (
                      <Select.Item className="density-option" key={value} value={value}>
                        <Select.ItemText>
                          {value.charAt(0).toLocaleUpperCase() + value.slice(1)}
                        </Select.ItemText>
                        <Select.ItemIndicator>
                          <Check aria-hidden="true" size={14} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>
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
              onSelectionAction={setSelectionAction}
              onMutation={onMutation}
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
              <div className="welcome-copy">
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
              </div>
              <div className="welcome-features" aria-label="Available viewer features">
                <span>
                  <strong>Private by construction</strong>
                  No upload, account, telemetry, or document-data request.
                </span>
                <span>
                  <strong>Built for long documents</strong>
                  512 px tiles and whole-document search stay responsive.
                </span>
                <span>
                  <strong>Accessible reading</strong>
                  Keyboard-first chrome and a logical assistive text surface.
                </span>
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
            onMutation={onMutation}
            onOutput={onOutput}
            onRotateView={(degrees) => viewportRef.current?.rotateView(degrees)}
            commands={commands}
            onError={setError}
          />
        ) : null}
      </main>

      {engine && selectionAction ? (
        <SelectionActionBar
          engine={engine}
          action={selectionAction}
          onMutation={onMutation}
          onClose={() => setSelectionAction(null)}
          onError={setError}
        />
      ) : null}

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
        hidden
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Open PDF"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openFile(file, null);
        }}
      />
      {recoveries[0] ? (
        <div className="recovery-toast" role="status" aria-live="polite">
          <span>
            Recovered local edits from {new Date(recoveries[0].modified).toLocaleString()} are
            available
            {recoveries.length > 1 ? ` for ${recoveries.length} documents` : ''}.
          </span>
          <button
            type="button"
            onClick={() => {
              const entry = recoveries[0];
              if (!entry) return;
              void OpfsSnapshotStore.read(entry)
                .then(async (data) => {
                  const opened = await openFile(
                    new File([data], 'Recovered document.pdf', {
                      type: 'application/pdf',
                      lastModified: entry.modified,
                    }),
                    null,
                    entry,
                  );
                  if (!opened) return;
                  setRecoveries((current) =>
                    current.filter((candidate) => candidate.name !== entry.name),
                  );
                })
                .catch((recoveryError: unknown) => {
                  const detail =
                    recoveryError instanceof Error
                      ? recoveryError.message
                      : 'Unknown recovery error.';
                  setError(`Recovering local edits failed. ${detail}`);
                });
            }}
          >
            Recover
          </button>
          <button
            type="button"
            onClick={() => {
              const entry = recoveries[0];
              if (!entry) return;
              void OpfsSnapshotStore.remove(entry)
                .then(() =>
                  setRecoveries((current) =>
                    current.filter((candidate) => candidate.name !== entry.name),
                  ),
                )
                .catch((recoveryError: unknown) => {
                  const detail =
                    recoveryError instanceof Error
                      ? recoveryError.message
                      : 'Unknown recovery error.';
                  setError(`Discarding recovered edits failed. ${detail}`);
                });
            }}
          >
            Discard
          </button>
        </div>
      ) : null}
      {redactionNotice ? (
        <div className="loading-toast" role="status">
          {redactionNotice}
        </div>
      ) : null}
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
