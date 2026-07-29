import type { EngineTypes } from '../engine/port';

export type FormDataFormat = 'fdf' | 'xfdf' | 'xml' | 'csv';

const MAX_FORM_DATA_BYTES = 8 * 1024 * 1024;

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function fdfEscape(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n');
}

function fdfUnescape(value: string): string {
  return value.replace(/\\([\\()rn])/g, (_match, escaped: string) =>
    escaped === 'r' ? '\r' : escaped === 'n' ? '\n' : escaped,
  );
}

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function csvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('The CSV form data has an unterminated quoted value.');
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function fieldValues(
  fields: readonly EngineTypes['FormFieldInfo'][],
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.name && !(field.name in values)) values[field.name] = field.value;
  }
  return values;
}

export function exportFormData(
  format: FormDataFormat,
  fields: readonly EngineTypes['FormFieldInfo'][],
): string {
  const values = fieldValues(fields);
  if (format === 'fdf') {
    const entries = Object.entries(values)
      .map(([name, value]) => `<</T(${fdfEscape(name)})/V(${fdfEscape(value)})>>`)
      .join('');
    return `%FDF-1.2\n1 0 obj\n<</FDF<</Fields[${entries}]>>>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n`;
  }
  if (format === 'xfdf') {
    const entries = Object.entries(values)
      .map(
        ([name, value]) =>
          `<field name="${xmlEscape(name)}"><value>${xmlEscape(value)}</value></field>`,
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><fields>${entries}</fields></xfdf>`;
  }
  if (format === 'xml') {
    const entries = Object.entries(values)
      .map(([name, value]) => `<field name="${xmlEscape(name)}">${xmlEscape(value)}</field>`)
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><form-data>${entries}</form-data>`;
  }
  return `name,value\n${Object.entries(values)
    .map(([name, value]) => `${csvEscape(name)},${csvEscape(value)}`)
    .join('\n')}\n`;
}

function parseXml(value: string, rootName: 'xfdf' | 'form-data'): Record<string, string> {
  const document = new DOMParser().parseFromString(value, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The XML form data is malformed.');
  if (document.documentElement.localName !== rootName) {
    throw new Error(`Expected a ${rootName} form-data document.`);
  }
  const values: Record<string, string> = {};
  for (const field of document.querySelectorAll('field')) {
    const name = field.getAttribute('name')?.trim();
    if (!name) throw new Error('Every imported form-data field needs a name.');
    if (name in values) throw new Error(`The imported field "${name}" occurs more than once.`);
    values[name] =
      rootName === 'xfdf'
        ? (field.querySelector('value')?.textContent ?? '')
        : (field.textContent ?? '');
  }
  return values;
}

export function parseFormData(
  format: FormDataFormat,
  value: string,
  knownNames: readonly string[],
): Readonly<Record<string, string>> {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > MAX_FORM_DATA_BYTES) {
    throw new Error(
      `This form-data file is ${Math.ceil(bytes / 1024 / 1024)} MB; the import limit is 8 MB.`,
    );
  }
  let values: Record<string, string>;
  if (format === 'fdf') {
    values = {};
    const pattern = /\/T\s*\(((?:\\.|[^\\)])*)\)\s*\/V\s*\(((?:\\.|[^\\)])*)\)/g;
    for (const match of value.matchAll(pattern)) {
      const rawName = match[1];
      const rawValue = match[2];
      if (rawName === undefined || rawValue === undefined) continue;
      const name = fdfUnescape(rawName);
      if (name in values)
        throw new Error(`The imported field "${name}" occurs more than once.`);
      values[name] = fdfUnescape(rawValue);
    }
    if (!value.startsWith('%FDF-') || Object.keys(values).length === 0) {
      throw new Error('The FDF form data is malformed or has no fields.');
    }
  } else if (format === 'xfdf') {
    values = parseXml(value, 'xfdf');
  } else if (format === 'xml') {
    values = parseXml(value, 'form-data');
  } else {
    const rows = csvRows(value);
    const header = rows.shift();
    if (
      header?.[0]?.trim().toLocaleLowerCase() !== 'name' ||
      header[1]?.trim().toLocaleLowerCase() !== 'value'
    ) {
      throw new Error('CSV form data must start with the columns name,value.');
    }
    values = {};
    for (const row of rows) {
      const name = row[0]?.trim();
      if (!name) continue;
      if (row.length !== 2) throw new Error(`The CSV row for "${name}" must have two columns.`);
      if (name in values)
        throw new Error(`The imported field "${name}" occurs more than once.`);
      values[name] = row[1] ?? '';
    }
  }
  const known = new Set(knownNames);
  const unknown = Object.keys(values).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`The imported data names fields that do not exist: ${unknown.join(', ')}.`);
  }
  if (Object.keys(values).length === 0)
    throw new Error('The form-data file has no field values.');
  return values;
}

export default { exportFormData, parseFormData };
