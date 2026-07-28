import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'lucide-react';
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
  readonly onClose: () => void;
}

export default function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? commands.filter((command) => command.label.toLocaleLowerCase().includes(needle))
      : commands;
  }, [commands, query]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setQuery('');
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
            </header>
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a command"
              aria-label="Filter commands"
            />
            <div className="palette-results" role="listbox" aria-label="Available commands">
              {visible.map((command) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  aria-disabled={command.disabled}
                  title={command.disabledReason}
                  key={command.id}
                  onClick={() => {
                    if (command.disabled) return;
                    void command.run();
                    setQuery('');
                    onClose();
                  }}
                >
                  <span>
                    {command.label}
                    <FeatureBadge status={command.status} />
                    {command.disabledReason ? <small>{command.disabledReason}</small> : null}
                  </span>
                  {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                </button>
              ))}
              {visible.length === 0 ? (
                <p className="empty-message">No matching commands</p>
              ) : null}
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
