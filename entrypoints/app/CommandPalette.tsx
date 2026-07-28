import { useMemo, useRef, useState } from 'react';
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
