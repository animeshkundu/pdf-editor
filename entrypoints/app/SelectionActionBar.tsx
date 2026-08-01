import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
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
import { isTextEntryTarget } from '@/lib/commands/shortcuts';
import ActiveTextEntry from './ActiveTextEntry';

export interface SelectionAction {
  readonly selection: EngineTypes['TextSelection'];
  readonly viewportBounds: readonly [number, number, number, number];
  readonly crossPage?: boolean;
}

export default function SelectionActionBar({
  engine,
  action,
  onMutation,
  onClose,
  onError,
  onNotice,
}: {
  readonly engine: EngineTypes['PdfEngine'];
  readonly action: SelectionAction;
  readonly onMutation: (result: EngineTypes['MutationResult']) => void;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onNotice: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    readonly left: number;
    readonly top: number;
    readonly side: 'above' | 'below';
  }>({ left: 0, top: 0, side: 'below' });
  const [left, top, right, bottom] = action.viewportBounds;
  const canCopy = engine.info.permissions.copy;
  const canAnnotate = engine.info.permissions.annotate && !action.crossPage;
  const canEdit = engine.info.permissions.edit !== false && !action.crossPage;
  useEffect(() => {
    originRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const close = useCallback(() => {
    onClose();
    requestAnimationFrame(() => originRef.current?.focus());
  }, [onClose]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const place = () => {
      const bounds = toolbar.getBoundingClientRect();
      const styles = getComputedStyle(document.documentElement);
      const gap =
        Number.parseFloat(styles.getPropertyValue('--space-100')) ||
        Number.parseFloat(styles.getPropertyValue('--focus-ring-offset')) ||
        4;
      const availableAbove = top - gap;
      const availableBelow = window.innerHeight - bottom - gap;
      const side =
        availableAbove >= bounds.height || availableAbove >= availableBelow ? 'above' : 'below';
      setPosition({
        left: Math.max(
          gap,
          Math.min(window.innerWidth - bounds.width - gap, (left + right - bounds.width) / 2),
        ),
        top: Math.max(
          gap,
          Math.min(
            window.innerHeight - bounds.height - gap,
            side === 'below' ? bottom + gap : top - bounds.height - gap,
          ),
        ),
        side,
      });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(toolbar);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [bottom, busy, editing, left, refusal, right, top]);

  const moveToolbarFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || isTextEntryTarget(event.target)) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    if (controls.length === 0) return;
    const current = controls.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? controls.length - 1
          : event.key === 'ArrowLeft'
            ? (Math.max(0, current) - 1 + controls.length) % controls.length
            : (Math.max(-1, current) + 1) % controls.length;
    event.preventDefault();
    controls[next]?.focus();
  };

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
        close();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown annotation error.';
        onError(`Marking the selected text failed. ${detail}`);
      });
  };

  return (
    <div
      ref={toolbarRef}
      className="selection-action-bar"
      role="toolbar"
      aria-label={editing ? 'Edit selected text' : 'Selection actions'}
      data-side={position.side}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onKeyDown={moveToolbarFocus}
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
                onNotice(
                  result.mechanism === 'content-splice'
                    ? 'Replaced the selected text in its content stream. Every byte outside the verified text span was preserved.'
                    : 'Replaced the selected ASCII text through the verified Helvetica overlay path. The original glyphs were removed and the replacement appearance was checked before commit.',
                );
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
            disabled={!canCopy}
            aria-describedby={!canCopy ? 'selection-copy-limit' : undefined}
            onClick={() => {
              if (!navigator.clipboard) {
                onError('Copy is unavailable because this browser has no clipboard API.');
                return;
              }
              void navigator.clipboard
                .writeText(action.selection.text)
                .then(close)
                .catch((error: unknown) => {
                  const detail =
                    error instanceof Error ? error.message : 'Unknown clipboard error.';
                  onError(`Copying selected text failed. ${detail}`);
                });
            }}
          >
            <Copy aria-hidden="true" size={16} />
            <span>Copy</span>
          </button>
          <button
            type="button"
            aria-label="Edit selected text"
            disabled={!canEdit}
            aria-describedby={!canEdit ? 'selection-edit-limit' : undefined}
            onClick={() => setEditing(true)}
          >
            <PencilLine aria-hidden="true" size={16} />
            <span>Edit</span>
          </button>
          <button
            type="button"
            aria-label="Highlight selection"
            disabled={!canAnnotate}
            aria-describedby={!canAnnotate ? 'selection-annotation-limit' : undefined}
            onClick={() => add('Highlight')}
          >
            <Highlighter aria-hidden="true" size={16} />
            <span>Highlight</span>
          </button>
          <button
            type="button"
            aria-label="Underline selection"
            disabled={!canAnnotate}
            aria-describedby={!canAnnotate ? 'selection-annotation-limit' : undefined}
            onClick={() => add('Underline')}
          >
            <Underline aria-hidden="true" size={16} />
            <span>Underline</span>
          </button>
          <button
            type="button"
            aria-label="Strike out selection"
            disabled={!canAnnotate}
            aria-describedby={!canAnnotate ? 'selection-annotation-limit' : undefined}
            onClick={() => add('StrikeOut')}
          >
            <Strikethrough aria-hidden="true" size={16} />
            <span>Strike</span>
          </button>
          <button
            type="button"
            aria-label="Comment on selection"
            disabled={!canAnnotate}
            aria-describedby={!canAnnotate ? 'selection-annotation-limit' : undefined}
            onClick={() => add('Text')}
          >
            <MessageSquareText aria-hidden="true" size={16} />
            <span>Comment</span>
          </button>
          <button
            type="button"
            aria-label="Mark selected text for redaction"
            disabled={!canAnnotate}
            aria-describedby={!canAnnotate ? 'selection-annotation-limit' : undefined}
            onClick={() => add('Redact')}
          >
            <ShieldAlert aria-hidden="true" size={16} />
            <span>Redact</span>
          </button>
        </>
      )}
      {busy ? <span role="status">Replacing text…</span> : null}
      {refusal ? <p role="alert">{refusal}</p> : null}
      {!canCopy ? (
        <p id="selection-copy-limit" className="selection-limit">
          Copying is blocked by this document&apos;s permissions.
        </p>
      ) : null}
      {!canEdit ? (
        <p id="selection-edit-limit" className="selection-limit">
          {action.crossPage
            ? 'Editing a cross-page selection is unavailable. Select text on one page to edit it.'
            : "Editing is blocked by this document's permissions."}
        </p>
      ) : null}
      {!canAnnotate ? (
        <p id="selection-annotation-limit" className="selection-limit">
          {action.crossPage
            ? 'Markup across pages is unavailable. Select text on one page to add markup.'
            : "Markup is blocked by this document's permissions."}
        </p>
      ) : null}
    </div>
  );
}
