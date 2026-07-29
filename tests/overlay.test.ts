import textOverlay from '../lib/text/overlay';

describe('EDIT-001 accessible overlay entry state', () => {
  it('tracks selection, IME composition, and RTL direction without page DOM text', () => {
    const initial = textOverlay.createTextEntry('overlay', '');
    const composing = textOverlay.updateTextEntry(initial, {
      value: 'مرحبا',
      selectionStart: 2,
      selectionEnd: 5,
      composing: true,
    });
    expect(composing).toMatchObject({
      value: 'مرحبا',
      selectionStart: 2,
      selectionEnd: 5,
      composing: true,
      direction: 'rtl',
    });

    expect(
      textOverlay.updateTextEntry(composing, {
        value: 'ok',
        selectionStart: 99,
        selectionEnd: 101,
        composing: false,
      }),
    ).toMatchObject({
      selectionStart: 2,
      selectionEnd: 2,
      composing: false,
      direction: 'ltr',
    });
  });
});
