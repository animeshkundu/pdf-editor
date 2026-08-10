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
  Check,
  ChevronsUpDown,
  Command,
  Download,
  FolderOpen,
  MoreHorizontal,
  Moon,
  PanelTop,
  Redo2,
  Save,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
import { registerOfflineApp, subscribeOfflineStatus } from '@/lib/persistence/service-worker';
import { useDocumentStore } from '@/lib/store/document';
import { useToolStore, type EditorTool } from '@/lib/store/tools';
import CommandPalette from './CommandPalette';
import DocumentPanel, {
  DocumentNavigator,
  type NavigatorTab,
  type PanelKind,
} from './DocumentPanels';
import DocumentViewport from './DocumentViewport';
import SelectionActionBar, { type SelectionAction } from './SelectionActionBar';
import PasswordDialog from './PasswordDialog';
import { DesignedTooltip } from './DesignedControls';
import ToolIcon, { type ToolIconName } from './ToolIcon';

type Theme = 'light' | 'dark';
type Density = 'compact' | 'comfortable' | 'touch';
type PdfEngine = EngineTypes['PdfEngine'];
type PdfEngineFactory = EngineTypes['PdfEngineFactory'];
type SearchHit = EngineTypes['SearchHit'];
const { EngineRequestError } = engineErrors;
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
  readonly icon: ToolIconName;
}[] = [
  { kind: 'markup', label: 'Comment', icon: 'comment' },
  { kind: 'comments', label: 'Comments', icon: 'comment' },
  { kind: 'organize', label: 'Organize Pages', icon: 'pages' },
  { kind: 'forms', label: 'Fill and Sign', icon: 'sign' },
  { kind: 'security', label: 'Protect', icon: 'protect' },
  { kind: 'compare', label: 'Compare', icon: 'compare' },
  { kind: 'convert', label: 'Convert and OCR', icon: 'convert' },
  { kind: 'accessibility', label: 'Accessibility', icon: 'accessibility' },
  { kind: 'print', label: 'Print', icon: 'print' },
  { kind: 'automation', label: 'Automation', icon: 'automation' },
  { kind: 'history', label: 'History', icon: 'history' },
  { kind: 'capabilities', label: 'Tools and capabilities', icon: 'tools' },
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
  readonly active: PanelKind | null;
  readonly navigator: NavigatorTab;
  readonly error: string;
} {
  const key = `papertrail:panels:${name}`;
  try {
    const serialized = window.localStorage.getItem(key);
    if (!serialized) return { key, active: null, navigator: 'pages', error: '' };
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') throw new Error('Panel layout is not an object.');
    const record = value as {
      readonly active?: unknown;
      readonly navigator?: unknown;
      readonly open?: unknown;
    };
    const validKinds = new Set(PANEL_TOOLS.map(({ kind }) => kind));
    const oldOpen = Array.isArray(record.open) ? record.open : [];
    const active =
      typeof record.active === 'string' && validKinds.has(record.active as PanelKind)
        ? (record.active as PanelKind)
        : (oldOpen.find((kind): kind is PanelKind => validKinds.has(kind as PanelKind)) ??
          null);
    const navigatorTabs = new Set<NavigatorTab>(['pages', 'outline', 'attachments', 'search']);
    const navigator =
      typeof record.navigator === 'string' &&
      navigatorTabs.has(record.navigator as NavigatorTab)
        ? (record.navigator as NavigatorTab)
        : (oldOpen.find((kind): kind is NavigatorTab =>
            navigatorTabs.has(kind as NavigatorTab),
          ) ?? 'pages');
    return {
      key,
      active,
      navigator,
      error: '',
    };
  } catch (layoutError) {
    const detail =
      layoutError instanceof Error ? layoutError.message : 'Unknown panel-layout error.';
    return {
      key,
      active: null,
      navigator: 'pages',
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
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [navigatorTab, setNavigatorTab] = useState<NavigatorTab>('pages');
  const [findFocusRequest, setFindFocusRequest] = useState(0);
  const [panelLayoutKey, setPanelLayoutKey] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutRemapping, setShortcutRemappingState] = useState<ShortcutRemapping>(
    initialShortcutSettings.remapping,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialShortcutSettings.error);
  const [notice, setNotice] = useState('');
  const [offlineReady, setOfflineReady] = useState(false);
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
  const pendingPanelRef = useRef<PanelKind | null>(null);
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
    const unsubscribe = subscribeOfflineStatus((status) => {
      setOfflineReady(status.state === 'ready');
      if (status.state === 'error') setError(status.message);
    });
    void registerOfflineApp().catch(() => {
      // The subscriber above owns the visible, actionable error.
    });
    return unsubscribe;
  }, []);

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
        JSON.stringify({ active: activePanel, navigator: navigatorTab }),
      );
    } catch (layoutError) {
      const detail =
        layoutError instanceof Error ? layoutError.message : 'Unknown panel-layout error.';
      window.setTimeout(
        () => setNotice(`The panel layout could not be saved locally. ${detail}`),
        0,
      );
    }
  }, [activePanel, engine, navigatorTab, panelLayoutKey]);

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
    setNavigatorTab('search');
    setFindFocusRequest((current) => current + 1);
  }, [engine]);

  useEffect(() => {
    if (findFocusRequest === 0) return;
    searchInputRef.current?.focus();
  }, [findFocusRequest]);

  const showPanel = useCallback(
    (kind: PanelKind) => {
      if (!engine && kind !== 'capabilities') {
        if (loading) {
          pendingPanelRef.current = kind;
        } else {
          setNotice(
            `Open a PDF to use ${PANEL_TOOLS.find((tool) => tool.kind === kind)?.label}.`,
          );
        }
        return;
      }
      setSelectionAction(null);
      setActivePanel(kind);
    },
    [engine, loading],
  );

  const closeAllPanels = useCallback(() => {
    setActivePanel(null);
    setSelectionAction(null);
    requestAnimationFrame(() => viewportRef.current?.focus());
  }, []);

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
        const pendingPanel = pendingPanelRef.current;
        pendingPanelRef.current = null;
        setActivePanel(pendingPanel ?? panelLayout.active);
        setNavigatorTab(panelLayout.navigator);
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
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
      pages: () => setNavigatorTab('pages'),
      outline: () => setNavigatorTab('outline'),
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
        if (selectionAction || activePanel) {
          event.preventDefault();
          setSelectionAction(null);
          setActivePanel(null);
          viewportRef.current?.focus();
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
    activePanel,
    activeTool,
    commandContext,
    engine,
    paletteOpen,
    resetTool,
    selectionAction,
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
          <button
            type="button"
            className="toolbar-collapsible"
            aria-label="Commands"
            onClick={openPalette}
          >
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
            className="icon-control toolbar-collapsible"
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
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="toolbar-overflow"
                aria-label="More editor actions"
              >
                <MoreHorizontal aria-hidden="true" size={18} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="toolbar-overflow-menu"
                side="bottom"
                align="end"
                sideOffset={6}
              >
                <DropdownMenu.Item onSelect={openPalette}>
                  <Command aria-hidden="true" size={15} /> Commands
                </DropdownMenu.Item>
                {engine ? (
                  <>
                    <DropdownMenu.Item
                      disabled={!journal.canUndo}
                      onSelect={() => {
                        void engine
                          .undo()
                          .then(onMutation)
                          .catch((undoError: unknown) => {
                            const detail =
                              undoError instanceof Error
                                ? undoError.message
                                : 'Unknown undo error.';
                            setError(`Undo failed. ${detail}`);
                          });
                      }}
                    >
                      <Undo2 aria-hidden="true" size={15} /> Undo document change
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      disabled={!journal.canRedo}
                      onSelect={() => {
                        void engine
                          .redo()
                          .then(onMutation)
                          .catch((redoError: unknown) => {
                            const detail =
                              redoError instanceof Error
                                ? redoError.message
                                : 'Unknown redo error.';
                            setError(`Redo failed. ${detail}`);
                          });
                      }}
                    >
                      <Redo2 aria-hidden="true" size={15} /> Redo document change
                    </DropdownMenu.Item>
                  </>
                ) : null}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onSelect={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}
                >
                  {theme === 'light' ? (
                    <Moon aria-hidden="true" size={15} />
                  ) : (
                    <Sun aria-hidden="true" size={15} />
                  )}
                  Use {theme === 'light' ? 'dark' : 'light'} theme
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      <nav aria-label="PDF tools" className="command-bar">
        <button
          type="button"
          className={activePanel === 'markup' ? 'active' : ''}
          onClick={() => showPanel('markup')}
        >
          <ToolIcon name="edit" size={16} />
          <span>Edit Text and Images</span>
        </button>
        <button
          type="button"
          className={activePanel === 'markup' ? 'active' : ''}
          onClick={() => {
            selectTool('note');
            showPanel('markup');
          }}
        >
          <ToolIcon name="comment" size={16} />
          <span>Comment</span>
        </button>
        <button
          type="button"
          className={activePanel === 'markup' ? 'active' : ''}
          onClick={() => {
            selectTool('redaction-mark');
            showPanel('markup');
          }}
        >
          <ToolIcon name="redact" size={16} />
          <span>Redact</span>
        </button>
        {PANEL_TOOLS.filter(({ kind }) => kind !== 'markup').map(({ kind, label, icon }) => (
          <button
            ref={(element) => {
              if (element) panelButtonRefs.current.set(kind, element);
              else panelButtonRefs.current.delete(kind);
            }}
            type="button"
            key={kind}
            className={activePanel === kind ? 'active' : ''}
            aria-pressed={activePanel === kind}
            onClick={() => showPanel(kind)}
          >
            <ToolIcon name={icon} size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="workspace" aria-busy={loading}>
        <aside className="navigator-rail" aria-label="Navigator">
          {engine ? (
            <DocumentNavigator
              tab={navigatorTab}
              onTabChange={setNavigatorTab}
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
          ) : (
            <div className="navigator-empty">
              <span className="eyebrow">Navigator</span>
              <p>
                Open a PDF to browse thumbnails, bookmarks, attachments, and search results.
              </p>
            </div>
          )}
        </aside>

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

        <aside className="contextual-rail" aria-label="Contextual properties">
          {engine && (selectionAction || activePanel) ? (
            <header className="contextual-rail-header">
              <span className="eyebrow">
                {selectionAction ? 'Current selection' : 'Active tool'}
              </span>
              <button type="button" aria-label="Close contextual rail" onClick={closeAllPanels}>
                Close
              </button>
            </header>
          ) : null}
          {engine && selectionAction ? (
            <SelectionActionBar
              engine={engine}
              action={selectionAction}
              onMutation={onMutation}
              onClose={() => setSelectionAction(null)}
              onError={setError}
              onNotice={setNotice}
            />
          ) : engine && activePanel ? (
            <DocumentPanel
              key={`${documentEpoch}-${activePanel}`}
              kind={activePanel}
              label={
                PANEL_TOOLS.find((tool) => tool.kind === activePanel)?.label ?? activePanel
              }
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
          ) : (
            <div className="contextual-empty">
              <span className="eyebrow">Properties</span>
              <h2>{engine ? 'Ready for selection' : 'Open a PDF'}</h2>
              <p>
                {engine
                  ? 'Select text or choose a tool to see only the properties relevant to your current task.'
                  : 'Your document viewport stays central. Its contextual properties appear here when a PDF is open.'}
              </p>
            </div>
          )}
        </aside>
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
            <DesignedTooltip label="Zoom out">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => viewportRef.current?.zoomBy(1 / 1.2)}
              >
                <ZoomOut aria-hidden="true" size={15} />
              </button>
            </DesignedTooltip>
            <output ref={zoomRef} aria-label="Zoom level">
              100%
            </output>
            <DesignedTooltip label="Zoom in">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => viewportRef.current?.zoomBy(1.2)}
              >
                <ZoomIn aria-hidden="true" size={15} />
              </button>
            </DesignedTooltip>
            <output ref={currentPageRef} aria-label="Current page">
              1 / {engine.info.pages.length}
            </output>
            <output ref={analysisStatusRef} aria-label="Analysis scope">
              Analysis pending
            </output>
            {activePanel || selectionAction ? (
              <DesignedTooltip label="Close contextual rail">
                <button
                  type="button"
                  aria-label="Close contextual rail"
                  onClick={closeAllPanels}
                >
                  <PanelTop aria-hidden="true" size={15} />
                </button>
              </DesignedTooltip>
            ) : null}
          </div>
        ) : (
          <span>{offlineReady ? 'LOCAL · Offline ready' : 'LOCAL processing'}</span>
        )}
        <span className="status-tool">
          Tool:{' '}
          {activeTool === 'default'
            ? 'Select and pan'
            : activeTool
                .replaceAll('-', ' ')
                .replace(/^./, (letter) => letter.toUpperCase())}{' '}
          · Escape returns to select and pan{offlineReady ? ' · Offline ready' : ''}
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
