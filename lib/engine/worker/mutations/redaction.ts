import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { EngineTypes } from '../../port';
import { SAFE_FULL_SAVE, saveDocument } from '../save';
import { withArenaSync, type Arena } from '../arena';

interface SanitizePreflight {
  readonly signatures: number;
  readonly unsupported: readonly string[];
}

type ContentRemovalOutput = Omit<EngineTypes['SanitizeReport'], 'document' | 'journal'>;

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
  countUnappliedRedactions,
  inspectSanitize,
  redactPages,
  sanitize,
  signatureCount,
};
