import { escapeRtfText, textToRtf } from '@/lib/conversion/rtf';

describe('CONV-015 RTF export', () => {
  it('writes a minimal RTF 1.0 document with title, font table, labels, and page text', () => {
    const rtf = textToRtf('My Document', [
      { label: 'i', text: 'First page' },
      { label: '2', text: 'Second page' },
    ]);
    expect(rtf).toMatch(/^\{\\rtf1\\ansi\\deff0/);
    expect(rtf).toContain('{\\fonttbl{\\f0 Times New Roman;}}');
    expect(rtf).toContain('{\\info{\\title My Document}}');
    expect(rtf).toContain('{\\b Page i}\\par');
    expect(rtf).toContain('First page');
    expect(rtf).toContain('{\\b Page 2}\\par');
    expect(rtf).toContain('Second page');
    expect(rtf.endsWith('}')).toBe(true);
  });

  it('escapes RTF control characters and converts line and tab controls', () => {
    expect(escapeRtfText('a\\b {c}\r\nd\te')).toBe('a\\\\b \\{c\\}\\line\nd\\tab e');
  });

  it('emits signed UTF-16 code units for BMP and supplementary Unicode text', () => {
    expect(escapeRtfText('é')).toBe('\\u233?');
    expect(escapeRtfText('\u8000')).toBe('\\u-32768?');
    expect(escapeRtfText('😀')).toBe('\\u-10179?\\u-8704?');
  });

  it('keeps braces balanced after escaping arbitrary page text', () => {
    const rtf = textToRtf('{Title}', [{ label: '1', text: 'path\\to\\{file}\n😀' }]);
    const opens = (rtf.match(/(?<!\\)\{/g) ?? []).length;
    const closes = (rtf.match(/(?<!\\)\}/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(rtf).not.toContain('\0');
  });
});
