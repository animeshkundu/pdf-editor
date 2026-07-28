import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';

export type MetadataValues = Readonly<
  Partial<Record<'title' | 'author' | 'subject' | 'keywords' | 'language', string>>
>;

const METADATA_KEYS = {
  title: mupdf.Document.META_INFO_TITLE,
  author: mupdf.Document.META_INFO_AUTHOR,
  subject: mupdf.Document.META_INFO_SUBJECT,
  keywords: mupdf.Document.META_INFO_KEYWORDS,
} as const;

export function updateMetadata(document: mupdf.PDFDocument, values: MetadataValues): void {
  for (const [name, value] of Object.entries(values) as [keyof MetadataValues, string][]) {
    if (name === 'language') document.setLanguage(value);
    else document.setMetaData(METADATA_KEYS[name], value);
  }
}

export function projectedMetadataBytes(values: MetadataValues): number {
  return (
    4_096 +
    Object.values(values).reduce(
      (bytes, value) => bytes + new TextEncoder().encode(value).byteLength * 4,
      0,
    )
  );
}

export default { projectedMetadataBytes, updateMetadata };
