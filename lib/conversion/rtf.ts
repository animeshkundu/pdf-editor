export interface RtfPageText {
  readonly label: string;
  readonly text: string;
}

function signedCodeUnit(codeUnit: number): number {
  return codeUnit > 0x7fff ? codeUnit - 0x10000 : codeUnit;
}

export function escapeRtfText(value: string): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x0d) {
      if (value.charCodeAt(index + 1) === 0x0a) index += 1;
      escaped += '\\line\n';
    } else if (codeUnit === 0x0a) {
      escaped += '\\line\n';
    } else if (codeUnit === 0x09) {
      escaped += '\\tab ';
    } else if (codeUnit === 0x5c || codeUnit === 0x7b || codeUnit === 0x7d) {
      escaped += `\\${value[index]}`;
    } else if (codeUnit >= 0x20 && codeUnit <= 0x7e) {
      escaped += value[index];
    } else {
      escaped += `\\u${signedCodeUnit(codeUnit)}?`;
    }
  }
  return escaped;
}

export function textToRtf(title: string, pages: readonly RtfPageText[]): string {
  const body = pages
    .map(
      ({ label, text }) =>
        `{\\b Page ${escapeRtfText(label)}}\\par\n${escapeRtfText(text.trim())}\\par\n`,
    )
    .join('\\par\n');

  return (
    `{\\rtf1\\ansi\\deff0\n` +
    `{\\fonttbl{\\f0 Times New Roman;}}\n` +
    `{\\info{\\title ${escapeRtfText(title)}}}\n` +
    `\\f0\\fs24\n` +
    `${body}` +
    `}`
  );
}

export default textToRtf;
