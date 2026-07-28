import type { EngineTypes } from '../engine/port';

export type CommentFormat = 'fdf' | 'xfdf';

export interface CommentExport {
  readonly value: string;
  readonly preserved: number;
  readonly omitted: number;
}

export interface CommentImport {
  readonly inputs: readonly EngineTypes['AnnotationInput'][];
  readonly omitted: number;
}

const MAX_COMMENT_DATA_BYTES = 8 * 1024 * 1024;

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function pdfEscape(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n');
}

function pdfUnescape(value: string): string {
  return value.replace(/\\([\\()rn])/g, (_match, escaped: string) =>
    escaped === 'r' ? '\r' : escaped === 'n' ? '\n' : escaped,
  );
}

function supported(comment: EngineTypes['AnnotationInfo']): boolean {
  return comment.type === 'Text' || comment.type === 'FreeText';
}

export function exportComments(
  format: CommentFormat,
  comments: readonly EngineTypes['AnnotationInfo'][],
): CommentExport {
  const preserved = comments.filter(supported);
  const omitted = comments.length - preserved.length;
  const id = (comment: EngineTypes['AnnotationInfo']) => `comment-${comment.id}`;
  if (format === 'xfdf') {
    const body = preserved
      .map((comment) => {
        const tag = comment.type === 'FreeText' ? 'freetext' : 'text';
        return `<${tag} page="${comment.pageIndex}" rect="${comment.rect.join(
          ',',
        )}" name="${xmlEscape(id(comment))}" title="${xmlEscape(
          comment.author,
        )}" subject="${xmlEscape(comment.subject)}" state="${comment.state}"${
          comment.replyToId === null ? '' : ` inreplyto="comment-${comment.replyToId}"`
        }><contents>${xmlEscape(comment.contents)}</contents></${tag}>`;
      })
      .join('');
    return {
      value: `<?xml version="1.0" encoding="UTF-8"?><xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><annots>${body}</annots></xfdf>`,
      preserved: preserved.length,
      omitted,
    };
  }
  const body = preserved
    .map((comment) => {
      const reply = comment.replyToId === null ? '' : `/IRT(comment-${comment.replyToId})`;
      return `<</Page ${comment.pageIndex}/Subtype/${comment.type}/Rect[${comment.rect.join(
        ' ',
      )}]/Contents(${pdfEscape(comment.contents)})/T(${pdfEscape(
        comment.author,
      )})/Subj(${pdfEscape(comment.subject)})/NM(${id(comment)})/State/${
        comment.state
      }${reply}>>`;
    })
    .join('');
  return {
    value: `%FDF-1.2\n1 0 obj\n<</FDF<</Annots[${body}]>>>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n`,
    preserved: preserved.length,
    omitted,
  };
}

function safeType(value: string): EngineTypes['AnnotationType'] | null {
  return value === 'Text' || value === 'FreeText' ? value : null;
}

function safeState(value: string | null): EngineTypes['AnnotationState'] {
  return value && ['Accepted', 'Rejected', 'Cancelled', 'Completed', 'None'].includes(value)
    ? (value as EngineTypes['AnnotationState'])
    : 'None';
}

function validateInputs(
  inputs: readonly EngineTypes['AnnotationInput'][],
  pageCount: number,
): readonly EngineTypes['AnnotationInput'][] {
  if (inputs.length === 0) throw new Error('The comment file has no supported comments.');
  for (const [index, input] of inputs.entries()) {
    if (input.pageIndex < 0 || input.pageIndex >= pageCount) {
      throw new Error(`Imported comment ${index + 1} refers to a page outside this document.`);
    }
    if (
      input.rect.some((value) => !Number.isFinite(value)) ||
      input.rect[2] <= input.rect[0] ||
      input.rect[3] <= input.rect[1]
    ) {
      throw new Error(`Imported comment ${index + 1} has an invalid rectangle.`);
    }
  }
  return inputs;
}

export function importComments(
  format: CommentFormat,
  value: string,
  pageCount: number,
): CommentImport {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > MAX_COMMENT_DATA_BYTES) {
    throw new Error(
      `This comment file is ${Math.ceil(bytes / 1024 / 1024)} MB; the import limit is 8 MB.`,
    );
  }
  if (/\/(?:AA|JavaScript|JS|Launch|URI)\b|<(?:script|link)\b/i.test(value)) {
    throw new Error('The comment file contains an action, script, or external reference.');
  }
  const inputs: EngineTypes['AnnotationInput'][] = [];
  let omitted = 0;
  if (format === 'xfdf') {
    const document = new DOMParser().parseFromString(value, 'application/xml');
    if (
      document.querySelector('parsererror') ||
      document.documentElement.localName !== 'xfdf'
    ) {
      throw new Error('The XFDF comment file is malformed.');
    }
    for (const element of document.querySelectorAll('annots > *')) {
      const type =
        element.localName === 'text'
          ? 'Text'
          : element.localName === 'freetext'
            ? 'FreeText'
            : null;
      if (!type) {
        omitted += 1;
        continue;
      }
      const rect = (element.getAttribute('rect') ?? '').split(',').map(Number);
      if (rect.length !== 4) throw new Error('An XFDF comment has an invalid rectangle.');
      const replyToClientId = element.getAttribute('inreplyto');
      inputs.push({
        pageIndex: Number(element.getAttribute('page')),
        type,
        rect: rect as unknown as EngineTypes['PdfRect'],
        contents: element.querySelector('contents')?.textContent ?? '',
        author: element.getAttribute('title') ?? '',
        subject: element.getAttribute('subject') ?? '',
        state: safeState(element.getAttribute('state')),
        clientId: element.getAttribute('name') ?? `comment-${inputs.length + 1}`,
        ...(replyToClientId ? { replyToClientId } : {}),
        flags: 4,
      });
    }
  } else {
    if (!value.startsWith('%FDF-')) throw new Error('The FDF comment file is malformed.');
    for (const match of value.matchAll(/<<([^<>]+)>>/g)) {
      const dictionary = match[1];
      if (!dictionary?.includes('/Subtype/')) continue;
      const subtype = /\/Subtype\/([A-Za-z]+)/.exec(dictionary)?.[1] ?? '';
      const type = safeType(subtype);
      if (!type) {
        omitted += 1;
        continue;
      }
      const rect = /\/Rect\[([^\]]+)\]/.exec(dictionary)?.[1]?.trim().split(/\s+/).map(Number);
      if (!rect || rect.length !== 4)
        throw new Error('An FDF comment has an invalid rectangle.');
      const text = (key: string) =>
        pdfUnescape(
          new RegExp(`/${key}\\(((?:\\\\.|[^\\\\)])*)\\)`).exec(dictionary)?.[1] ?? '',
        );
      const name = text('NM') || `comment-${inputs.length + 1}`;
      const reply = text('IRT');
      inputs.push({
        pageIndex: Number(/\/Page\s+(\d+)/.exec(dictionary)?.[1]),
        type,
        rect: rect as unknown as EngineTypes['PdfRect'],
        contents: text('Contents'),
        author: text('T'),
        subject: text('Subj'),
        state: safeState(/\/State\/([A-Za-z]+)/.exec(dictionary)?.[1] ?? null),
        clientId: name,
        ...(reply ? { replyToClientId: reply } : {}),
        flags: 4,
      });
    }
  }
  return { inputs: validateInputs(inputs, pageCount), omitted };
}

export default { exportComments, importComments };
