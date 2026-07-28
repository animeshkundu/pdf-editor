// @vitest-environment jsdom

import commandRegistry, {
  type CommandAction,
  type CommandContext,
} from '../lib/commands/registry';
import { formatShortcut } from '../lib/commands/shortcuts';

function context(overrides: Partial<Omit<CommandContext, 'actions'>> = {}): {
  readonly value: CommandContext;
  readonly invoked: CommandAction[];
} {
  const invoked: CommandAction[] = [];
  const run = (action: CommandAction) => () => {
    invoked.push(action);
  };
  const actions: Record<CommandAction, () => void> = {
    open: run('open'),
    palette: run('palette'),
    save: run('save'),
    saveAs: run('saveAs'),
    undo: run('undo'),
    redo: run('redo'),
    find: run('find'),
    zoomIn: run('zoomIn'),
    zoomOut: run('zoomOut'),
    actualSize: run('actualSize'),
    fitWidth: run('fitWidth'),
    pages: run('pages'),
    outline: run('outline'),
    comments: run('comments'),
    organize: run('organize'),
    forms: run('forms'),
    security: run('security'),
    compare: run('compare'),
    convert: run('convert'),
    accessibility: run('accessibility'),
    print: run('print'),
    automation: run('automation'),
    capabilities: run('capabilities'),
    toggleTheme: run('toggleTheme'),
    cycleDensity: run('cycleDensity'),
  };
  return {
    value: {
      hasDocument: true,
      canUndo: false,
      canRedo: false,
      outputActionLabel: 'Download',
      saveAsActionLabel: 'Download copy',
      theme: 'light',
      ...overrides,
      actions,
    },
    invoked,
  };
}

describe('AUTO-001/AUTO-002 command registry', () => {
  it('uses one definition for platform labels, disabled reasons, and visible output semantics', () => {
    const { value } = context({ hasDocument: false });
    const commands = commandRegistry.resolveCommands(value, {}, { platform: 'Win32' });
    expect(commands.find((command) => command.id === 'save')).toMatchObject({
      label: 'Download',
      shortcut: 'Ctrl S',
      disabled: true,
      disabledReason: 'Open a PDF to use this command.',
    });
    expect(formatShortcut('Mod+K', { platform: 'MacIntel' })).toBe('⌘ K');
  });

  it('parses imported pipelines for preview without executing them', async () => {
    const { value, invoked } = context();
    const preview = commandRegistry.parsePipeline(
      JSON.stringify({
        version: 1,
        name: 'Local output',
        steps: [{ commandId: 'save' }],
      }),
    );
    expect(preview.commands).toEqual([{ id: 'save', label: 'save', status: 'EQUIV' }]);
    expect(invoked).toEqual([]);

    await commandRegistry.executePipeline(preview.pipeline, value);
    expect(invoked).toEqual(['save']);
  });

  it('rejects interactive commands in imported pipelines', () => {
    expect(() =>
      commandRegistry.parsePipeline(
        JSON.stringify({
          version: 1,
          name: 'Unsafe import',
          steps: [{ commandId: 'open' }],
        }),
      ),
    ).toThrow('"open" cannot run in an automation pipeline');
    expect(() =>
      commandRegistry.parsePipeline(
        JSON.stringify({
          version: 1,
          name: 'Interactive save',
          steps: [{ commandId: 'save-as' }],
        }),
      ),
    ).toThrow('"save-as" cannot run in an automation pipeline');
  });

  it('leaves native text undo with the active input owner', () => {
    const { value } = context({ canUndo: true });
    const input = document.createElement('input');
    document.body.append(input);
    let matched: ReturnType<typeof commandRegistry.commandForKeyboardEvent> = null;
    input.addEventListener('keydown', (event) => {
      matched = commandRegistry.commandForKeyboardEvent(event, value);
    });
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
      }),
    );
    expect(matched).toBeNull();
    input.remove();
  });
});
