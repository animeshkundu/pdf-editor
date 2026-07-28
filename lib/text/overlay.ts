export type TextEntryKind = 'form-field' | 'comment' | 'overlay';

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

export default { createTextEntry, directionForText, updateTextEntry };
