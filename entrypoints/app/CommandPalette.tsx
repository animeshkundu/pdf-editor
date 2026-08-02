import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command, Download, RotateCcw, Settings2, Upload } from 'lucide-react';
import commandRegistry, {
  COMMANDS,
  shortcutValidationError,
  validateShortcutRemapping,
  type ShortcutRemapping,
} from '@/lib/commands/registry';
import type { EngineTypes } from '@/lib/engine/port';
import FeatureBadge from './FeatureBadge';

interface EditorCommand {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly status: EngineTypes['FeatureStatus'];
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  readonly open: boolean;
  readonly commands: readonly EditorCommand[];
  readonly remapping: ShortcutRemapping;
  readonly onRemappingChange: (remapping: ShortcutRemapping) => void;
  readonly onClose: () => void;
}

function downloadRemapping(remapping: ShortcutRemapping): void {
  const url = URL.createObjectURL(
    new Blob([commandRegistry.exportRemapping(remapping)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'papertrail-shortcuts.json';
  link.click();
  URL.revokeObjectURL(url);
}

function ShortcutEditorRow({
  command,
  remapping,
  onRemappingChange,
  onError,
}: {
  readonly command: EditorCommand;
  readonly remapping: ShortcutRemapping;
  readonly onRemappingChange: (remapping: ShortcutRemapping) => void;
  readonly onError: (message: string) => void;
}) {
  const definition = COMMANDS.find(({ id }) => id === command.id);
  const current = remapping[command.id] ?? definition?.shortcut ?? '';
  const [draft, setDraft] = useState(current);

  const commit = () => {
    const shortcut = draft.trim().replace(/\s+/g, '');
    const validationError = shortcutValidationError(shortcut);
    if (validationError) {
      onError(`${command.label}: ${validationError}`);
      setDraft(current);
      return;
    }
    const next = { ...remapping, [command.id]: shortcut };
    try {
      validateShortcutRemapping(next);
      onRemappingChange(next);
      onError('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'This shortcut is invalid.');
      setDraft(current);
    }
  };

  return (
    <div className="shortcut-editor-row">
      <label>
        <span>{command.label}</span>
        <input
          value={draft}
          aria-label={`Shortcut for ${command.label}`}
          placeholder="Disabled"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
      </label>
      <button
        type="button"
        aria-label={`Disable shortcut for ${command.label}`}
        onClick={() => {
          const next = { ...remapping, [command.id]: '' };
          onRemappingChange(next);
          setDraft('');
          onError('');
        }}
      >
        Disable
      </button>
    </div>
  );
}

export default function CommandPalette({
  open,
  commands,
  remapping,
  onRemappingChange,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingShortcuts, setEditingShortcuts] = useState(false);
  const [shortcutError, setShortcutError] = useState('');
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? commands.filter((command) => command.label.toLocaleLowerCase().includes(needle))
      : commands;
  }, [commands, query]);

  function runCommand(command: EditorCommand): void {
    if (command.disabled) return;
    void command.run();
    setQuery('');
    setSelectedIndex(0);
    onClose();
  }

  function moveSelection(direction: 1 | -1): void {
    if (visible.length === 0) return;
    let next = selectedIndex;
    for (let offset = 0; offset < visible.length; offset += 1) {
      next = (next + direction + visible.length) % visible.length;
      if (!visible[next]?.disabled) break;
    }
    setSelectedIndex(next);
    optionRefs.current[next]?.focus();
  }

  function importShortcuts(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file
      .text()
      .then((serialized) => commandRegistry.importRemapping(serialized))
      .then((nextRemapping) => {
        onRemappingChange(nextRemapping);
        setShortcutError('');
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown shortcut file error.';
        setShortcutError(`Importing shortcut settings failed. ${detail}`);
      });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setQuery('');
          setEditingShortcuts(false);
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="palette-backdrop" />
        <Dialog.Content asChild>
          <section className="command-palette" aria-describedby={undefined}>
            <header className="palette-header">
              <Command aria-hidden="true" size={18} />
              <Dialog.Title asChild>
                <h2>Commands</h2>
              </Dialog.Title>
              <button
                type="button"
                className="shortcut-editor-toggle"
                aria-pressed={editingShortcuts}
                onClick={() => setEditingShortcuts((current) => !current)}
              >
                <Settings2 aria-hidden="true" size={16} />
                {editingShortcuts ? 'Back to commands' : 'Edit shortcuts'}
              </button>
            </header>
            {editingShortcuts ? (
              <section className="shortcut-editor" aria-label="Shortcut settings">
                <p>
                  Enter bindings such as Mod+K or Shift+M. They stay on this device and apply
                  immediately.
                </p>
                <div className="shortcut-editor-actions">
                  <button type="button" onClick={() => onRemappingChange({})}>
                    <RotateCcw aria-hidden="true" size={15} /> Reset all
                  </button>
                  <button type="button" onClick={() => downloadRemapping(remapping)}>
                    <Download aria-hidden="true" size={15} /> Export
                  </button>
                  <button type="button" onClick={() => importInput.current?.click()}>
                    <Upload aria-hidden="true" size={15} /> Import
                  </button>
                </div>
                <input
                  ref={importInput}
                  hidden
                  type="file"
                  accept="application/json,.json"
                  aria-label="Import shortcut settings"
                  onChange={importShortcuts}
                />
                {shortcutError ? <p role="alert">{shortcutError}</p> : null}
                <div className="shortcut-editor-list">
                  {commands.map((command) => (
                    <ShortcutEditorRow
                      key={`${command.id}:${remapping[command.id] ?? ''}`}
                      command={command}
                      remapping={remapping}
                      onRemappingChange={onRemappingChange}
                      onError={setShortcutError}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <>
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveSelection(1);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveSelection(-1);
                    } else if (event.key === 'Enter') {
                      event.preventDefault();
                      const command = visible[selectedIndex];
                      if (command) runCommand(command);
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setQuery('');
                      setSelectedIndex(0);
                      onClose();
                    }
                  }}
                  placeholder="Type a command"
                  aria-label="Filter commands"
                />
                <div className="palette-results" role="listbox" aria-label="Available commands">
                  {visible.map((command, index) => (
                    <button
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={index === selectedIndex}
                      aria-disabled={command.disabled}
                      title={command.disabledReason}
                      key={command.id}
                      onFocus={() => setSelectedIndex(index)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          moveSelection(1);
                        } else if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          moveSelection(-1);
                        } else if (event.key === 'Enter') {
                          event.preventDefault();
                          runCommand(command);
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          setQuery('');
                          setSelectedIndex(0);
                          onClose();
                        }
                      }}
                      onClick={() => runCommand(command)}
                    >
                      <span>
                        {command.label}
                        <FeatureBadge status={command.status} />
                        {command.disabledReason ? (
                          <small>{command.disabledReason}</small>
                        ) : null}
                      </span>
                      {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                    </button>
                  ))}
                  {visible.length === 0 ? (
                    <p className="empty-message">No matching commands</p>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
