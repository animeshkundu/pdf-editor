import { useState } from 'react';
import {
  Copy,
  Highlighter,
  MessageSquareText,
  PencilLine,
  ShieldAlert,
  Strikethrough,
  Underline,
} from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';
import ActiveTextEntry from './ActiveTextEntry';

export interface SelectionAction {
  readonly selection: EngineTypes['TextSelection'];
  readonly viewportBounds: readonly [number, number, number, number];
}

export default function SelectionActionBar({
  engine,
  action,
  onMutation,
  onClose,
  onError,
}: {
  readonly engine: EngineTypes['PdfEngine'];
  readonly action: SelectionAction;
  readonly onMutation: (result: EngineTypes['MutationResult']) => void;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [left, top, right, bottom] = action.viewportBounds;
  const placeBelow = top < 64;
  const x = Math.max(8, Math.min(window.innerWidth - 280, (left + right) / 2 - 140));
  const y = placeBelow ? bottom + 8 : top - 52;

  const add = (type: 'Highlight' | 'Underline' | 'StrikeOut' | 'Text' | 'Redact') => {
    if (action.selection.quads.length === 0) {
      onError('The selection has no writable text geometry.');
      return;
    }
    const xs = action.selection.quads.flatMap((quad) => [quad[0], quad[2], quad[4], quad[6]]);
    const ys = action.selection.quads.flatMap((quad) => [quad[1], quad[3], quad[5], quad[7]]);
    const rect: EngineTypes['PdfRect'] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    void engine
      .addAnnotation({
        pageIndex: action.selection.pageIndex,
        type,
        rect,
        contents:
          type === 'Text'
            ? action.selection.text
            : type === 'Redact'
              ? 'Unapplied redaction mark'
              : '',
        color:
          type === 'Redact'
            ? [0, 0, 0]
            : type === 'Highlight'
              ? [1, 0.84, 0.2]
              : [0.29, 0.42, 0.97],
        opacity: type === 'Highlight' ? 0.35 : 1,
        flags: 4,
        ...(type === 'Text' ? {} : { quadPoints: action.selection.quads }),
      })
      .then((result) => {
        onMutation(result);
        onClose();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown annotation error.';
        onError(`Marking the selected text failed. ${detail}`);
      });
  };

  return (
    <div
      className="selection-action-bar"
      role={editing ? 'dialog' : 'toolbar'}
      aria-label={editing ? 'Edit selected text' : 'Selection actions'}
      data-side={placeBelow ? 'below' : 'above'}
      style={{ left: `${x}px`, top: `${Math.max(8, y)}px` }}
    >
      {editing ? (
        <ActiveTextEntry
          kind="existing-text"
          label="Replacement text"
          initialValue={action.selection.text}
          onCommit={(replacementText) => {
            setBusy(true);
            setRefusal(null);
            void engine
              .editExistingText({
                pageIndex: action.selection.pageIndex,
                originalText: action.selection.text,
                replacementText,
                quads: action.selection.quads,
                confirmSignatureInvalidation: false,
              })
              .then((result) => {
                onMutation(result);
                onClose();
              })
              .catch((error: unknown) => {
                setRefusal(
                  error instanceof Error ? error.message : 'Existing-text edit refused.',
                );
              })
              .finally(() => setBusy(false));
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <button
            type="button"
            aria-label="Copy selected text"
            onClick={() => {
              if (!navigator.clipboard) {
                onError('Copy is unavailable because this browser has no clipboard API.');
                return;
              }
              void navigator.clipboard
                .writeText(action.selection.text)
                .then(onClose)
                .catch((error: unknown) => {
                  const detail =
                    error instanceof Error ? error.message : 'Unknown clipboard error.';
                  onError(`Copying selected text failed. ${detail}`);
                });
            }}
          >
            <Copy aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            aria-label="Edit selected text"
            onClick={() => setEditing(true)}
          >
            <PencilLine aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            aria-label="Highlight selection"
            onClick={() => add('Highlight')}
          >
            <Highlighter aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            aria-label="Underline selection"
            onClick={() => add('Underline')}
          >
            <Underline aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            aria-label="Strike out selection"
            onClick={() => add('StrikeOut')}
          >
            <Strikethrough aria-hidden="true" size={16} />
          </button>
          <button type="button" aria-label="Comment on selection" onClick={() => add('Text')}>
            <MessageSquareText aria-hidden="true" size={16} />
          </button>
          <button
            type="button"
            aria-label="Mark selected text for redaction"
            onClick={() => add('Redact')}
          >
            <ShieldAlert aria-hidden="true" size={16} />
          </button>
        </>
      )}
      {busy ? <span role="status">Replacing text…</span> : null}
      {refusal ? <p role="alert">{refusal}</p> : null}
    </div>
  );
}
