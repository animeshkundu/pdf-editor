import { Copy, Highlighter, MessageSquareText, Strikethrough, Underline } from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';

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
  const [left, top, right, bottom] = action.viewportBounds;
  const placeBelow = top < 64;
  const x = Math.max(8, Math.min(window.innerWidth - 280, (left + right) / 2 - 140));
  const y = placeBelow ? bottom + 8 : top - 52;

  const add = (type: 'Highlight' | 'Underline' | 'StrikeOut' | 'Text') => {
    const quad = action.selection.quads[0];
    if (!quad) {
      onError('The selection has no writable text geometry.');
      return;
    }
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
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
        contents: type === 'Text' ? action.selection.text : '',
        color: type === 'Highlight' ? [1, 0.84, 0.2] : [0.29, 0.42, 0.97],
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
      role="toolbar"
      aria-label="Selection actions"
      data-side={placeBelow ? 'below' : 'above'}
      style={{ left: `${x}px`, top: `${Math.max(8, y)}px` }}
    >
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
      <button type="button" aria-label="Highlight selection" onClick={() => add('Highlight')}>
        <Highlighter aria-hidden="true" size={16} />
      </button>
      <button type="button" aria-label="Underline selection" onClick={() => add('Underline')}>
        <Underline aria-hidden="true" size={16} />
      </button>
      <button type="button" aria-label="Strike out selection" onClick={() => add('StrikeOut')}>
        <Strikethrough aria-hidden="true" size={16} />
      </button>
      <button type="button" aria-label="Comment on selection" onClick={() => add('Text')}>
        <MessageSquareText aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
