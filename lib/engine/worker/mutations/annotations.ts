import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import type { EngineTypes } from '../../port';
import { selectionBounds } from '../../../text/overlay';
import { withArenaSync, type Arena } from '../arena';
import redactionMutations from './redaction';
import {
  resolveEditableContentStream,
  readDecodedStreamBytes,
  forceWriteContentStream,
  scanContentTokens,
  findSingleAsciiShowTextRun,
  spliceBytes,
} from '../content';

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

/**
 * Byte-span splice coordinates for the narrow, provable in-place text replacement path (see
 * `lib/engine/worker/content/`, ADR 0029). Populated only when every existing geometric/text
 * correlation check below has already passed *and* the additional byte-splice-only conditions
 * hold: the replacement is byte-length-preserving ASCII with no PDF-reserved characters, the
 * page's `/Contents` resolves to exactly one physical stream, and the content stream contains
 * exactly one unescaped `(originalText) Tj` operand. Absent whenever any of that cannot be
 * proven; the caller then falls back to the guarded redact+overlay path unchanged.
 */
interface ByteSplicePreflight {
  readonly streamObjectNumber: number;
  readonly innerStart: number;
  readonly innerEnd: number;
  readonly replacementBytes: Uint8Array;
}

interface ExistingTextEditPreflight {
  readonly pageIndex: number;
  readonly rect: EngineTypes['PdfRect'];
  readonly quads: readonly EngineTypes['PdfQuad'][];
  readonly fontName: string;
  readonly fontSize: number;
  readonly beforeText: string;
  readonly originalOffset: number;
  readonly annotations: readonly string[];
  readonly byteSplice?: ByteSplicePreflight;
}

function quadBounds(quad: EngineTypes['PdfQuad']): EngineTypes['PdfRect'] {
  return [
    Math.min(quad[0], quad[2], quad[4], quad[6]),
    Math.min(quad[1], quad[3], quad[5], quad[7]),
    Math.max(quad[0], quad[2], quad[4], quad[6]),
    Math.max(quad[1], quad[3], quad[5], quad[7]),
  ];
}

function rectsOverlap(left: EngineTypes['PdfRect'], right: EngineTypes['PdfRect']): boolean {
  return left[0] < right[2] && left[2] > right[0] && left[1] < right[3] && left[3] > right[1];
}

function rectsMatch(
  left: EngineTypes['PdfRect'],
  right: EngineTypes['PdfRect'],
  tolerance = 0.1,
): boolean {
  return left.every((value, index) => Math.abs(value - (right[index] ?? value)) <= tolerance);
}

function axisAligned(quad: EngineTypes['PdfQuad']): boolean {
  return (
    Math.abs(quad[1] - quad[3]) <= 0.1 &&
    Math.abs(quad[5] - quad[7]) <= 0.1 &&
    Math.abs(quad[0] - quad[4]) <= 0.1 &&
    Math.abs(quad[2] - quad[6]) <= 0.1
  );
}

function annotationFingerprint(
  arena: Arena,
  annotation: mupdf.PDFAnnotation,
  ordinal: number,
): string {
  return JSON.stringify({
    id: annotationId(arena, annotation, ordinal),
    type: annotation.getType(),
    rect: annotation.hasRect() ? annotation.getRect() : annotation.getBounds(),
    contents: annotation.getContents(),
    flags: annotation.getFlags(),
  });
}

function annotationFingerprints(arena: Arena, page: mupdf.PDFPage): readonly string[] {
  return keepAnnotations(arena, page).map((annotation, ordinal) =>
    annotationFingerprint(arena, annotation, ordinal),
  );
}

function helveticaFontSize(arena: Arena, text: string, rect: EngineTypes['PdfRect']): number {
  const font = arena.keep(new mupdf.Font('Helvetica'));
  const advance = [...text].reduce(
    (total, character) =>
      total + font.advanceGlyph(font.encodeCharacter(character.codePointAt(0) ?? 0)),
    0,
  );
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];
  const size = Math.min(height * 0.8, advance > 0 ? (width * 0.96) / advance : 0, 72);
  if (size < 4) {
    throw new Error(
      'Existing-text edit refused because the replacement does not fit the selected line at a readable size. Shorten the replacement or add a text annotation instead.',
    );
  }
  return size;
}

function selectedFontNames(
  arena: Arena,
  page: mupdf.PDFPage,
  quads: readonly EngineTypes['PdfQuad'][],
): Set<string> {
  const names = new Set<string>();
  const text = arena.keep(page.toStructuredText());
  text.walk({
    onChar: (_character, _origin, font, _size, quad) => {
      arena.keep(font);
      if (quads.some((selection) => rectsOverlap(quadBounds(selection), quadBounds(quad)))) {
        names.add(font.getName());
      }
    },
  });
  return names;
}

function pageCharacters(arena: Arena, page: mupdf.PDFPage): string {
  const characters: string[] = [];
  const text = arena.keep(page.toStructuredText());
  text.walk({
    onChar: (character, _origin, font) => {
      arena.keep(font);
      characters.push(character);
    },
  });
  return characters.join('');
}

const RESERVED_STRING_CHARACTERS = /[()\\]/u;

/**
 * Attempts to compute byte-splice coordinates for a same-length ASCII replacement.
 *
 * This must never throw: it is called after every existing refusal in
 * `inspectExistingTextEdit` has already passed, as a strictly additive narrowing. Any failure
 * to resolve a single content stream, tokenize it, or find exactly one unescaped
 * `(originalText) Tj` operand simply means the byte-splice path is unavailable for this
 * document, and `undefined` is returned so the caller falls back to the guarded
 * redact+overlay path unchanged.
 */
function computeByteSplicePreflight(
  arena: Arena,
  page: mupdf.PDFPage,
  input: EngineTypes['ExistingTextEditInput'],
): ByteSplicePreflight | undefined {
  if (input.replacementText.length !== input.originalText.length) return undefined;
  if (
    RESERVED_STRING_CHARACTERS.test(input.originalText) ||
    RESERVED_STRING_CHARACTERS.test(input.replacementText)
  ) {
    return undefined;
  }
  try {
    const editable = resolveEditableContentStream(arena, page);
    if (!editable.object.isIndirect()) return undefined;
    const bytes = readDecodedStreamBytes(arena, editable.object);
    const tokens = scanContentTokens(bytes);
    const run = findSingleAsciiShowTextRun(tokens, bytes, input.originalText);
    if (!run) return undefined;
    return {
      streamObjectNumber: editable.object.asIndirect(),
      innerStart: run.innerStart,
      innerEnd: run.innerEnd,
      replacementBytes: new TextEncoder().encode(input.replacementText),
    };
  } catch {
    return undefined;
  }
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
  if (/[\r\n]/u.test(input.originalText) || /[\r\n]/u.test(input.replacementText)) {
    throw new Error(
      'Existing-text edit refused because this verified path supports one line at a time. Select one line or add a text annotation instead.',
    );
  }
  if (!/^[\x20-\x7e]+$/u.test(input.replacementText)) {
    throw new Error(
      'Existing-text edit refused because this verified path currently supports printable ASCII replacements only. Add a text annotation for other scripts.',
    );
  }
  return withArenaSync((arena) => {
    const page = pageAt(arena, document, input.pageIndex);
    const trace = arena.keep(page.processContents());
    const records = trace.getRecords();
    const partialAnalysis = records.some((record) => record.operator === 'Do_form');
    if (partialAnalysis) {
      throw new Error(
        'Existing-text edit refused because the selected page uses Form XObject content that this engine cannot analyse completely. Add a text annotation instead.',
      );
    }
    const redactionPreflight = redactionMutations.inspectApplyRedactions(document);
    if (redactionPreflight.marks > 0) {
      throw new Error(
        'Existing-text edit refused while unapplied redaction marks exist. Apply or remove those marks first.',
      );
    }
    if (redactionPreflight.unsupported.length > 0) {
      throw new Error(
        `Existing-text edit refused because ${redactionPreflight.unsupported.join('; ')}. Add a text annotation instead.`,
      );
    }
    const matches = page.search(input.originalText, 2);
    if (matches.length !== 1 || !matches[0]?.length) {
      throw new Error(
        'Existing-text edit refused because the selected text is not a unique page occurrence. Select a unique single-line run or add a text annotation instead.',
      );
    }
    const matchedQuads = matches[0];
    if (
      matchedQuads.some((quad) => !axisAligned(quad)) ||
      !rectsMatch(selectionBounds(matchedQuads), selectionBounds(input.quads))
    ) {
      throw new Error(
        'Existing-text edit refused because the selected text is rotated, skewed, or does not match its extracted glyph geometry. Add a text annotation instead.',
      );
    }
    const rect = selectionBounds(matchedQuads);
    const existingAnnotations = keepAnnotations(arena, page);
    if (
      existingAnnotations.some((annotation) =>
        rectsOverlap(
          annotation.hasRect() ? annotation.getRect() : annotation.getBounds(),
          rect,
        ),
      )
    ) {
      throw new Error(
        'Existing-text edit refused because another annotation overlaps the selected glyphs. Move or remove that annotation first.',
      );
    }
    const selectedNames = selectedFontNames(arena, page, input.quads);
    if (selectedNames.size === 0) {
      throw new Error(
        'Existing-text edit refused because no font could be resolved for the selected glyphs. Add a text annotation instead.',
      );
    }
    if (selectedNames.size !== 1) {
      throw new Error(
        'Existing-text edit refused because the selected glyphs use multiple font programs. Select a run that uses one font, or add a text annotation instead.',
      );
    }
    const selectedName = [...selectedNames][0];
    const fontName = records.find(
      (record) =>
        record.operator === 'Tf' && record.name && record.font?.getName() === selectedName,
    )?.name;
    if (!fontName) {
      throw new Error(
        'Existing-text edit refused because the selected font is inside an unsupported Form XObject. Add a text annotation instead.',
      );
    }
    const pageObject = arena.keep(page.getObject());
    const fontObject = arena.keep(pageObject.getInheritable('Resources').get('Font', fontName));
    if (fontObject.isNull())
      throw new Error(`Existing-text edit refused because page font /${fontName} is missing.`);
    const subtype = arena.keep(fontObject.get('Subtype'));
    if (subtype.isName() && subtype.asName() === 'Type3') {
      throw new Error(
        'Existing-text edit refused because Type3 fonts cannot be reused safely. This text cannot be edited; add a text annotation instead.',
      );
    }
    const beforeText = pageCharacters(arena, page);
    const originalOffset = beforeText.indexOf(input.originalText);
    if (
      originalOffset < 0 ||
      beforeText.indexOf(input.originalText, originalOffset + input.originalText.length) >= 0
    ) {
      throw new Error(
        'Existing-text edit refused because the extracted page text does not contain one unambiguous selected occurrence.',
      );
    }
    const byteSplice = computeByteSplicePreflight(arena, page, input);
    return {
      pageIndex: input.pageIndex,
      rect,
      quads: matchedQuads.map((quad) => [...quad]),
      fontName,
      fontSize: helveticaFontSize(arena, input.replacementText, rect),
      beforeText,
      originalOffset,
      annotations: annotationFingerprints(arena, page),
      ...(byteSplice ? { byteSplice } : {}),
    };
  });
}

export function editExistingText(
  arena: Arena,
  document: mupdf.PDFDocument,
  input: EngineTypes['ExistingTextEditInput'],
  preflight: ExistingTextEditPreflight,
): AnnotationInfo {
  const page = pageAt(arena, document, preflight.pageIndex);
  const redaction = arena.keep(page.createAnnotation('Redact'));
  redaction.setQuadPoints(preflight.quads.map((quad) => [...quad]));
  redaction.update();
  page.applyRedactions(
    false,
    mupdf.PDFPage.REDACT_IMAGE_REMOVE,
    mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
    mupdf.PDFPage.REDACT_TEXT_REMOVE,
  );
  page.update();

  const afterRemoval = pageCharacters(arena, page);
  const expected =
    preflight.beforeText.slice(0, preflight.originalOffset) +
    preflight.beforeText.slice(preflight.originalOffset + input.originalText.length);
  if (afterRemoval !== expected || afterRemoval.includes(input.originalText)) {
    throw new Error(
      'Existing-text edit was rolled back because removing the selected glyphs changed other page text.',
    );
  }
  if (
    JSON.stringify(annotationFingerprints(arena, page)) !==
    JSON.stringify(preflight.annotations)
  ) {
    throw new Error(
      'Existing-text edit was rolled back because removing the selected glyphs changed another annotation.',
    );
  }

  const replacement = arena.keep(page.createAnnotation('FreeText'));
  replacement.setRect([...preflight.rect]);
  replacement.setContents(input.replacementText);
  replacement.setDefaultAppearance('Helv', preflight.fontSize, [0, 0, 0]);
  replacement.setBorderWidth(0);
  replacement.setFlags(mupdf.PDFAnnotation.IS_PRINT);
  replacement.update();
  page.update();

  const replacementObject = arena.keep(replacement.getObject());
  const appearance = arena.keep(replacementObject.get('AP', 'N'));
  if (!appearance.isStream()) {
    throw new Error(
      'Existing-text edit was rolled back because the replacement appearance was not written.',
    );
  }
  const appearanceBytes = arena.keep(appearance.readStream());
  const annotations = keepAnnotations(arena, page);
  const replacementId = annotationId(arena, replacement, annotations.length - 1);
  const ordinal = annotations.findIndex(
    (annotation, index) => annotationId(arena, annotation, index) === replacementId,
  );
  if (
    appearanceBytes.getLength() === 0 ||
    replacement.getContents() !== input.replacementText ||
    !rectsMatch(replacement.getRect(), preflight.rect) ||
    ordinal < 0 ||
    annotations.length !== preflight.annotations.length + 1
  ) {
    throw new Error(
      'Existing-text edit was rolled back because the replacement could not be verified before commit.',
    );
  }
  return annotationInfo(arena, replacement, preflight.pageIndex, ordinal);
}

/**
 * Result of {@link spliceExistingText}. `applied: false` means the preflight found no provable
 * byte-splice opportunity for this edit (see {@link computeByteSplicePreflight}), and the
 * caller must fall back to {@link editExistingText}'s guarded redact+overlay path, unchanged.
 */
export interface ByteSpliceEditReport {
  readonly applied: boolean;
  readonly streamObjectNumber?: number;
}

/**
 * Performs the narrow, provable in-place byte-splice text replacement (ADR 0029) instead of
 * the redact+FreeText-overlay path, when and only when `preflight.byteSplice` proved it safe.
 *
 * This is deliberately a *separate* function from {@link editExistingText} rather than a
 * change to that function's signature: `editExistingText` is called across the worker/port
 * boundary (`lib/engine/worker/doc-runtime.ts`, out of scope for this change) with a return
 * type of `AnnotationInfo` that the shared protocol (`lib/engine/port.ts`, also out of scope)
 * currently expects unconditionally. A byte-splice edit creates no new annotation to report,
 * so this function is exposed alongside `editExistingText` for direct use (as the existing
 * `editExistingText` already is in `tests/existing-text-edit.test.ts`) until the shared
 * protocol surface is extended to expose an annotation-less mutation result.
 *
 * Re-derives the splice from `preflight.byteSplice`'s recorded coordinates against a freshly
 * read copy of the stream (rather than trusting the preflight's snapshot blindly), then applies
 * the exact same postcondition-or-rollback discipline `editExistingText` uses: after the
 * forced write, the page is reloaded fresh and its extracted text and annotation set are
 * re-verified against what the preflight predicted, throwing (which the caller's
 * `journalOperation` rolls back) on any mismatch.
 */
export function spliceExistingText(
  arena: Arena,
  document: mupdf.PDFDocument,
  input: EngineTypes['ExistingTextEditInput'],
  preflight: ExistingTextEditPreflight,
): ByteSpliceEditReport {
  const byteSplice = preflight.byteSplice;
  if (!byteSplice) return { applied: false };

  const streamObject = arena.keep(document.newIndirect(byteSplice.streamObjectNumber));
  if (!streamObject.isStream()) {
    throw new Error(
      'Existing-text edit byte splice was rolled back because the recorded content stream is no longer a stream.',
    );
  }
  const bytes = readDecodedStreamBytes(arena, streamObject);
  const tokens = scanContentTokens(bytes);
  const run = findSingleAsciiShowTextRun(tokens, bytes, input.originalText);
  if (
    !run ||
    run.innerStart !== byteSplice.innerStart ||
    run.innerEnd !== byteSplice.innerEnd
  ) {
    throw new Error(
      'Existing-text edit byte splice was rolled back because the selected run could not be re-verified against the content stream immediately before writing.',
    );
  }

  const newBytes = spliceBytes(bytes, [
    { start: run.innerStart, end: run.innerEnd, replacement: byteSplice.replacementBytes },
  ]);
  forceWriteContentStream(arena, document, streamObject, newBytes);

  const reloadedPage = arena.keep(document.loadPage(preflight.pageIndex));
  const afterSplice = pageCharacters(arena, reloadedPage);
  const expected =
    preflight.beforeText.slice(0, preflight.originalOffset) +
    input.replacementText +
    preflight.beforeText.slice(preflight.originalOffset + input.originalText.length);
  if (afterSplice !== expected) {
    throw new Error(
      'Existing-text edit byte splice was rolled back because the page text read back after the write did not match the predicted replacement.',
    );
  }
  if (
    JSON.stringify(annotationFingerprints(arena, reloadedPage)) !==
    JSON.stringify(preflight.annotations)
  ) {
    throw new Error(
      'Existing-text edit byte splice was rolled back because the write changed an annotation it should not have touched.',
    );
  }
  return { applied: true, streamObjectNumber: byteSplice.streamObjectNumber };
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
  spliceExistingText,
  updateAnnotation,
};
