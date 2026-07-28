import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { EngineTypes } from '../../port';
import { encodeWithToUnicodeCMap } from '../../../text/encoding';
import { selectionBounds } from '../../../text/overlay';
import { withArenaSync, type Arena } from '../arena';

type AnnotationInfo = EngineTypes['AnnotationInfo'];
type AnnotationInput = EngineTypes['AnnotationInput'];
type AnnotationUpdate = EngineTypes['AnnotationUpdate'];

function annotationId(arena: Arena, annotation: mupdf.PDFAnnotation, ordinal: number): number {
  const object = arena.keep(annotation.getObject());
  return object.isIndirect() ? object.asIndirect() : -(ordinal + 1);
}

function annotationInfo(
  arena: Arena,
  annotation: mupdf.PDFAnnotation,
  pageIndex: number,
  ordinal: number,
): AnnotationInfo {
  const object = arena.keep(annotation.getObject());
  const state = arena.keep(object.get('State'));
  const reply = arena.keep(object.get('IRT'));
  return {
    id: annotationId(arena, annotation, ordinal),
    name: annotation.getName(),
    pageIndex,
    type: annotation.getType(),
    rect: annotation.hasRect() ? annotation.getRect() : annotation.getBounds(),
    contents: annotation.getContents(),
    author: annotation.hasAuthor() ? annotation.getAuthor() : '',
    subject: annotation.hasSubject() ? annotation.getSubject() : '',
    color: annotation.getColor(),
    opacity: annotation.getOpacity(),
    borderWidth: annotation.hasBorder() ? annotation.getBorderWidth() : 0,
    borderStyle: annotation.hasBorder() ? annotation.getBorderStyle() : 'Solid',
    lineEndingStyles: annotation.hasLineEndingStyles()
      ? [annotation.getLineEndingStyles().start, annotation.getLineEndingStyles().end]
      : ['None', 'None'],
    icon: annotation.hasIcon() ? annotation.getIcon() : '',
    state:
      state.isName() &&
      ['Accepted', 'Rejected', 'Cancelled', 'Completed', 'None'].includes(state.asName())
        ? (state.asName() as EngineTypes['AnnotationState'])
        : 'None',
    replyToId: reply.isIndirect() ? reply.asIndirect() : null,
    flags: annotation.getFlags(),
  };
}

function keepAnnotations(arena: Arena, page: mupdf.PDFPage): mupdf.PDFAnnotation[] {
  const annotations = page.getAnnotations();
  for (const annotation of annotations) arena.keep(annotation);
  return annotations;
}

function pageAt(arena: Arena, document: mupdf.PDFDocument, pageIndex: number): mupdf.PDFPage {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.countPages()) {
    throw new Error(`Page ${pageIndex + 1} is outside this document.`);
  }
  return arena.keep(document.loadPage(pageIndex));
}

function assertRect(rect: EngineTypes['PdfRect']): void {
  if (
    rect.some((value) => !Number.isFinite(value)) ||
    rect[2] <= rect[0] ||
    rect[3] <= rect[1]
  ) {
    throw new Error('An annotation rectangle must have finite positive width and height.');
  }
}

function applyGeometry(
  annotation: mupdf.PDFAnnotation,
  values: AnnotationInput | AnnotationUpdate,
): void {
  if (values.rect) {
    assertRect(values.rect);
    if (annotation.hasRect()) annotation.setRect([...values.rect]);
  }
  if (values.quadPoints) {
    if (!annotation.hasQuadPoints()) {
      throw new Error(`${annotation.getType()} annotations do not accept text quadrilaterals.`);
    }
    annotation.setQuadPoints(values.quadPoints.map((quad) => [...quad]));
  }
  if (values.inkList) {
    if (!annotation.hasInkList()) {
      throw new Error(`${annotation.getType()} annotations do not accept ink strokes.`);
    }
    annotation.setInkList(
      values.inkList.map((stroke) => stroke.map((point) => [...point] as mupdf.Point)),
    );
  }
  if (values.vertices) {
    if (!annotation.hasVertices()) {
      throw new Error(`${annotation.getType()} annotations do not accept vertices.`);
    }
    annotation.setVertices(values.vertices.map((point) => [...point] as mupdf.Point));
  }
  if (values.line) {
    if (!annotation.hasLine()) {
      throw new Error(`${annotation.getType()} annotations do not accept a line.`);
    }
    annotation.setLine([...values.line[0]], [...values.line[1]]);
  }
  if (values.calloutLine) {
    if (!annotation.hasCallout()) {
      throw new Error(`${annotation.getType()} annotations do not accept a callout line.`);
    }
    if (values.calloutLine.length < 2 || values.calloutLine.length > 3) {
      throw new Error('A callout line must have two or three points.');
    }
    annotation.setCalloutLine(values.calloutLine.map((point) => [...point] as mupdf.Point));
  }
}

function applyProperties(
  arena: Arena,
  document: mupdf.PDFDocument,
  annotation: mupdf.PDFAnnotation,
  values: AnnotationInput | AnnotationUpdate,
): void {
  if (values.contents !== undefined) annotation.setContents(values.contents);
  if (values.author !== undefined) annotation.setAuthor(values.author);
  if (values.subject !== undefined) annotation.setSubject(values.subject);
  if (values.color !== undefined) annotation.setColor([...values.color]);
  if (values.interiorColor !== undefined) {
    if (!annotation.hasInteriorColor()) {
      throw new Error(`${annotation.getType()} annotations do not accept an interior colour.`);
    }
    annotation.setInteriorColor([...values.interiorColor]);
  }
  if (values.opacity !== undefined) {
    if (!Number.isFinite(values.opacity) || values.opacity < 0 || values.opacity > 1) {
      throw new Error('Annotation opacity must be between 0 and 1.');
    }
    annotation.setOpacity(values.opacity);
  }
  if (values.flags !== undefined) annotation.setFlags(values.flags);
  if (values.lineEndingStyles !== undefined) {
    if (!annotation.hasLineEndingStyles()) {
      throw new Error(`${annotation.getType()} annotations do not accept line endings.`);
    }
    annotation.setLineEndingStyles(...values.lineEndingStyles);
  }
  if (values.borderWidth !== undefined) {
    if (!annotation.hasBorder()) {
      throw new Error(`${annotation.getType()} annotations do not accept a border.`);
    }
    if (
      !Number.isFinite(values.borderWidth) ||
      values.borderWidth < 0 ||
      values.borderWidth > 100
    ) {
      throw new Error('Annotation line weight must be between 0 and 100 points.');
    }
    annotation.setBorderWidth(values.borderWidth);
  }
  if (values.borderStyle !== undefined) {
    if (!annotation.hasBorder()) {
      throw new Error(`${annotation.getType()} annotations do not accept a border style.`);
    }
    annotation.setBorderStyle(values.borderStyle);
  }
  if (values.borderDashPattern !== undefined) {
    if (!annotation.hasBorder()) {
      throw new Error(`${annotation.getType()} annotations do not accept a dash pattern.`);
    }
    if (
      values.borderDashPattern.length === 0 ||
      values.borderDashPattern.some((value) => !Number.isFinite(value) || value <= 0)
    ) {
      throw new Error('A border dash pattern must contain positive finite lengths.');
    }
    annotation.setBorderDashPattern([...values.borderDashPattern]);
  }
  if (values.borderEffect !== undefined) {
    if (!annotation.hasBorderEffect()) {
      throw new Error(`${annotation.getType()} annotations do not accept a border effect.`);
    }
    annotation.setBorderEffect(values.borderEffect);
  }
  if (values.borderEffectIntensity !== undefined) {
    if (!annotation.hasBorderEffect()) {
      throw new Error(`${annotation.getType()} annotations do not accept border intensity.`);
    }
    if (
      !Number.isFinite(values.borderEffectIntensity) ||
      values.borderEffectIntensity < 0 ||
      values.borderEffectIntensity > 2
    ) {
      throw new Error('Cloud intensity must be between 0 and 2.');
    }
    annotation.setBorderEffectIntensity(values.borderEffectIntensity);
  }
  if (values.icon !== undefined) {
    if (!annotation.hasIcon()) {
      throw new Error(`${annotation.getType()} annotations do not accept an icon.`);
    }
    annotation.setIcon(values.icon);
  }
  if (values.intent !== undefined) annotation.setIntent(values.intent);
  if (values.quadding !== undefined) annotation.setQuadding(values.quadding);
  if (values.state !== undefined) {
    const object = arena.keep(annotation.getObject());
    const state = arena.keep(document.newName(values.state));
    const model = arena.keep(document.newName('Review'));
    arena.keep(object.put('State', state));
    arena.keep(object.put('StateModel', model));
  }
}

function applyPayload(
  arena: Arena,
  document: mupdf.PDFDocument,
  annotation: mupdf.PDFAnnotation,
  values: AnnotationInput | AnnotationUpdate,
): void {
  if (values.stampImage !== undefined) {
    if (annotation.getType() !== 'Stamp') {
      throw new Error('Only stamp annotations accept an image payload.');
    }
    const image = arena.keep(new mupdf.Image(new Uint8Array(values.stampImage)));
    annotation.setStampImage(image);
    annotation.setIntent('StampImage');
  }
  if (values.attachment !== undefined) {
    if (!annotation.hasFilespec()) {
      throw new Error(`${annotation.getType()} annotations do not accept a file attachment.`);
    }
    const now = new Date();
    const filespec = arena.keep(
      document.addEmbeddedFile(
        values.attachment.name,
        values.attachment.mimeType,
        new Uint8Array(values.attachment.data),
        now,
        now,
        true,
      ),
    );
    annotation.setFileSpec(filespec);
  }
  if ('replyTo' in values && values.replyTo !== undefined) {
    const target = findAnnotation(
      arena,
      document,
      values.replyTo.pageIndex,
      values.replyTo.annotationId,
    ).annotation;
    const object = arena.keep(annotation.getObject());
    const targetObject = arena.keep(target.getObject());
    const replyType = arena.keep(document.newName('R'));
    arena.keep(object.put('IRT', targetObject));
    arena.keep(object.put('RT', replyType));
  }
}

export function projectedAnnotationBytes(input: AnnotationInput | AnnotationUpdate): number {
  const text = `${input.contents ?? ''}${input.author ?? ''}${input.subject ?? ''}`;
  const geometry =
    (input.quadPoints?.length ?? 0) * 8 +
    (input.vertices?.length ?? 0) * 2 +
    (input.inkList?.reduce((count, stroke) => count + stroke.length * 2, 0) ?? 0);
  return (
    8_192 +
    new TextEncoder().encode(text).byteLength * 4 +
    geometry * 8 +
    (input.stampImage?.byteLength ?? 0) * 2 +
    (input.attachment?.data.byteLength ?? 0) * 2
  );
}

export function listAnnotations(
  document: mupdf.PDFDocument,
  pageIndex?: number,
): AnnotationInfo[] {
  return withArenaSync((arena) => {
    const first = pageIndex ?? 0;
    const end = pageIndex === undefined ? document.countPages() : pageIndex + 1;
    const result: AnnotationInfo[] = [];
    for (let index = first; index < end; index += 1) {
      const page = pageAt(arena, document, index);
      const annotations = keepAnnotations(arena, page);
      annotations.forEach((annotation, ordinal) => {
        result.push(annotationInfo(arena, annotation, index, ordinal));
      });
    }
    return result;
  });
}

interface ExistingTextEditPreflight {
  readonly pageIndex: number;
  readonly rect: EngineTypes['PdfRect'];
  readonly fontName: string;
  readonly encodedReplacement: Uint8Array;
  readonly partialAnalysis: boolean;
}

export function inspectExistingTextEdit(
  document: mupdf.PDFDocument,
  input: EngineTypes['ExistingTextEditInput'],
): ExistingTextEditPreflight {
  if (!input.originalText.trim())
    throw new Error('Existing-text edit refused because the selection is empty.');
  if (!input.replacementText.trim())
    throw new Error('Existing-text edit refused because replacement text is empty.');
  if (input.quads.length === 0)
    throw new Error('Existing-text edit refused because the selection has no glyph geometry.');
  return withArenaSync((arena) => {
    const page = pageAt(arena, document, input.pageIndex);
    const trace = arena.keep(page.processContents());
    const records = trace.getRecords();
    const partialAnalysis = records.some((record) => record.operator === 'Do_form');
    const fontNames = [
      ...new Set(
        records
          .filter((record) => record.operator === 'Tf')
          .map((record) => record.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    if (fontNames.length !== 1) {
      throw new Error(
        `Existing-text edit refused because the selection cannot be tied to one page font (${fontNames.length || 'none'} found). Select text using a single font.`,
      );
    }
    const fontName = fontNames[0];
    if (!fontName)
      throw new Error('Existing-text edit refused because no page font was found.');
    const pageObject = arena.keep(page.getObject());
    const fontObject = arena.keep(pageObject.getInheritable('Resources').get('Font', fontName));
    if (fontObject.isNull())
      throw new Error(`Existing-text edit refused because page font /${fontName} is missing.`);
    const subtype = arena.keep(fontObject.get('Subtype'));
    if (subtype.isName() && subtype.asName() === 'Type3') {
      throw new Error(
        'Existing-text edit refused because Type3 fonts cannot be reused safely.',
      );
    }
    const toUnicode = arena.keep(fontObject.get('ToUnicode'));
    if (!toUnicode.isStream()) {
      throw new Error(
        'Existing-text edit refused because the page font has no /ToUnicode map.',
      );
    }
    const cmapBuffer = arena.keep(toUnicode.readStream());
    const cmap = new TextDecoder().decode(cmapBuffer.asUint8Array());
    return {
      pageIndex: input.pageIndex,
      rect: selectionBounds(input.quads),
      fontName,
      encodedReplacement: encodeWithToUnicodeCMap(input.replacementText, cmap),
      partialAnalysis,
    };
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function editExistingText(
  arena: Arena,
  document: mupdf.PDFDocument,
  input: EngineTypes['ExistingTextEditInput'],
  preflight: ExistingTextEditPreflight,
): AnnotationInfo {
  const page = pageAt(arena, document, preflight.pageIndex);
  const pageObject = arena.keep(page.getObject());
  const fontObject = arena.keep(
    pageObject.getInheritable('Resources').get('Font', preflight.fontName),
  );
  const redaction = arena.keep(page.createAnnotation('Redact'));
  redaction.setFlags(mupdf.PDFAnnotation.IS_PRINT);
  redaction.setRect([...preflight.rect]);
  redaction.setQuadPoints(input.quads.map((quad) => [...quad]));
  redaction.setContents(`Replace ${input.originalText}`);
  redaction.update();
  page.applyRedactions(
    false,
    mupdf.PDFPage.REDACT_IMAGE_NONE,
    mupdf.PDFPage.REDACT_LINE_ART_NONE,
    mupdf.PDFPage.REDACT_TEXT_REMOVE,
  );
  page.update();

  const annotation = arena.keep(page.createAnnotation('FreeText'));
  annotation.setFlags(mupdf.PDFAnnotation.IS_PRINT);
  annotation.setRect([...preflight.rect]);
  annotation.setContents(input.replacementText);
  annotation.setDefaultAppearance(
    'FEdit',
    Math.max(1, (preflight.rect[3] - preflight.rect[1]) * 0.8),
    [0, 0, 0],
  );
  annotation.update();
  const object = arena.keep(annotation.getObject());
  const appearance = arena.keep(object.get('AP', 'N'));
  if (!appearance.isStream())
    throw new Error(
      'Existing-text edit refused because a FreeText appearance could not be created.',
    );
  const resourcesValue = arena.keep(appearance.get('Resources'));
  const resources = resourcesValue.isDictionary()
    ? resourcesValue
    : arena.keep(document.newDictionary());
  if (!resourcesValue.isDictionary()) arena.keep(appearance.put('Resources', resources));
  const fontsValue = arena.keep(resources.get('Font'));
  const fonts = fontsValue.isDictionary() ? fontsValue : arena.keep(document.newDictionary());
  if (!fontsValue.isDictionary()) arena.keep(resources.put('Font', fonts));
  arena.keep(fonts.put('FEdit', fontObject));
  const width = preflight.rect[2] - preflight.rect[0];
  const height = preflight.rect[3] - preflight.rect[1];
  const fontSize = Math.max(1, height * 0.8);
  appearance.writeStream(
    `q BT /FEdit ${fontSize} Tf 0 g 0 ${Math.max(0, height - fontSize)} Td <${bytesToHex(preflight.encodedReplacement)}> Tj ET Q`,
  );
  appearance._putValue('BBox', [0, 0, width, height]);
  return annotationInfo(arena, annotation, input.pageIndex, 0);
}

export function projectedExistingTextEditBytes(
  input: EngineTypes['ExistingTextEditInput'],
): number {
  return (
    32_768 +
    new TextEncoder().encode(`${input.originalText}${input.replacementText}`).byteLength * 8 +
    input.quads.length * 64
  );
}

export function addAnnotation(
  arena: Arena,
  document: mupdf.PDFDocument,
  input: AnnotationInput,
): AnnotationInfo {
  assertRect(input.rect);
  const page = pageAt(arena, document, input.pageIndex);
  const annotation = arena.keep(page.createAnnotation(input.type));
  annotation.setFlags(input.flags ?? mupdf.PDFAnnotation.IS_PRINT);
  annotation.setCreationDate(new Date());
  applyGeometry(annotation, input);
  applyProperties(arena, document, annotation, input);
  applyPayload(arena, document, annotation, input);
  if (input.type === 'FreeText') {
    annotation.setDefaultAppearance('Helv', 12, [...(input.color ?? [0, 0, 0])]);
  }
  annotation.update();
  return annotationInfo(arena, annotation, input.pageIndex, 0);
}

function findAnnotation(
  arena: Arena,
  document: mupdf.PDFDocument,
  pageIndex: number,
  id: number,
): {
  readonly page: mupdf.PDFPage;
  readonly annotation: mupdf.PDFAnnotation;
  readonly ordinal: number;
} {
  const page = pageAt(arena, document, pageIndex);
  const annotations = keepAnnotations(arena, page);
  const ordinal = annotations.findIndex(
    (annotation, index) => annotationId(arena, annotation, index) === id,
  );
  const annotation = annotations[ordinal];
  if (!annotation)
    throw new Error(`Annotation ${id} no longer exists on page ${pageIndex + 1}.`);
  return { page, annotation, ordinal };
}

export function updateAnnotation(
  arena: Arena,
  document: mupdf.PDFDocument,
  pageIndex: number,
  id: number,
  changes: AnnotationUpdate,
): AnnotationInfo {
  const { annotation, ordinal } = findAnnotation(arena, document, pageIndex, id);
  applyGeometry(annotation, changes);
  applyProperties(arena, document, annotation, changes);
  applyPayload(arena, document, annotation, changes);
  annotation.setModificationDate(new Date());
  annotation.update();
  return annotationInfo(arena, annotation, pageIndex, ordinal);
}

export function deleteAnnotation(
  arena: Arena,
  document: mupdf.PDFDocument,
  pageIndex: number,
  id: number,
): void {
  const { page, annotation } = findAnnotation(arena, document, pageIndex, id);
  page.deleteAnnotation(annotation);
}

export default {
  addAnnotation,
  deleteAnnotation,
  editExistingText,
  inspectExistingTextEdit,
  listAnnotations,
  projectedAnnotationBytes,
  projectedExistingTextEditBytes,
  updateAnnotation,
};
