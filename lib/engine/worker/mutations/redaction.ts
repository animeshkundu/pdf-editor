import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { EngineTypes } from '../../port';
import { SAFE_FULL_SAVE, saveDocument } from '../save';
import { withArenaSync, type Arena } from '../arena';

interface SanitizePreflight {
  readonly signatures: number;
  readonly unsupported: readonly string[];
}

export interface ApplyRedactionsPreflight {
  readonly marks: number;
  readonly pageIndices: readonly number[];
  readonly signatures: number;
  readonly unsupported: readonly string[];
}

type ContentRemovalOutput = Omit<EngineTypes['SanitizeReport'], 'document' | 'journal'>;
type ApplyRedactionsOutput = Omit<EngineTypes['ApplyRedactionsReport'], 'document' | 'journal'>;

function forEachObject(
  document: mupdf.PDFDocument,
  visit: (arena: Arena, object: mupdf.PDFObject, objectNumber: number) => void,
): void {
  for (let objectNumber = 1; objectNumber < document.countObjects(); objectNumber += 1) {
    withArenaSync((arena) => {
      const reference = arena.keep(document.newIndirect(objectNumber));
      const object = arena.keep(reference.resolve());
      if (!object.isNull()) visit(arena, object, objectNumber);
    });
  }
}

function countSignatures(document: mupdf.PDFDocument): number {
  let signatures = 0;
  forEachObject(document, (arena, object) => {
    if (!object.isDictionary()) return;
    const fieldType = arena.keep(object.getInheritable('FT'));
    if (fieldType.isName() && fieldType.asName() === 'Sig') signatures += 1;
  });
  return signatures;
}

function countFileSpecs(document: mupdf.PDFDocument): number {
  let fileSpecs = 0;
  forEachObject(document, (arena, object) => {
    if (!object.isDictionary()) return;
    const type = arena.keep(object.get('Type'));
    if (type.isName() && type.asName() === 'Filespec') fileSpecs += 1;
  });
  return fileSpecs;
}

export function countUnappliedRedactions(document: mupdf.PDFDocument): number {
  let redactions = 0;
  withArenaSync((arena) => {
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const page = arena.keep(document.loadPage(pageIndex));
      const annotations = page.getAnnotations();
      for (const annotation of annotations) {
        arena.keep(annotation);
        if (annotation.getType() === 'Redact') redactions += 1;
      }
    }
  });
  return redactions;
}

function objectHasMetadata(arena: Arena, object: mupdf.PDFObject): boolean {
  if (!object.isDictionary()) return false;
  return (
    !arena.keep(object.get('Metadata')).isNull() ||
    !arena.keep(object.get('PieceInfo')).isNull()
  );
}

export function inspectApplyRedactions(document: mupdf.PDFDocument): ApplyRedactionsPreflight {
  const unsupported = new Set<string>();
  const pageIndices: number[] = [];
  let marks = 0;

  forEachObject(document, (arena, object, objectNumber) => {
    if (objectHasMetadata(arena, object)) {
      unsupported.add(
        `object metadata (XMP or PieceInfo) in object ${objectNumber}, which can retain the redacted text; remove it with Sanitize before applying redactions`,
      );
    }
  });

  withArenaSync((arena) => {
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const page = arena.keep(document.loadPage(pageIndex));
      const annotations = page.getAnnotations();
      for (const annotation of annotations) {
        arena.keep(annotation);
        if (annotation.getType() === 'Redact') marks += 1;
        const annotationObject = arena.keep(annotation.getObject());
        if (objectHasMetadata(arena, annotationObject)) {
          unsupported.add(
            `object metadata (XMP or PieceInfo) on page ${pageIndex + 1}, which can retain the redacted text; remove it with Sanitize before applying redactions`,
          );
        }
      }
      if (annotations.every((annotation) => annotation.getType() !== 'Redact')) continue;
      pageIndices.push(pageIndex);

      const pageObject = arena.keep(page.getObject());
      if (objectHasMetadata(arena, pageObject)) {
        unsupported.add(
          `object metadata (XMP or PieceInfo) on page ${pageIndex + 1}, which can retain the redacted text; remove it with Sanitize before applying redactions`,
        );
      }
      const trace = arena.keep(page.processContents());
      const records = trace.getRecords();
      if (records.some((record) => record.operator === 'Do_form')) {
        unsupported.add(
          `Form XObject content on page ${pageIndex + 1}; this engine cannot prove that recoverable text inside the form is removed`,
        );
      }
      if (
        records.some(
          (record) =>
            record.operator === 'BDC' && record.cooked !== undefined && !record.cooked.isNull(),
        )
      ) {
        unsupported.add(
          `marked-content property dictionaries on page ${pageIndex + 1}; they can retain recoverable text outside the painted glyphs`,
        );
      }
    }
  });

  return {
    marks,
    pageIndices,
    signatures: countSignatures(document),
    unsupported: [...unsupported],
  };
}

export function assertApplyRedactions(
  preflight: ApplyRedactionsPreflight,
  confirmSignatureInvalidation: boolean,
): void {
  if (preflight.marks === 0)
    throw new Error('Add at least one redaction mark before applying.');
  if (preflight.unsupported.length > 0) {
    throw new Error(
      `Apply redactions refused because ${preflight.unsupported.join('; ')}. Remove the marks, run Sanitize, then place the marks again. The document was not changed.`,
    );
  }
  if (preflight.signatures > 0 && !confirmSignatureInvalidation) {
    throw new Error(
      'Apply redactions requires confirmation because the garbage-collecting full rewrite invalidates existing signatures.',
    );
  }
}

export function applyRedactions(
  arena: Arena,
  document: mupdf.PDFDocument,
  preflight: ApplyRedactionsPreflight,
): ApplyRedactionsOutput {
  for (const pageIndex of preflight.pageIndices) {
    const page = arena.keep(document.loadPage(pageIndex));
    page.applyRedactions(
      true,
      mupdf.PDFPage.REDACT_IMAGE_REMOVE,
      mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
      mupdf.PDFPage.REDACT_TEXT_REMOVE,
    );
    page.update();
  }
  const remaining = countUnappliedRedactions(document);
  if (remaining > 0) {
    throw new Error(
      `Apply redactions left ${remaining} unapplied redaction ${remaining === 1 ? 'mark' : 'marks'}; the operation was rolled back.`,
    );
  }
  return {
    data: saveDocument(document, SAFE_FULL_SAVE),
    fidelity: 'DEGRADED',
    applied: preflight.marks,
    pages: preflight.pageIndices.length,
  };
}

export function inspectSanitize(document: mupdf.PDFDocument): SanitizePreflight {
  const unsupported: string[] = [];
  if (document.countLayers() > 0) unsupported.push('optional-content layers');
  const embeddedFiles = withArenaSync((arena) => {
    const files = document.getEmbeddedFiles();
    for (const reference of Object.values(files)) arena.keep(reference);
    return Object.keys(files).length;
  });
  if (countFileSpecs(document) > embeddedFiles) {
    unsupported.push('file specifications referenced outside the embedded-files name tree');
  }
  withArenaSync((arena) => {
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const page = arena.keep(document.loadPage(pageIndex));
      const media = page.getBounds(mupdf.Page.MEDIA_BOX);
      const crop = page.getBounds(mupdf.Page.CROP_BOX);
      if (media.some((value, index) => Math.abs(value - (crop[index] ?? value)) > 0.001)) {
        unsupported.push(`off-crop content on page ${pageIndex + 1}`);
      }
      const trace = arena.keep(page.processContents());
      if (trace.getRecords().some((record) => record.operator === 'Do_form')) {
        unsupported.push(`Form XObject content on page ${pageIndex + 1}`);
      }
    }
  });
  return { signatures: countSignatures(document), unsupported };
}

function deleteKey(object: mupdf.PDFObject, key: string): number {
  const present = withArenaSync((arena) => !arena.keep(object.get(key)).isNull());
  if (present) object.delete(key);
  return present ? 1 : 0;
}

export function sanitize(
  arena: Arena,
  document: mupdf.PDFDocument,
  preflight: SanitizePreflight,
  confirmSignatureInvalidation: boolean,
): ContentRemovalOutput {
  if (preflight.unsupported.length > 0) {
    throw new Error(
      `Sanitize refused because complete removal is not available for ${preflight.unsupported.join(', ')}.`,
    );
  }
  if (preflight.signatures > 0 && !confirmSignatureInvalidation) {
    throw new Error(
      'Sanitize requires confirmation because a full rewrite invalidates existing signatures.',
    );
  }

  const removed = {
    scripts: 0,
    embeddedFiles: 0,
    metadata: 0,
    formValues: 0,
    hiddenAnnotations: 0,
    pages: 0,
  };
  const trailer = arena.keep(document.getTrailer());
  const root = arena.keep(trailer.get('Root'));
  removed.scripts += deleteKey(root, 'OpenAction') + deleteKey(root, 'AA');
  removed.metadata += deleteKey(trailer, 'Info') + deleteKey(root, 'Metadata');

  const names = arena.keep(root.get('Names'));
  if (names.isDictionary()) {
    removed.scripts += deleteKey(names, 'JavaScript');
    removed.embeddedFiles += deleteKey(names, 'EmbeddedFiles');
  }

  const acroForm = arena.keep(root.get('AcroForm'));
  if (acroForm.isDictionary()) {
    removed.formValues += deleteKey(acroForm, 'XFA');
  }

  const embedded = document.getEmbeddedFiles();
  for (const [name, reference] of Object.entries(embedded)) {
    arena.keep(reference);
    document.deleteEmbeddedFile(name);
    removed.embeddedFiles += 1;
  }

  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = arena.keep(document.loadPage(pageIndex));
    const pageObject = arena.keep(page.getObject());
    removed.scripts += deleteKey(pageObject, 'AA');
    removed.metadata += deleteKey(pageObject, 'Metadata') + deleteKey(pageObject, 'PieceInfo');
    for (const annotation of page.getAnnotations()) {
      arena.keep(annotation);
      const object = arena.keep(annotation.getObject());
      removed.scripts += deleteKey(object, 'A') + deleteKey(object, 'AA');
      removed.metadata += deleteKey(object, 'Metadata') + deleteKey(object, 'PieceInfo');
      if (
        annotation.getType() === 'FileAttachment' ||
        Boolean(annotation.getFlags() & mupdf.PDFAnnotation.IS_HIDDEN)
      ) {
        page.deleteAnnotation(annotation);
        removed.hiddenAnnotations += 1;
      }
    }
  }

  forEachObject(document, (_objectArena, object) => {
    if (!object.isDictionary()) return;
    removed.metadata += deleteKey(object, 'Metadata') + deleteKey(object, 'PieceInfo');
    const fieldType = _objectArena.keep(object.getInheritable('FT'));
    if (!fieldType.isNull()) {
      removed.formValues +=
        deleteKey(object, 'V') + deleteKey(object, 'DV') + deleteKey(object, 'AP');
      removed.scripts += deleteKey(object, 'A') + deleteKey(object, 'AA');
    }
  });

  return { data: saveDocument(document, SAFE_FULL_SAVE), removed };
}

export function redactPages(
  document: mupdf.PDFDocument,
  pageIndices: readonly number[],
  signatures: number,
  confirmSignatureInvalidation: boolean,
): ContentRemovalOutput {
  const pages = [...new Set(pageIndices)].sort((left, right) => right - left);
  if (
    pages.length === 0 ||
    pages.some(
      (pageIndex) =>
        !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.countPages(),
    )
  ) {
    throw new Error('Select one or more valid pages for wholesale removal.');
  }
  if (pages.length >= document.countPages()) {
    throw new Error('Wholesale page removal must leave at least one page in the PDF.');
  }
  if (signatures > 0 && !confirmSignatureInvalidation) {
    throw new Error(
      'Wholesale page removal requires confirmation because it invalidates existing signatures.',
    );
  }
  for (const pageIndex of pages) document.deletePage(pageIndex);
  return {
    data: saveDocument(document, SAFE_FULL_SAVE),
    removed: {
      scripts: 0,
      embeddedFiles: 0,
      metadata: 0,
      formValues: 0,
      hiddenAnnotations: 0,
      pages: pages.length,
    },
  };
}

export function signatureCount(document: mupdf.PDFDocument): number {
  return countSignatures(document);
}

export default {
  applyRedactions,
  assertApplyRedactions,
  countUnappliedRedactions,
  inspectApplyRedactions,
  inspectSanitize,
  redactPages,
  sanitize,
  signatureCount,
};
