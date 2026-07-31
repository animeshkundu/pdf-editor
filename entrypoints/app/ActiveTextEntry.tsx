import { useEffect, useRef, useState } from 'react';
import textOverlay, { type TextEntryKind } from '@/lib/text/overlay';

export default function ActiveTextEntry({
  kind,
  label,
  initialValue = '',
  onCommit,
  onCancel,
}: {
  readonly kind: TextEntryKind;
  readonly label: string;
  readonly initialValue?: string;
  readonly onCommit: (value: string) => void;
  readonly onCancel: () => void;
}) {
  const [state, setState] = useState(() => textOverlay.createTextEntry(kind, initialValue));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const composingRef = useRef(false);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const style = getComputedStyle(canvas);
    const ratio = window.devicePixelRatio;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    context.scale(ratio, ratio);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.fillStyle = style.getPropertyValue('--page-paper').trim();
    context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    context.fillStyle = style.getPropertyValue('--text-primary').trim();
    context.font = `${style.fontSize} ${style.fontFamily}`;
    context.direction = state.direction;
    context.textAlign = state.direction === 'rtl' ? 'right' : 'left';
    context.fillText(
      state.value ||
        (kind === 'form-field'
          ? 'Enter field value'
          : kind === 'comment'
            ? 'Write comment'
            : kind === 'existing-text'
              ? 'Edit selected text'
              : 'Type overlay text'),
      state.direction === 'rtl' ? canvas.clientWidth - 12 : 12,
      30,
      canvas.clientWidth - 24,
    );
  }, [kind, state.direction, state.value]);

  return (
    <div className="active-entry" data-kind={kind}>
      <canvas ref={canvasRef} className="active-entry-preview" aria-hidden="true" />
      <textarea
        ref={inputRef}
        className="active-text-entry"
        aria-label={label}
        dir={state.direction}
        value={state.value}
        onChange={(event) => {
          const value = event.currentTarget.value;
          const selectionStart = event.currentTarget.selectionStart;
          const selectionEnd = event.currentTarget.selectionEnd;
          setState((current) =>
            textOverlay.updateTextEntry(current, {
              value,
              selectionStart,
              selectionEnd,
            }),
          );
        }}
        onSelect={(event) => {
          const selectionStart = event.currentTarget.selectionStart;
          const selectionEnd = event.currentTarget.selectionEnd;
          setState((current) =>
            textOverlay.updateTextEntry(current, {
              selectionStart,
              selectionEnd,
            }),
          );
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          setState((current) => textOverlay.updateTextEntry(current, { composing: true }));
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          setState((current) => textOverlay.updateTextEntry(current, { composing: false }));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!composingRef.current) onCancel();
          } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            onCommit(state.value);
          }
        }}
      />
      <div className="panel-actions">
        <button
          type="button"
          className="primary-action"
          disabled={!state.value.trim()}
          onClick={() => onCommit(state.value)}
        >
          {kind === 'form-field'
            ? 'Set field value'
            : kind === 'comment'
              ? 'Save comment'
              : kind === 'existing-text'
                ? 'Replace selected text'
                : 'Add overlay'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {kind === 'overlay' ? (
        <p className="scope-note">
          DEGRADED · This adds a PDF annotation above the page. It does not replace, reflow, or
          remove the original text.
        </p>
      ) : kind === 'existing-text' ? (
        <p className="scope-note">
          DEGRADED · The verified path handles one unique, axis-aligned line with printable
          ASCII replacement text. It removes the selected glyphs, writes a Helvetica FreeText
          appearance, and rolls back unless the surrounding text and annotation set stay
          unchanged. Other scripts, reflow, forms, marked content, and overlapping annotations
          are refused before mutation.
        </p>
      ) : (
        <p className="scope-note">
          LOCAL · This hidden semantic editor owns the caret, selection, clipboard, IME, and
          text direction while the visible preview is painted to canvas.
        </p>
      )}
    </div>
  );
}
