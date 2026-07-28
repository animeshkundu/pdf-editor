import type { EngineTypes } from '../engine/port';
import {
  formatShortcut,
  isTextEntryTarget,
  matchesShortcut,
  type PlatformNavigator,
} from './shortcuts';

export type CommandAction =
  | 'open'
  | 'palette'
  | 'save'
  | 'saveAs'
  | 'undo'
  | 'redo'
  | 'find'
  | 'zoomIn'
  | 'zoomOut'
  | 'actualSize'
  | 'fitWidth'
  | 'pages'
  | 'outline'
  | 'comments'
  | 'organize'
  | 'forms'
  | 'security'
  | 'compare'
  | 'convert'
  | 'accessibility'
  | 'print'
  | 'automation'
  | 'capabilities'
  | 'toggleTheme'
  | 'cycleDensity';

export interface CommandContext {
  readonly hasDocument: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly outputActionLabel: 'Save' | 'Download';
  readonly saveAsActionLabel: 'Save As' | 'Download copy';
  readonly theme: 'light' | 'dark';
  readonly actions: Readonly<Record<CommandAction, () => void | Promise<void>>>;
}

export type CommandState = Omit<CommandContext, 'actions'>;

export interface CommandDefinition {
  readonly id: string;
  readonly parityId: string;
  readonly status: EngineTypes['FeatureStatus'];
  readonly label: string | ((context: CommandState) => string);
  readonly action: CommandAction;
  readonly shortcut?: string;
  readonly requiresDocument?: boolean;
  readonly enabled?: (context: CommandState) => boolean;
  readonly disabledReason?: (context: CommandState) => string;
  readonly pipelineSafe: boolean;
}

export interface ResolvedCommand {
  readonly id: string;
  readonly parityId: string;
  readonly status: EngineTypes['FeatureStatus'];
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly run: () => void | Promise<void>;
}

export interface ResolvedCommandMetadata extends Omit<ResolvedCommand, 'run'> {
  readonly action: CommandAction;
}

export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'commands',
    parityId: 'AUTO-001',
    status: 'LOCAL',
    label: 'Open command palette',
    action: 'palette',
    shortcut: 'Mod+K',
    pipelineSafe: false,
  },
  {
    id: 'open',
    parityId: 'VIEW-001',
    status: 'LOCAL',
    label: 'Open PDF',
    action: 'open',
    shortcut: 'Mod+O',
    pipelineSafe: false,
  },
  {
    id: 'save',
    parityId: 'VIEW-037',
    status: 'EQUIV',
    label: (context) => context.outputActionLabel,
    action: 'save',
    shortcut: 'Mod+S',
    requiresDocument: true,
    pipelineSafe: true,
  },
  {
    id: 'save-as',
    parityId: 'VIEW-037',
    status: 'EQUIV',
    label: (context) => context.saveAsActionLabel,
    action: 'saveAs',
    shortcut: 'Mod+Shift+S',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'undo',
    parityId: 'PAGE-020',
    status: 'LOCAL',
    label: 'Undo document change',
    action: 'undo',
    shortcut: 'Mod+Z',
    requiresDocument: true,
    enabled: (context) => context.canUndo,
    disabledReason: () => 'There is no document change to undo.',
    pipelineSafe: false,
  },
  {
    id: 'redo',
    parityId: 'PAGE-020',
    status: 'LOCAL',
    label: 'Redo document change',
    action: 'redo',
    shortcut: 'Mod+Shift+Z',
    requiresDocument: true,
    enabled: (context) => context.canRedo,
    disabledReason: () => 'There is no document change to redo.',
    pipelineSafe: false,
  },
  {
    id: 'find',
    parityId: 'FIND-001',
    status: 'EQUIV',
    label: 'Find in document',
    action: 'find',
    shortcut: 'Mod+F',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'zoom-in',
    parityId: 'VIEW-007',
    status: 'LOCAL',
    label: 'Zoom in',
    action: 'zoomIn',
    shortcut: 'Mod++',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'zoom-out',
    parityId: 'VIEW-007',
    status: 'LOCAL',
    label: 'Zoom out',
    action: 'zoomOut',
    shortcut: 'Mod+-',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'actual-size',
    parityId: 'VIEW-011',
    status: 'LOCAL',
    label: 'Actual size',
    action: 'actualSize',
    shortcut: 'Mod+0',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'fit-width',
    parityId: 'VIEW-008',
    status: 'LOCAL',
    label: 'Fit page width',
    action: 'fitWidth',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'pages',
    parityId: 'VIEW-020',
    status: 'LOCAL',
    label: 'Show page thumbnails',
    action: 'pages',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'outline',
    parityId: 'VIEW-021',
    status: 'LOCAL',
    label: 'Show document outline',
    action: 'outline',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'comments',
    parityId: 'CMNT-001',
    status: 'LOCAL',
    label: 'Review comments',
    action: 'comments',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'organize',
    parityId: 'PAGE-001',
    status: 'LOCAL',
    label: 'Organize pages',
    action: 'organize',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'forms',
    parityId: 'FORM-009',
    status: 'LOCAL',
    label: 'Fill and prepare forms',
    action: 'forms',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'security',
    parityId: 'SIGN-020',
    status: 'LOCAL',
    label: 'Security and redaction',
    action: 'security',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'compare',
    parityId: 'CMPR-001',
    status: 'LOCAL',
    label: 'Compare documents',
    action: 'compare',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'convert',
    parityId: 'CONV-017',
    status: 'DEGRADED',
    label: 'Convert, OCR, and validate PDF/A',
    action: 'convert',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'accessibility',
    parityId: 'A11Y-042',
    status: 'EQUIV',
    label: 'Accessibility and Read Out Loud',
    action: 'accessibility',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'print',
    parityId: 'PRNT-001',
    status: 'EQUIV',
    label: 'Print document',
    action: 'print',
    shortcut: 'Mod+P',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'automation',
    parityId: 'AUTO-002',
    status: 'LOCAL',
    label: 'Build automation pipeline',
    action: 'automation',
    requiresDocument: true,
    pipelineSafe: false,
  },
  {
    id: 'capabilities',
    parityId: 'AUTO-001',
    status: 'LOCAL',
    label: 'Show capability scope',
    action: 'capabilities',
    pipelineSafe: false,
  },
  {
    id: 'theme',
    parityId: 'A11Y-043',
    status: 'LOCAL',
    label: (context) => (context.theme === 'light' ? 'Use dark theme' : 'Use light theme'),
    action: 'toggleTheme',
    pipelineSafe: false,
  },
  {
    id: 'density',
    parityId: 'A11Y-043',
    status: 'LOCAL',
    label: 'Cycle interface density',
    action: 'cycleDensity',
    pipelineSafe: false,
  },
];

export type ShortcutRemapping = Readonly<Record<string, string>>;

export function resolveCommands(
  context: CommandContext,
  remapping: ShortcutRemapping = {},
  nav?: PlatformNavigator,
): readonly ResolvedCommand[] {
  return resolveCommandMetadata(context, remapping, nav).map((command) => ({
    ...command,
    run: context.actions[command.action],
  }));
}

export function resolveCommandMetadata(
  context: CommandState,
  remapping: ShortcutRemapping = {},
  nav?: PlatformNavigator,
): readonly ResolvedCommandMetadata[] {
  return COMMANDS.map((definition) => {
    const requiresDocument = definition.requiresDocument && !context.hasDocument;
    const enabled = definition.enabled?.(context) ?? true;
    const disabled = Boolean(requiresDocument || !enabled);
    const reason = requiresDocument
      ? 'Open a PDF to use this command.'
      : disabled
        ? definition.disabledReason?.(context)
        : undefined;
    const shortcut = remapping[definition.id] ?? definition.shortcut;
    return {
      id: definition.id,
      parityId: definition.parityId,
      status: definition.status,
      label:
        typeof definition.label === 'function' ? definition.label(context) : definition.label,
      ...(shortcut ? { shortcut: formatShortcut(shortcut, nav) } : {}),
      disabled,
      ...(reason ? { disabledReason: reason } : {}),
      action: definition.action,
    };
  });
}

export function commandById(id: string): CommandDefinition {
  const command = COMMANDS.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Unknown command "${id}".`);
  return command;
}

export function commandForKeyboardEvent(
  event: KeyboardEvent,
  context: CommandContext,
  remapping: ShortcutRemapping = {},
  nav?: PlatformNavigator,
): ResolvedCommand | null {
  if (isTextEntryTarget(event.target)) {
    const key = event.key.toLocaleLowerCase();
    if (!(event.ctrlKey || event.metaKey || event.altKey)) return null;
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) return null;
  }
  const resolved = new Map(
    resolveCommands(context, remapping, nav).map((command) => [command.id, command]),
  );
  const definition = COMMANDS.find((candidate) => {
    const shortcut = remapping[candidate.id] ?? candidate.shortcut;
    return shortcut ? matchesShortcut(event, shortcut, nav) : false;
  });
  return definition ? (resolved.get(definition.id) ?? null) : null;
}

export function exportRemapping(remapping: ShortcutRemapping): string {
  return JSON.stringify({ version: 1, shortcuts: remapping }, null, 2);
}

export function importRemapping(serialized: string): ShortcutRemapping {
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('shortcuts' in value) ||
    typeof value.shortcuts !== 'object' ||
    value.shortcuts === null
  ) {
    throw new Error('This shortcut file is not a supported version.');
  }
  const shortcuts: Record<string, string> = {};
  for (const [id, shortcut] of Object.entries(value.shortcuts)) {
    commandById(id);
    if (typeof shortcut !== 'string' || !shortcut.trim()) {
      throw new Error(`The shortcut for "${id}" is empty or invalid.`);
    }
    shortcuts[id] = shortcut;
  }
  return shortcuts;
}

export interface PipelineStep {
  readonly commandId: string;
}

export interface Pipeline {
  readonly version: 1;
  readonly name: string;
  readonly steps: readonly PipelineStep[];
}

export interface PipelinePreview {
  readonly pipeline: Pipeline;
  readonly commands: readonly {
    readonly id: string;
    readonly label: string;
    readonly status: EngineTypes['FeatureStatus'];
  }[];
}

export function parsePipeline(serialized: string): PipelinePreview {
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('steps' in value) ||
    !Array.isArray(value.steps)
  ) {
    throw new Error('This pipeline file is not a supported version.');
  }
  const steps = value.steps.map((step, index): PipelineStep => {
    if (
      typeof step !== 'object' ||
      step === null ||
      !('commandId' in step) ||
      typeof step.commandId !== 'string'
    ) {
      throw new Error(`Pipeline step ${index + 1} is invalid.`);
    }
    const command = commandById(step.commandId);
    if (!command.pipelineSafe) {
      throw new Error(`"${command.id}" cannot run in an automation pipeline.`);
    }
    return { commandId: command.id };
  });
  const pipeline: Pipeline = { version: 1, name: value.name, steps };
  return {
    pipeline,
    commands: steps.map(({ commandId }) => {
      const command = commandById(commandId);
      return {
        id: command.id,
        label: typeof command.label === 'string' ? command.label : command.id,
        status: command.status,
      };
    }),
  };
}

export async function executePipeline(
  pipeline: Pipeline,
  context: CommandContext,
): Promise<void> {
  const resolved = new Map(resolveCommands(context).map((command) => [command.id, command]));
  for (const step of pipeline.steps) {
    const command = resolved.get(step.commandId);
    if (!command) throw new Error(`Unknown pipeline command "${step.commandId}".`);
    if (command.disabled) {
      throw new Error(command.disabledReason ?? `"${command.label}" is unavailable.`);
    }
    await command.run();
  }
}

export default {
  COMMANDS,
  commandById,
  commandForKeyboardEvent,
  executePipeline,
  exportRemapping,
  importRemapping,
  parsePipeline,
  resolveCommandMetadata,
  resolveCommands,
};
