import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  BookOpen,
  Accessibility,
  Check,
  ChevronDown,
  ChevronUp,
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
  X,
  ZoomIn,
  ZoomOut,
  Workflow,
} from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import * as Dialog from '@radix-ui/react-dialog';
import engineErrors, { type EngineTypes } from '@/lib/engine/port';
import commandRegistry, {
  type CommandAction,
  type CommandContext,
  type CommandState,
  type ResolvedCommand,
  type ShortcutRemapping,
} from '@/lib/commands/registry';
import { formatShortcut, isTextEntryTarget, matchesShortcut } from '@/lib/commands/shortcuts';
import { OpfsSnapshotStore, type RecoveryEntry } from '@/lib/persistence/opfs';
import { useDocumentStore } from '@/lib/store/document';
import { useToolStore, type EditorTool } from '@/lib/store/tools';
import CommandPalette from './CommandPalette';
import DocumentPanel, { CapabilitiesPanel } from './DocumentPanels';
import DocumentViewport from './DocumentViewport';
import SelectionActionBar, { type SelectionAction } from './SelectionActionBar';
import PasswordDialog from './PasswordDialog';

type Theme = 'light' | 'dark';
type Density = 'compact' | 'comfortable' | 'touch';
type PdfEngine = EngineTypes['PdfEngine'];
type PdfEngineFactory = EngineTypes['PdfEngineFactory'];
type SearchHit = EngineTypes['SearchHit'];
const { EngineRequestError } = engineErrors;
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

interface PendingPasswordOpen {
  readonly file: File;
  readonly handle: LocalFileHandle | null;
  readonly recoveredEntry: RecoveryEntry | null;
}
interface PendingOpenRequest extends PendingPasswordOpen {
  readonly password: string | undefined;
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

const TOOL_FAMILIES: readonly {
  readonly commandId: string;
  readonly shortcut: string;
  readonly panel: PanelKind | null;
  readonly tools: readonly EditorTool[];
}[] = [
  { commandId: 'default-tool', shortcut: 'V', panel: null, tools: ['default'] },
  {
    commandId: 'markup-family',
    shortcut: 'M',
    panel: 'markup',
    tools: ['note', 'highlight', 'free-text'],
  },
  {
    commandId: 'drawing-family',
    shortcut: 'D',
    panel: 'markup',
    tools: ['ink', 'shape'],
  },
  {
    commandId: 'redaction-tool',
    shortcut: 'R',
    panel: 'markup',
    tools: ['redaction-mark'],
  },
  {
    commandId: 'form-field-tool',
    shortcut: 'F',
    panel: 'forms',
    tools: ['form-field'],
  },
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

function loadShortcutSettings(): {
  readonly remapping: ShortcutRemapping;
  readonly error: string;
} {
  try {
    const serialized = window.localStorage.getItem('papertrail:shortcut-remapping');
    return {
      remapping: serialized ? commandRegistry.importRemapping(serialized) : {},
      error: '',
    };
  } catch (shortcutError) {
    const detail =
      shortcutError instanceof Error ? shortcutError.message : 'Unknown shortcut error.';
    return { remapping: {}, error: `Loading local shortcut settings failed. ${detail}` };
  }
}

function loadPanelLayout(name: string): {
  readonly key: string;
  readonly open: readonly PanelKind[];
  readonly collapsed: readonly PanelKind[];
  readonly widths: Readonly<Partial<Record<PanelKind, number>>>;
  readonly error: string;
} {
  const key = `papertrail:panels:${name}`;
  try {
    const serialized = window.localStorage.getItem(key);
    if (!serialized) return { key, open: ['pages'], collapsed: [], widths: {}, error: '' };
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') throw new Error('Panel layout is not an object.');
    const record = value as {
      readonly open?: unknown;
      readonly collapsed?: unknown;
      readonly widths?: unknown;
    };
    const validKinds = new Set(PANEL_TOOLS.map(({ kind }) => kind));
    const open: readonly PanelKind[] = Array.isArray(record.open)
      ? record.open.filter((kind): kind is PanelKind => validKinds.has(kind as PanelKind))
      : ['pages'];
    const collapsed: readonly PanelKind[] = Array.isArray(record.collapsed)
      ? record.collapsed.filter((kind): kind is PanelKind => validKinds.has(kind as PanelKind))
      : [];
    const widths: Partial<Record<PanelKind, number>> = {};
    if (record.widths && typeof record.widths === 'object') {
      for (const [kind, width] of Object.entries(record.widths)) {
        if (validKinds.has(kind as PanelKind) && typeof width === 'number') {
          widths[kind as PanelKind] = Math.min(480, Math.max(260, width));
        }
      }
    }
    return {
      key,
      open,
      collapsed,
      widths,
      error: '',
    };
  } catch (layoutError) {
    const detail =
      layoutError instanceof Error ? layoutError.message : 'Unknown panel-layout error.';
    return {
      key,
      open: ['pages'],
      collapsed: [],
      widths: {},
      error: `The saved panel layout could not be restored. ${detail}`,
    };
  }
}

export default function EditorShell({
  engineFactory,
}: {
  readonly engineFactory: PdfEngineFactory;
}) {
  const [initialShortcutSettings] = useState(loadShortcutSettings);
  const [theme, setTheme] = useState<Theme>('light');
  const [density, setDensity] = useState<Density>('comfortable');
  const [engine, setEngine] = useState<PdfEngine | null>(null);
  const [openPanels, setOpenPanels] = useState<readonly PanelKind[]>([]);
  const [collapsedPanels, setCollapsedPanels] = useState<readonly PanelKind[]>([]);
  const [panelWidths, setPanelWidths] = useState<Readonly<Partial<Record<PanelKind, number>>>>(
    {},
  );
  const [panelLayoutKey, setPanelLayoutKey] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutRemapping, setShortcutRemappingState] = useState<ShortcutRemapping>(
    initialShortcutSettings.remapping,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialShortcutSettings.error);
  const [notice, setNotice] = useState('');
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [fileHandle, setFileHandle] = useState<LocalFileHandle | null>(null);
  const [recoveries, setRecoveries] = useState<readonly RecoveryEntry[]>([]);
  const [recoverySource, setRecoverySource] = useState<RecoveryEntry | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [pendingPasswordOpen, setPendingPasswordOpen] = useState<PendingPasswordOpen | null>(
    null,
  );
  const [passwordError, setPasswordError] = useState('');
  const [pendingOpenRequest, setPendingOpenRequest] = useState<PendingOpenRequest | null>(null);
  const commandShortcut = useMemo(
    () => formatShortcut(shortcutRemapping.commands ?? 'Mod+K'),
    [shortcutRemapping],
  );
  const journal = useDocumentStore((state) => state.journal);
  const outputState = useDocumentStore((state) => state.output);
  const redactionNotice = useDocumentStore((state) => state.redactionNotice);
  const clearRedactionNotice = useDocumentStore((state) => state.setRedactionNotice);
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
  const unsavedDialogOriginRef = useRef<HTMLElement | null>(null);
  const panelButtonRefs = useRef(new Map<PanelKind, HTMLButtonElement>());
  const toolFamilyIndexRef = useRef<Record<string, number>>({});
  const currentEngineRef = useRef<PdfEngine | null>(null);
  const unsubscribeEngineRef = useRef<(() => void) | null>(null);
  const activeTool = useToolStore((state) => state.activeTool);
  const selectTool = useToolStore((state) => state.selectTool);
  const resetTool = useToolStore((state) => state.resetTool);
  const setShortcutRemapping = useCallback((nextRemapping: ShortcutRemapping) => {
    setShortcutRemappingState(nextRemapping);
    try {
      window.localStorage.setItem(
        'papertrail:shortcut-remapping',
        commandRegistry.exportRemapping(nextRemapping),
      );
    } catch (shortcutError) {
      const detail =
        shortcutError instanceof Error ? shortcutError.message : 'Unknown shortcut error.';
      setError(`Saving local shortcut settings failed. ${detail}`);
    }
  }, []);

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

  useEffect(() => {
    document.title = engine ? `${engine.info.name} — Papertrail` : 'Papertrail';
    return () => {
      document.title = 'Papertrail';
    };
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    const key = `papertrail:panels:${engine.info.name}`;
    if (panelLayoutKey !== key) return;
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({ open: openPanels, collapsed: collapsedPanels, widths: panelWidths }),
      );
    } catch (layoutError) {
      const detail =
        layoutError instanceof Error ? layoutError.message : 'Unknown panel-layout error.';
      window.setTimeout(
        () => setNotice(`The panel layout could not be saved locally. ${detail}`),
        0,
      );
    }
  }, [collapsedPanels, engine, openPanels, panelLayoutKey, panelWidths]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 8_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
    setOpenPanels((current) => (current.includes('search') ? current : [...current, 'search']));
    setCollapsedPanels((current) => current.filter((kind) => kind !== 'search'));
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [engine]);

  const choosePanel = useCallback(
    (kind: PanelKind) => {
      if (!engine && kind !== 'capabilities') {
        setNotice(
          `Open a PDF to use ${PANEL_TOOLS.find((tool) => tool.kind === kind)?.label}.`,
        );
        return;
      }
      setOpenPanels((current) =>
        current.includes(kind)
          ? current.filter((candidate) => candidate !== kind)
          : [...current, kind],
      );
      setCollapsedPanels((current) => current.filter((candidate) => candidate !== kind));
    },
    [engine],
  );

  const showPanel = useCallback((kind: PanelKind) => {
    setOpenPanels((current) => (current.includes(kind) ? current : [...current, kind]));
    setCollapsedPanels((current) => current.filter((candidate) => candidate !== kind));
  }, []);

  const closePanel = useCallback((kind: PanelKind) => {
    setOpenPanels((current) => current.filter((candidate) => candidate !== kind));
    setCollapsedPanels((current) => current.filter((candidate) => candidate !== kind));
    requestAnimationFrame(() => panelButtonRefs.current.get(kind)?.focus());
  }, []);

  const closeAllPanels = useCallback(() => {
    setOpenPanels([]);
    setCollapsedPanels([]);
    requestAnimationFrame(() => panelButtonRefs.current.get('pages')?.focus());
  }, []);

  const startPanelResize = useCallback(
    (kind: PanelKind, event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panelWidths[kind] ?? 304;
      const onMove = (moveEvent: PointerEvent) => {
        const width = Math.min(480, Math.max(260, startWidth + startX - moveEvent.clientX));
        setPanelWidths((current) => ({ ...current, [kind]: width }));
      };
      const finish = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish, { once: true });
      window.addEventListener('pointercancel', finish, { once: true });
    },
    [panelWidths],
  );

  const resizePanelFromKeyboard = useCallback(
    (kind: PanelKind, event: ReactKeyboardEvent<HTMLElement>) => {
      const currentWidth = panelWidths[kind] ?? 304;
      const nextWidth =
        event.key === 'ArrowLeft'
          ? currentWidth + 16
          : event.key === 'ArrowRight'
            ? currentWidth - 16
            : event.key === 'Home'
              ? 260
              : event.key === 'End'
                ? 480
                : null;
      if (nextWidth === null) return;
      event.preventDefault();
      setPanelWidths((current) => ({
        ...current,
        [kind]: Math.min(480, Math.max(260, nextWidth)),
      }));
    },
    [panelWidths],
  );

  const openFile = useCallback(
    async (
      file: File,
      handle: LocalFileHandle | null = null,
      recoveredEntry: RecoveryEntry | null = null,
      password?: string,
      discardAlreadyConfirmed = false,
    ) => {
      if (!discardAlreadyConfirmed && dirty && currentEngineRef.current) {
        unsavedDialogOriginRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingOpenRequest({ file, handle, recoveredEntry, password });
        return false;
      }
      openController.current?.abort();
      openController.current = new AbortController();
      setLoading(true);
      setError('');
      try {
        const nextEngine =
          password === undefined
            ? await engineFactory(file, openController.current.signal)
            : await engineFactory(file, openController.current.signal, password);
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
        const panelLayout = loadPanelLayout(nextEngine.info.name);
        setOpenPanels(panelLayout.open);
        setCollapsedPanels(panelLayout.collapsed);
        setPanelWidths(panelLayout.widths);
        setPanelLayoutKey(panelLayout.key);
        if (panelLayout.error) setNotice(panelLayout.error);
        setPendingPasswordOpen(null);
        setPasswordError('');
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
        if (
          caught instanceof EngineRequestError &&
          (caught.code === 'password_required' || caught.code === 'invalid_password')
        ) {
          setPendingPasswordOpen({ file, handle, recoveredEntry });
          setPasswordError(caught.code === 'invalid_password' ? caught.message : '');
          return false;
        }
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
    async (saveAs: boolean): Promise<boolean> => {
      if (!engine) return false;
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
        return true;
      } catch (saveError) {
        if (saveError instanceof DOMException && saveError.name === 'AbortError') return false;
        const detail = saveError instanceof Error ? saveError.message : 'Unknown save error.';
        setError(
          `${fileHandle && !saveAs ? 'Saving' : 'Downloading'} the PDF failed. ${detail}`,
        );
        return false;
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
      save: () => void saveOutput(false),
      saveAs: () => void saveOutput(true),
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
      defaultTool: resetTool,
      markupFamily: () => {
        selectTool('note');
        showPanel('markup');
      },
      drawingFamily: () => {
        selectTool('ink');
        showPanel('markup');
      },
      redactionTool: () => {
        selectTool('redaction-mark');
        showPanel('markup');
      },
      formFieldTool: () => {
        selectTool('form-field');
        showPanel('forms');
      },
    }),
    [
      engine,
      onMutation,
      openFind,
      openPalette,
      openPicker,
      resetTool,
      saveOutput,
      selectTool,
      showPanel,
    ],
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
    () => commandRegistry.resolveCommandMetadata(commandState, shortcutRemapping),
    [commandState, shortcutRemapping],
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
        const target = event.target;
        if (target instanceof Element && target.closest('[role="dialog"]')) return;
        if (activeTool !== 'default') {
          event.preventDefault();
          resetTool();
          return;
        }
        if (
          target instanceof Element &&
          target.closest(
            'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="searchbox"]',
          )
        ) {
          return;
        }
        viewportRef.current?.focus();
        return;
      }
      if (!paletteOpen && !isTextEntryTarget(event.target) && !event.altKey) {
        const family = TOOL_FAMILIES.find(({ commandId, shortcut }) => {
          const binding = shortcutRemapping[commandId] ?? shortcut;
          const shiftedBinding =
            event.shiftKey && !binding.split('+').includes('Shift')
              ? `Shift+${binding}`
              : binding;
          return matchesShortcut(event, shiftedBinding);
        });
        if (family) {
          event.preventDefault();
          if (!engine) {
            setNotice('Open a PDF to use document tools.');
            return;
          }
          const currentIndex = toolFamilyIndexRef.current[family.commandId] ?? -1;
          const nextIndex = event.shiftKey ? (currentIndex + 1) % family.tools.length : 0;
          toolFamilyIndexRef.current[family.commandId] = nextIndex;
          const nextTool = family.tools[nextIndex];
          if (nextTool === 'default') resetTool();
          else if (nextTool) selectTool(nextTool);
          if (family.panel) showPanel(family.panel);
          return;
        }
      }
      const command = commandRegistry.commandForKeyboardEvent(
        event,
        commandContext,
        shortcutRemapping,
      );
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
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    activeTool,
    commandContext,
    engine,
    paletteOpen,
    resetTool,
    selectTool,
    shortcutRemapping,
    showPanel,
  ]);

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
          <strong title={engine?.info.name ?? 'No document open'}>
            {engine?.info.name ?? 'No document open'}
          </strong>
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
                aria-describedby={!journal.canUndo ? 'undo-unavailable' : undefined}
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
                <span>Undo</span>
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
                aria-describedby={!journal.canRedo ? 'redo-unavailable' : undefined}
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
                <span>Redo</span>
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
            <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
          </button>
        </div>
      </header>

      <main
        className={`workspace${openPanels.length > 0 ? ' panels-visible' : ''}`}
        aria-busy={loading}
      >
        <nav aria-label="Tools" className="tool-rail">
          {PANEL_TOOLS.map(({ kind, label, icon: Icon }) => (
            <button
              ref={(element) => {
                if (element) panelButtonRefs.current.set(kind, element);
                else panelButtonRefs.current.delete(kind);
              }}
              type="button"
              key={kind}
              className={openPanels.includes(kind) ? 'active' : ''}
              aria-pressed={openPanels.includes(kind)}
              onClick={() => choosePanel(kind)}
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

        {openPanels.length > 0 ? (
          <aside className="panel-dock" aria-label="Open contextual panels">
            {openPanels.map((kind) => {
              const collapsed = collapsedPanels.includes(kind);
              const label = PANEL_TOOLS.find((tool) => tool.kind === kind)?.label ?? kind;
              return (
                <section
                  className="panel-frame"
                  data-collapsed={collapsed}
                  key={`${documentEpoch}-${kind}`}
                  style={{ width: `${panelWidths[kind] ?? 304}px` }}
                >
                  <div
                    role="separator"
                    tabIndex={0}
                    className="panel-resize-handle"
                    aria-label={`Resize ${label} panel`}
                    aria-orientation="vertical"
                    aria-valuemin={260}
                    aria-valuemax={480}
                    aria-valuenow={panelWidths[kind] ?? 304}
                    onPointerDown={(event) => startPanelResize(kind, event)}
                    onKeyDown={(event) => resizePanelFromKeyboard(kind, event)}
                  />
                  <header className="panel-chrome">
                    <strong>{label}</strong>
                    <span>
                      <button
                        type="button"
                        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label} panel`}
                        onClick={() =>
                          setCollapsedPanels((current) =>
                            current.includes(kind)
                              ? current.filter((candidate) => candidate !== kind)
                              : [...current, kind],
                          )
                        }
                      >
                        {collapsed ? (
                          <ChevronDown aria-hidden="true" size={16} />
                        ) : (
                          <ChevronUp aria-hidden="true" size={16} />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Close ${label} panel`}
                        onClick={() => closePanel(kind)}
                      >
                        <X aria-hidden="true" size={16} />
                      </button>
                    </span>
                  </header>
                  {!collapsed ? (
                    engine ? (
                      <DocumentPanel
                        kind={kind}
                        label={label}
                        engine={engine}
                        searchInputRef={searchInputRef}
                        onNavigate={(pageIndex) => viewportRef.current?.goToPage(pageIndex)}
                        onSearchHit={onSearchHit}
                        onMutation={onMutation}
                        onOutput={onOutput}
                        onRotateView={(degrees) => viewportRef.current?.rotateView(degrees)}
                        commands={commands}
                        onError={setError}
                        onNotice={setNotice}
                      />
                    ) : kind === 'capabilities' ? (
                      <aside className="context-panel" aria-label="capabilities panel">
                        <CapabilitiesPanel />
                      </aside>
                    ) : null
                  ) : null}
                </section>
              );
            })}
          </aside>
        ) : null}
      </main>

      {engine && selectionAction ? (
        <SelectionActionBar
          engine={engine}
          action={selectionAction}
          onMutation={onMutation}
          onClose={() => setSelectionAction(null)}
          onError={setError}
          onNotice={setNotice}
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
            {openPanels.length > 0 ? (
              <button
                type="button"
                aria-label="Close contextual panels"
                onClick={closeAllPanels}
              >
                <PanelRightClose aria-hidden="true" size={15} />
              </button>
            ) : null}
          </div>
        ) : (
          <span>LOCAL processing</span>
        )}
        <span className="status-tool">
          Tool:{' '}
          {activeTool === 'default'
            ? 'Select and pan'
            : activeTool
                .replaceAll('-', ' ')
                .replace(/^./, (letter) => letter.toUpperCase())}{' '}
          · Escape returns to select and pan
        </span>
      </footer>
      {!journal.canUndo ? (
        <span id="undo-unavailable" className="sr-only">
          There is no document change to undo.
        </span>
      ) : null}
      {!journal.canRedo ? (
        <span id="redo-unavailable" className="sr-only">
          There is no document change to redo.
        </span>
      ) : null}

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
      <div className="notice-stack" role="region" aria-label="Notifications">
        {error ? (
          <div className="notice-item notice-error" role="alert">
            <span>{error}</span>
            <div className="notice-actions">
              <button type="button" onClick={() => setError('')}>
                Dismiss
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="notice-item notice-status" role="status">
            <span>Opening locally…</span>
            <div className="notice-actions">
              <button type="button" onClick={() => openController.current?.abort()}>
                Cancel
              </button>
            </div>
          </div>
        ) : recoveries[0] ? (
          <div className="notice-item notice-status" role="status">
            <span>
              Recovered local edits from {new Date(recoveries[0].modified).toLocaleString()} are
              available{recoveries.length > 1 ? ` for ${recoveries.length} documents` : ''}.
            </span>
            <div className="notice-actions">
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
                      if (opened)
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
                    .then(() => setRecoveries((current) => current.slice(1)))
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
          </div>
        ) : redactionNotice ? (
          <div className="notice-item notice-status" role="status">
            <span>{redactionNotice}</span>
            <div className="notice-actions">
              <button type="button" onClick={() => clearRedactionNotice(null)}>
                Dismiss
              </button>
            </div>
          </div>
        ) : notice ? (
          <div className="notice-item notice-status" role="status">
            <span>{notice}</span>
            <div className="notice-actions">
              <button type="button" onClick={() => setNotice('')}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        remapping={shortcutRemapping}
        onRemappingChange={setShortcutRemapping}
        onClose={closePalette}
      />
      <PasswordDialog
        open={pendingPasswordOpen !== null}
        filename={pendingPasswordOpen?.file.name ?? ''}
        error={passwordError}
        busy={loading}
        onCancel={() => {
          setPendingPasswordOpen(null);
          setPasswordError('');
        }}
        onSubmit={(password) => {
          if (!pendingPasswordOpen) return;
          void openFile(
            pendingPasswordOpen.file,
            pendingPasswordOpen.handle,
            pendingPasswordOpen.recoveredEntry,
            password,
            true,
          );
        }}
      />
      <Dialog.Root
        open={pendingOpenRequest !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPendingOpenRequest(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="unsaved-dialog"
            aria-describedby="unsaved-dialog-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => unsavedDialogOriginRef.current?.focus());
            }}
          >
            <Dialog.Title>Save changes before opening another PDF?</Dialog.Title>
            <Dialog.Description id="unsaved-dialog-description">
              Your current document has unsaved changes. Save or download it, discard the
              changes, or cancel opening the new document.
            </Dialog.Description>
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => {
                  const request = pendingOpenRequest;
                  if (!request) return;
                  void saveOutput(false).then((saved) => {
                    if (!saved) return;
                    setPendingOpenRequest(null);
                    void openFile(
                      request.file,
                      request.handle,
                      request.recoveredEntry,
                      request.password,
                      true,
                    );
                  });
                }}
              >
                {fileHandle ? 'Save' : 'Download'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const request = pendingOpenRequest;
                  if (!request) return;
                  setPendingOpenRequest(null);
                  void openFile(
                    request.file,
                    request.handle,
                    request.recoveredEntry,
                    request.password,
                    true,
                  );
                }}
              >
                Discard
              </button>
              <Dialog.Close asChild>
                <button type="button" autoFocus>
                  Cancel
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
