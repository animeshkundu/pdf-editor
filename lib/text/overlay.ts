import type { EngineTypes } from '../engine/port';

export type TextEntryKind = 'form-field' | 'comment' | 'overlay' | 'existing-text';

export function selectionBounds(
  quads: readonly EngineTypes['PdfQuad'][],
): EngineTypes['PdfRect'] {
  if (quads.length === 0) throw new Error('The selection has no writable text geometry.');
  const xs = quads.flatMap((quad) => [quad[0], quad[2], quad[4], quad[6]]);
  const ys = quads.flatMap((quad) => [quad[1], quad[3], quad[5], quad[7]]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export interface ActiveTextEntryState {
  readonly kind: TextEntryKind;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly composing: boolean;
  readonly direction: 'ltr' | 'rtl';
}

export function directionForText(value: string): 'ltr' | 'rtl' {
  return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u.test(value) ? 'rtl' : 'ltr';
}

export function createTextEntry(kind: TextEntryKind, value = ''): ActiveTextEntryState {
  return {
    kind,
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    composing: false,
    direction: directionForText(value),
  };
}

export function updateTextEntry(
  state: ActiveTextEntryState,
  update: {
    readonly value?: string;
    readonly selectionStart?: number;
    readonly selectionEnd?: number;
    readonly composing?: boolean;
  },
): ActiveTextEntryState {
  const value = update.value ?? state.value;
  const selectionStart = Math.max(
    0,
    Math.min(value.length, update.selectionStart ?? state.selectionStart),
  );
  const selectionEnd = Math.max(
    selectionStart,
    Math.min(value.length, update.selectionEnd ?? state.selectionEnd),
  );
  return {
    ...state,
    ...update,
    value,
    selectionStart,
    selectionEnd,
    direction: directionForText(value),
  };
}

export default { createTextEntry, directionForText, selectionBounds, updateTextEntry };
