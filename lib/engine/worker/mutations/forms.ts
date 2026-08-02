import * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import { decodePdfTextString } from '../../../text/encoding';
import type { EngineTypes } from '../../port';
import { withArenaSync, type Arena } from '../arena';

type FormFieldInfo = EngineTypes['FormFieldInfo'];
type JavaScriptAction = EngineTypes['JavaScriptAction'];
type JavaScriptActionIdentity = EngineTypes['JavaScriptActionIdentity'];
type JavaScriptActionInput = EngineTypes['JavaScriptActionInput'];
type JavaScriptTrigger = EngineTypes['JavaScriptTrigger'];

const TRIGGER_KEYS: Readonly<Record<JavaScriptTrigger, string>> = {
  keystroke: 'K',
  format: 'F',
  validate: 'V',
  calculate: 'C',
};
const MAX_JAVASCRIPT_SOURCE_BYTES = 4 * 1024 * 1024;
const FORM_FONT_PREFIX = 'FormHelv';
const FORM_FONT_SIZE = 12;
const COMB_DEFAULT_MAX_LENGTH = 20;

function existingAcroForm(arena: Arena, document: mupdf.PDFDocument): mupdf.PDFObject {
  const trailer = arena.keep(document.getTrailer());
  const form = arena.keep(trailer.get('Root', 'AcroForm'));
  if (!form.isDictionary()) throw new Error('This document has no AcroForm dictionary.');
  return form;
}

function keepWidgets(arena: Arena, page: mupdf.PDFPage): mupdf.PDFWidget[] {
  const widgets = page.getWidgets();
  for (const widget of widgets) arena.keep(widget);
  return widgets;
}

function setCalculationOrder(
  arena: Arena,
  document: mupdf.PDFDocument,
  field: mupdf.PDFObject,
): void {
  const form = existingAcroForm(arena, document);
  const existing = arena.keep(form.get('CO'));
  const order = existing.isArray() ? existing : arena.keep(document.newArray());
  if (!existing.isArray()) arena.keep(form.put('CO', order));
  const name = qualifiedFieldName(arena, field);
  for (let index = 0; index < order.length; index += 1) {
    const item = arena.keep(order.get(index));
    if (qualifiedFieldName(arena, item) === name) return;
  }
  arena.keep(order.push(field));
}

function removeFromCalculationOrder(
  arena: Arena,
  document: mupdf.PDFDocument,
  name: string,
): void {
  const form = existingAcroForm(arena, document);
  const existing = arena.keep(form.get('CO'));
  if (!existing.isArray()) return;
  const order = arena.keep(document.newArray());
  for (let index = 0; index < existing.length; index += 1) {
    const item = arena.keep(existing.get(index));
    if (qualifiedFieldName(arena, item) !== name) arena.keep(order.push(item));
  }
  arena.keep(form.put('CO', order));
}

function fieldId(arena: Arena, widget: mupdf.PDFWidget, ordinal: number): number {
  const object = arena.keep(widget.getObject());
  return object.isIndirect() ? object.asIndirect() : -(ordinal + 1);
}

function widgetString(arena: Arena, widget: mupdf.PDFWidget, key: string): string {
  const object = arena.keep(widget.getObject());
  const value = arena.keep(object.getInheritable(key));
  return value.isString() ? value.asString() : '';
}

function widgetName(arena: Arena, widget: mupdf.PDFWidget): string {
  return widget.getName() || widgetString(arena, widget, 'T');
}

function objectName(arena: Arena, object: mupdf.PDFObject): string {
  return qualifiedFieldName(arena, canonicalField(arena, object));
}

function appearanceStates(arena: Arena, object: mupdf.PDFObject): string[] {
  const normal = arena.keep(object.get('AP', 'N'));
  if (!normal.isDictionary()) return [];
  const states: string[] = [];
  normal.forEach((value, key) => {
    arena.keep(value);
    if (typeof key === 'string' && key !== 'Off') states.push(key);
  });
  return states;
}

function canonicalField(arena: Arena, object: mupdf.PDFObject): mupdf.PDFObject {
  let field = object;
  const seen = new Set<number>();
  for (let depth = 0; depth < 64; depth += 1) {
    if (field.isIndirect()) {
      const objectNumber = field.asIndirect();
      if (seen.has(objectNumber)) break;
      seen.add(objectNumber);
    }
    const partialName = arena.keep(field.get('T'));
    const fieldType = arena.keep(field.get('FT'));
    if (partialName.isString() || fieldType.isName()) break;
    const parent = arena.keep(field.get('Parent'));
    if (!parent.isDictionary()) break;
    field = parent;
  }
  return field;
}

function qualifiedFieldName(arena: Arena, object: mupdf.PDFObject): string {
  const parts: string[] = [];
  let field = object;
  const seen = new Set<number>();
  for (let depth = 0; depth < 64; depth += 1) {
    if (field.isIndirect()) {
      const objectNumber = field.asIndirect();
      if (seen.has(objectNumber)) break;
      seen.add(objectNumber);
    }
    const partialName = arena.keep(field.get('T'));
    if (partialName.isString()) parts.unshift(partialName.asString());
    const parent = arena.keep(field.get('Parent'));
    if (!parent.isDictionary()) break;
    field = parent;
  }
  return parts.join('.');
}

function javaScriptAction(
  arena: Arena,
  document: mupdf.PDFDocument,
  source: string,
): mupdf.PDFObject {
  const action = arena.keep(document.newDictionary());
  const actionType = arena.keep(document.newName('JavaScript'));
  const script = arena.keep(document.newString(source));
  arena.keep(action.put('S', actionType));
  arena.keep(action.put('JS', script));
  return action;
}

function actionSource(arena: Arena, action: mupdf.PDFObject): string {
  if (!action.isDictionary()) return '';
  const source = arena.keep(action.get('JS'));
  if (source.isString()) return source.asString();
  if (source.isStream()) {
    const bytes = arena.keep(source.readStreamMax(MAX_JAVASCRIPT_SOURCE_BYTES)).asUint8Array();
    return decodePdfTextString(bytes);
  }
  return '';
}

function scriptId(identity: JavaScriptActionIdentity): string {
  return identity.scope === 'document'
    ? `document:${identity.name}`
    : `field:${identity.name}:${identity.trigger ?? 'unknown'}`;
}

interface NameTreeEntry {
  readonly name: string;
  readonly key: mupdf.PDFObject;
  readonly value: mupdf.PDFObject;
}

function collectNameTree(
  arena: Arena,
  node: mupdf.PDFObject,
  entries: NameTreeEntry[],
  seen: Set<number>,
): void {
  if (!node.isDictionary()) return;
  if (node.isIndirect()) {
    const objectNumber = node.asIndirect();
    if (seen.has(objectNumber)) return;
    seen.add(objectNumber);
  }
  const names = arena.keep(node.get('Names'));
  if (names.isArray()) {
    for (let index = 0; index + 1 < names.length; index += 2) {
      const name = arena.keep(names.get(index));
      const value = arena.keep(names.get(index + 1));
      if (name.isString()) entries.push({ name: name.asString(), key: name, value });
    }
  }
  const kids = arena.keep(node.get('Kids'));
  if (kids.isArray()) {
    for (let index = 0; index < kids.length; index += 1) {
      collectNameTree(arena, arena.keep(kids.get(index)), entries, seen);
    }
  }
}

function catalogNames(
  arena: Arena,
  document: mupdf.PDFDocument,
  create: boolean,
): mupdf.PDFObject {
  const trailer = arena.keep(document.getTrailer());
  const root = arena.keep(trailer.get('Root'));
  const existing = arena.keep(root.get('Names'));
  if (existing.isDictionary() || !create) return existing;
  const names = arena.keep(document.newDictionary());
  arena.keep(root.put('Names', names));
  return names;
}

function documentJavaScriptTree(
  arena: Arena,
  document: mupdf.PDFDocument,
  create: boolean,
): mupdf.PDFObject {
  const names = catalogNames(arena, document, create);
  if (!names.isDictionary()) return names;
  const existing = arena.keep(names.get('JavaScript'));
  if (existing.isDictionary() || !create) return existing;
  const tree = arena.keep(document.newDictionary());
  const values = arena.keep(document.newArray());
  arena.keep(tree.put('Names', values));
  arena.keep(names.put('JavaScript', tree));
  return tree;
}

function documentScripts(arena: Arena, document: mupdf.PDFDocument): JavaScriptAction[] {
  const tree = documentJavaScriptTree(arena, document, false);
  if (!tree.isDictionary()) return [];
  const entries: NameTreeEntry[] = [];
  collectNameTree(arena, tree, entries, new Set());
  return entries.map(({ name, value }) => ({
    id: scriptId({ scope: 'document', name }),
    scope: 'document',
    name,
    source: actionSource(arena, value),
  }));
}

function fieldScripts(arena: Arena, document: mupdf.PDFDocument): JavaScriptAction[] {
  const actions: JavaScriptAction[] = [];
  const seen = new Set<string>();
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = arena.keep(document.loadPage(pageIndex));
    for (const widget of keepWidgets(arena, page)) {
      const name = widgetName(arena, widget);
      if (!name) continue;
      const object = arena.keep(widget.getObject());
      const additionalActions = arena.keep(object.getInheritable('AA'));
      if (!additionalActions.isDictionary()) continue;
      for (const [trigger, key] of Object.entries(TRIGGER_KEYS) as [
        JavaScriptTrigger,
        string,
      ][]) {
        const identity: JavaScriptActionIdentity = { scope: 'field', name, trigger };
        const id = scriptId(identity);
        if (seen.has(id)) continue;
        const action = arena.keep(additionalActions.get(key));
        const source = actionSource(arena, action);
        if (!source) continue;
        seen.add(id);
        actions.push({
          id,
          scope: 'field',
          name: `${name} · ${trigger}`,
          fieldName: name,
          trigger,
          source,
        });
      }
    }
  }
  return actions;
}

export function listJavaScriptActions(document: mupdf.PDFDocument): JavaScriptAction[] {
  return withArenaSync((arena) => [
    ...documentScripts(arena, document),
    ...fieldScripts(arena, document),
  ]);
}

export function disableDocumentScriptsForEvaluation(document: mupdf.PDFDocument): void {
  withArenaSync((arena) => {
    const names = catalogNames(arena, document, false);
    if (names.isDictionary()) names.delete('JavaScript');
  });
}

export function countJavaScriptActions(
  document: mupdf.PDFDocument,
  scope: 'document' | 'field',
): number {
  return withArenaSync((arena) => {
    if (scope === 'document') {
      const tree = documentJavaScriptTree(arena, document, false);
      if (!tree.isDictionary()) return 0;
      const entries: NameTreeEntry[] = [];
      collectNameTree(arena, tree, entries, new Set());
      return entries.length;
    }
    let count = 0;
    const seen = new Set<string>();
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const page = arena.keep(document.loadPage(pageIndex));
      for (const widget of keepWidgets(arena, page)) {
        const name = widgetName(arena, widget);
        if (!name) continue;
        const object = arena.keep(widget.getObject());
        const additionalActions = arena.keep(object.getInheritable('AA'));
        if (!additionalActions.isDictionary()) continue;
        for (const [trigger, key] of Object.entries(TRIGGER_KEYS) as [
          JavaScriptTrigger,
          string,
        ][]) {
          const id = scriptId({ scope: 'field', name, trigger });
          if (seen.has(id)) continue;
          const action = arena.keep(additionalActions.get(key));
          if (!action.isDictionary()) continue;
          const type = arena.keep(action.get('S'));
          const source = arena.keep(action.get('JS'));
          if (
            !type.isName() ||
            type.asName() !== 'JavaScript' ||
            (!source.isString() && !source.isStream())
          ) {
            continue;
          }
          seen.add(id);
          count += 1;
        }
      }
    }
    return count;
  });
}

function rewriteDocumentScripts(
  arena: Arena,
  document: mupdf.PDFDocument,
  update: {
    readonly name: string;
    readonly action?: mupdf.PDFObject;
  },
): boolean {
  const tree = documentJavaScriptTree(arena, document, update.action !== undefined);
  if (!tree.isDictionary()) return false;
  const entries: NameTreeEntry[] = [];
  collectNameTree(arena, tree, entries, new Set());
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const existed = byName.has(update.name);
  if (update.action) {
    const key = arena.keep(document.newString(update.name));
    byName.set(update.name, { name: update.name, key, value: update.action });
  } else byName.delete(update.name);
  const flattened = arena.keep(document.newArray());
  const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return left.length - right.length;
  };
  for (const entry of [...byName.values()].sort((left, right) =>
    compareBytes(left.key.asByteString(), right.key.asByteString()),
  )) {
    arena.keep(flattened.push(entry.key));
    arena.keep(flattened.push(entry.value));
  }
  arena.keep(tree.put('Names', flattened));
  tree.delete('Kids');
  tree.delete('Limits');
  return existed;
}

export function setJavaScriptAction(
  arena: Arena,
  document: mupdf.PDFDocument,
  input: JavaScriptActionInput,
): void {
  const name = input.name.trim();
  if (!name) throw new Error('A JavaScript action needs a document or field name.');
  if (!input.source.trim()) throw new Error('A JavaScript action needs source code.');
  const action = javaScriptAction(arena, document, input.source);
  if (input.scope === 'document') {
    rewriteDocumentScripts(arena, document, { name, action });
    return;
  }
  if (!input.trigger) throw new Error('Choose a field event for the JavaScript action.');
  const key = TRIGGER_KEYS[input.trigger];
  let changed = 0;
  const authored = new Set<string>();
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = arena.keep(document.loadPage(pageIndex));
    for (const widget of keepWidgets(arena, page)) {
      if (widgetName(arena, widget) !== name) continue;
      const field = canonicalField(arena, arena.keep(widget.getObject()));
      const owner = field.isIndirect() ? `object:${field.asIndirect()}` : `field:${name}`;
      if (!authored.has(owner)) {
        const existing = arena.keep(field.get('AA'));
        const additionalActions = existing.isDictionary()
          ? existing
          : arena.keep(document.newDictionary());
        if (!existing.isDictionary()) arena.keep(field.put('AA', additionalActions));
        arena.keep(additionalActions.put(key, action));
        if (input.trigger === 'calculate') setCalculationOrder(arena, document, field);
        authored.add(owner);
      }
      widget.update();
      changed += 1;
    }
    if (changed > 0) page.update();
  }
  if (changed === 0) throw new Error(`The form field "${name}" no longer exists.`);
}

export function deleteJavaScriptAction(
  arena: Arena,
  document: mupdf.PDFDocument,
  input: JavaScriptActionIdentity,
): void {
  const name = input.name.trim();
  if (!name) throw new Error('Choose a JavaScript action to remove.');
  if (input.scope === 'document') {
    if (!rewriteDocumentScripts(arena, document, { name })) {
      throw new Error(`The document script "${name}" no longer exists.`);
    }
    return;
  }
  if (!input.trigger) throw new Error('Choose a field event to remove.');
  const key = TRIGGER_KEYS[input.trigger];
  let changed = 0;
  const authored = new Set<string>();
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = arena.keep(document.loadPage(pageIndex));
    for (const widget of keepWidgets(arena, page)) {
      if (widgetName(arena, widget) !== name) continue;
      const field = canonicalField(arena, arena.keep(widget.getObject()));
      const owner = field.isIndirect() ? `object:${field.asIndirect()}` : `field:${name}`;
      if (!authored.has(owner)) {
        const additionalActions = arena.keep(field.get('AA'));
        if (!additionalActions.isDictionary()) continue;
        const action = arena.keep(additionalActions.get(key));
        if (!action.isDictionary()) continue;
        additionalActions.delete(key);
        authored.add(owner);
      }
      widget.update();
      changed += 1;
    }
    if (changed > 0) page.update();
  }
  if (changed === 0) {
    throw new Error(`The ${input.trigger} script for "${name}" no longer exists.`);
  }
  if (input.trigger === 'calculate') removeFromCalculationOrder(arena, document, name);
}

export function listFields(document: mupdf.PDFDocument): FormFieldInfo[] {
  return withArenaSync((arena) => {
    const result: FormFieldInfo[] = [];
    for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
      const page = arena.keep(document.loadPage(pageIndex));
      keepWidgets(arena, page).forEach((widget, ordinal) => {
        const object = arena.keep(widget.getObject());
        result.push({
          id: fieldId(arena, widget, ordinal),
          pageIndex,
          name: widgetName(arena, widget),
          label: widgetString(arena, widget, 'TU') || widget.getLabel(),
          type: widget.getFieldType(),
          value: widget.getValue(),
          readOnly: widget.isReadOnly(),
          required: Boolean(widget.getFieldFlags() & mupdf.PDFWidget.FIELD_IS_REQUIRED),
          multiline: widget.isText() && widget.isMultiline(),
          password: widget.isText() && widget.isPassword(),
          options: widget.isChoice()
            ? widget.getOptions()
            : widget.isRadioButton()
              ? appearanceStates(arena, object)
              : [],
          rect: widget.getRect(),
        });
      });
    }
    return result;
  });
}

export function setFieldValue(
  arena: Arena,
  document: mupdf.PDFDocument,
  name: string,
  value: string | boolean,
): number {
  if (!name) throw new Error('Choose a named form field.');
  const matches: { readonly page: mupdf.PDFPage; readonly widget: mupdf.PDFWidget }[] = [];
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = arena.keep(document.loadPage(pageIndex));
    for (const widget of keepWidgets(arena, page)) {
      if (widgetName(arena, widget) === name) matches.push({ page, widget });
    }
  }
  if (matches.length === 0) throw new Error(`The form field "${name}" no longer exists.`);
  if (matches.some(({ widget }) => widget.isReadOnly())) {
    throw new Error(`The form field "${name}" is read-only.`);
  }

  const representativeMatch = matches[0];
  const representative = representativeMatch?.widget;
  if (!representative || !representativeMatch) {
    throw new Error(`The form field "${name}" no longer exists.`);
  }
  if (
    representative.isChoice() &&
    Boolean(representative.getFieldFlags() & mupdf.PDFWidget.CH_FIELD_IS_MULTI_SELECT)
  ) {
    throw new Error(
      `The multi-select field "${name}" cannot be filled because the current value binding represents one value only.`,
    );
  }

  let changed = 0;
  if (typeof value === 'boolean' && representative.isRadioButton() && matches.length > 1) {
    // A boolean protocol value does not identify a member of a radio group. Selecting the
    // first widget is deterministic; callers that need a particular member pass its export
    // value (which listFields exposes in options).
    if (value && representative.getValue() === 'Off') representative.toggle();
    if (!value && representative.getValue() !== 'Off') representative.toggle();
    representative.update();
    representativeMatch.page.update();
    return 1;
  }

  for (const { page, widget } of matches) {
    if (typeof value === 'boolean') {
      if (!widget.isCheckbox() && !widget.isRadioButton()) {
        throw new Error(`The form field "${name}" does not accept an on/off value.`);
      }
      const isOn = widget.getValue() !== 'Off';
      if (isOn !== value) widget.toggle();
    } else if (widget.isRadioButton()) {
      const object = arena.keep(widget.getObject());
      if (!appearanceStates(arena, object).includes(value)) continue;
      if (widget.getValue() !== value) widget.toggle();
    } else if (widget.isText()) {
      if (!widget.setTextValue(value)) {
        throw new Error(`The form field "${name}" rejected the supplied text.`);
      }
    } else if (widget.isChoice()) {
      if (!widget.setChoiceValue(value)) {
        throw new Error(`The form field "${name}" rejected the selected option.`);
      }
    } else {
      throw new Error(`The form field "${name}" cannot be filled with text.`);
    }
    widget.update();
    page.update();
    changed += 1;
  }
  if (typeof value === 'string' && representative.isRadioButton() && changed === 0) {
    throw new Error(`"${value}" is not an export value for the radio field "${name}".`);
  }
  return changed;
}

export function setFieldValues(
  arena: Arena,
  document: mupdf.PDFDocument,
  values: Readonly<Record<string, string | boolean>>,
): number {
  const entries = Object.entries(values);
  if (entries.length === 0) throw new Error('The imported form data has no field values.');
  let changed = 0;
  for (const [name, value] of entries) {
    changed += setFieldValue(arena, document, name, value);
  }
  return changed;
}

function assertRect(rect: EngineTypes['PdfRect']): void {
  if (
    rect.some((value) => !Number.isFinite(value)) ||
    rect[2] <= rect[0] ||
    rect[3] <= rect[1]
  ) {
    throw new Error('A form field rectangle must have finite positive width and height.');
  }
}

function isHelvetica(arena: Arena, font: mupdf.PDFObject): boolean {
  if (!font.isDictionary()) return false;
  const type = arena.keep(font.get('Type'));
  const subtype = arena.keep(font.get('Subtype'));
  const baseFont = arena.keep(font.get('BaseFont'));
  return (
    type.isName() &&
    type.asName() === 'Font' &&
    subtype.isName() &&
    subtype.asName() === 'Type1' &&
    baseFont.isName() &&
    baseFont.asName() === 'Helvetica'
  );
}

function formFontName(
  arena: Arena,
  document: mupdf.PDFDocument,
  fonts: mupdf.PDFObject,
): string {
  for (let suffix = 0; suffix < 128; suffix += 1) {
    const name = `${FORM_FONT_PREFIX}${suffix || ''}`;
    const existing = arena.keep(fonts.get(name));
    if (isHelvetica(arena, existing)) return name;
    if (existing.isNull()) {
      const helvetica = arena.keep(document.newDictionary());
      arena.keep(helvetica.put('Type', arena.keep(document.newName('Font'))));
      arena.keep(helvetica.put('Subtype', arena.keep(document.newName('Type1'))));
      arena.keep(helvetica.put('BaseFont', arena.keep(document.newName('Helvetica'))));
      arena.keep(helvetica.put('Encoding', arena.keep(document.newName('WinAnsiEncoding'))));
      const reference = arena.keep(document.addObject(helvetica));
      arena.keep(fonts.put(name, reference));
      return name;
    }
  }
  throw new Error('Unable to reserve a form-level Helvetica resource name.');
}

function acroForm(
  arena: Arena,
  document: mupdf.PDFDocument,
): { readonly form: mupdf.PDFObject; readonly fontName: string } {
  const trailer = arena.keep(document.getTrailer());
  const root = arena.keep(trailer.get('Root'));
  const existing = arena.keep(root.get('AcroForm'));
  const form = existing.isDictionary() ? existing : arena.keep(document.newDictionary());
  if (!existing.isDictionary()) arena.keep(root.put('AcroForm', form));
  const existingFields = arena.keep(form.get('Fields'));
  if (!existingFields.isArray()) {
    const fields = arena.keep(document.newArray());
    arena.keep(form.put('Fields', fields));
  }
  const existingResources = arena.keep(form.get('DR'));
  const resources = existingResources.isDictionary()
    ? existingResources
    : arena.keep(document.newDictionary());
  if (!existingResources.isDictionary()) arena.keep(form.put('DR', resources));
  const existingFonts = arena.keep(resources.get('Font'));
  const fonts = existingFonts.isDictionary()
    ? existingFonts
    : arena.keep(document.newDictionary());
  if (!existingFonts.isDictionary()) arena.keep(resources.put('Font', fonts));
  const fontName = formFontName(arena, document, fonts);
  const defaultAppearance = arena.keep(form.get('DA'));
  if (!defaultAppearance.isString()) {
    const appearance = arena.keep(document.newString(`/${fontName} ${FORM_FONT_SIZE} Tf 0 g`));
    arena.keep(form.put('DA', appearance));
  }
  // We generate each widget appearance below. Asking readers to regenerate them would make
  // the written output depend on reader-specific form support.
  arena.keep(form.put('NeedAppearances', false));
  return { form, fontName };
}

function fieldFlags(input: EngineTypes['FormFieldInput']): number {
  let flags = 0;
  if (input.readOnly) flags |= mupdf.PDFWidget.FIELD_IS_READ_ONLY;
  if (input.required) flags |= mupdf.PDFWidget.FIELD_IS_REQUIRED;
  if (input.type === 'text') {
    if (input.comb && (input.multiline || input.password)) {
      throw new Error('A comb text field cannot also be multiline or password-protected.');
    }
    if (input.multiline) flags |= mupdf.PDFWidget.TX_FIELD_IS_MULTILINE;
    if (input.password) flags |= mupdf.PDFWidget.TX_FIELD_IS_PASSWORD;
    if (input.comb) flags |= mupdf.PDFWidget.TX_FIELD_IS_COMB;
  } else if (input.type === 'radio') {
    flags |= mupdf.PDFWidget.BTN_FIELD_IS_RADIO;
  } else if (input.type === 'button') {
    flags |= mupdf.PDFWidget.BTN_FIELD_IS_PUSHBUTTON;
  } else if (input.type === 'combo') {
    flags |= mupdf.PDFWidget.CH_FIELD_IS_COMBO;
    if (input.editable) flags |= mupdf.PDFWidget.CH_FIELD_IS_EDIT;
  } else if (input.type === 'list' && input.multiple) {
    flags |= mupdf.PDFWidget.CH_FIELD_IS_MULTI_SELECT;
  }
  return flags;
}

function fieldName(arena: Arena, object: mupdf.PDFObject): string {
  return objectName(arena, object);
}

function assertUniqueFieldName(document: mupdf.PDFDocument, name: string): void {
  const normalized = name.trim();
  if (!normalized) throw new Error('A form field needs a unique name.');
  for (const field of listFields(document)) {
    if (field.name === normalized) {
      throw new Error(`A form field named "${normalized}" already exists.`);
    }
  }
}

export function createFormField(
  arena: Arena,
  document: mupdf.PDFDocument,
  input: EngineTypes['FormFieldInput'],
): void {
  assertRect(input.rect);
  assertUniqueFieldName(document, input.name);
  const flags = fieldFlags(input);
  if (
    !Number.isInteger(input.pageIndex) ||
    input.pageIndex < 0 ||
    input.pageIndex >= document.countPages()
  ) {
    throw new Error(`Page ${input.pageIndex + 1} is outside this document.`);
  }
  if (
    (input.type === 'combo' || input.type === 'list') &&
    (!input.options || input.options.length === 0)
  ) {
    throw new Error(`${input.type === 'combo' ? 'Dropdown' : 'List'} fields need an option.`);
  }

  const page = arena.keep(document.loadPage(input.pageIndex));
  const widget = arena.keep(page.createAnnotation('Widget'));
  const object = arena.keep(widget.getObject());
  const fieldType =
    input.type === 'text'
      ? 'Tx'
      : input.type === 'combo' || input.type === 'list'
        ? 'Ch'
        : input.type === 'signature'
          ? 'Sig'
          : 'Btn';
  const typeName = arena.keep(document.newName(fieldType));
  const name = arena.keep(document.newString(input.name.trim()));
  const label = arena.keep(document.newString(input.label?.trim() || input.name.trim()));
  arena.keep(object.put('FT', typeName));
  arena.keep(object.put('T', name));
  arena.keep(object.put('TU', label));
  arena.keep(object.put('Ff', flags));
  arena.keep(object.put('F', mupdf.PDFAnnotation.IS_PRINT));
  if (fieldType === 'Tx' || fieldType === 'Ch') {
    const emptyValue = arena.keep(document.newString(''));
    const emptyDefault = arena.keep(document.newString(''));
    arena.keep(object.put('V', emptyValue));
    arena.keep(object.put('DV', emptyDefault));
  } else if (input.type === 'checkbox' || input.type === 'radio') {
    const off = arena.keep(document.newName('Off'));
    arena.keep(object.put('V', off));
    arena.keep(object.put('AS', off));
  }
  if (input.options) {
    const options = arena.keep(document.newArray());
    for (const option of input.options) {
      const value = arena.keep(document.newString(option));
      arena.keep(options.push(value));
    }
    arena.keep(object.put('Opt', options));
  }
  const { form, fontName } = acroForm(arena, document);
  // This is deliberately the only field-level /DA write. setDefaultAppearance writes the
  // syntax MuPDF uses to generate /AP, while the form-level /DR above supplies its resource.
  widget.setDefaultAppearance(fontName, FORM_FONT_SIZE, [0, 0, 0]);
  if (input.comb) {
    arena.keep(object.put('MaxLen', COMB_DEFAULT_MAX_LENGTH));
  }
  widget.setRect([...input.rect]);
  widget.update();
  page.update();

  const fields = arena.keep(form.get('Fields'));
  arena.keep(fields.push(object));
  const pageObject = arena.keep(document.findPage(input.pageIndex));
  const annotationOrder = arena.keep(document.newName('A'));
  arena.keep(pageObject.put('Tabs', annotationOrder));
}

export function updateFormField(
  arena: Arena,
  document: mupdf.PDFDocument,
  name: string,
  changes: EngineTypes['FormFieldUpdate'],
): void {
  if (!name.trim()) throw new Error('Choose a named form field.');
  if (changes.rect) assertRect(changes.rect);
  if (changes.name !== undefined && changes.name.trim() !== name) {
    assertUniqueFieldName(document, changes.name);
  }
  let changed = 0;
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const page = arena.keep(document.loadPage(pageIndex));
    for (const widget of keepWidgets(arena, page)) {
      if (widgetName(arena, widget) !== name) continue;
      const object = arena.keep(widget.getObject());
      if (changes.name !== undefined) {
        const nextName = arena.keep(document.newString(changes.name.trim()));
        arena.keep(object.put('T', nextName));
      }
      if (changes.label !== undefined) {
        const nextLabel = arena.keep(document.newString(changes.label));
        arena.keep(object.put('TU', nextLabel));
      }
      if (changes.rect !== undefined) widget.setRect([...changes.rect]);
      let flags = widget.getFieldFlags();
      if (changes.required !== undefined) {
        flags = changes.required
          ? flags | mupdf.PDFWidget.FIELD_IS_REQUIRED
          : flags & ~mupdf.PDFWidget.FIELD_IS_REQUIRED;
      }
      if (changes.readOnly !== undefined) {
        flags = changes.readOnly
          ? flags | mupdf.PDFWidget.FIELD_IS_READ_ONLY
          : flags & ~mupdf.PDFWidget.FIELD_IS_READ_ONLY;
      }
      if (changes.required !== undefined || changes.readOnly !== undefined) {
        arena.keep(object.put('Ff', flags));
      }
      widget.update();
      changed += 1;
    }
    if (changed > 0) page.update();
  }
  if (changed === 0) throw new Error(`The form field "${name}" no longer exists.`);
}

export function updateFormFields(
  arena: Arena,
  document: mupdf.PDFDocument,
  updates: readonly {
    readonly name: string;
    readonly changes: EngineTypes['FormFieldUpdate'];
  }[],
): void {
  if (updates.length === 0) throw new Error('Select at least one form field to arrange.');
  for (const update of updates) updateFormField(arena, document, update.name, update.changes);
}

export function reorderFormFields(
  arena: Arena,
  document: mupdf.PDFDocument,
  names: readonly string[],
): void {
  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new Error('Tab order must contain each named field exactly once.');
  }
  const { form } = acroForm(arena, document);
  const fields = arena.keep(form.get('Fields'));
  const objects = Array.from({ length: fields.length }, (_, index) =>
    arena.keep(fields.get(index)),
  );
  const byName = new Map(objects.map((object) => [fieldName(arena, object), object]));
  const authoredNames = [...byName.keys()].filter(Boolean);
  if (
    names.length !== authoredNames.length ||
    names.some((name) => !byName.has(name)) ||
    authoredNames.some((name) => !names.includes(name))
  ) {
    throw new Error('Tab order must contain every named field exactly once.');
  }
  const reordered = arena.keep(document.newArray());
  for (const name of names) {
    const object = byName.get(name);
    if (object) arena.keep(reordered.push(object));
  }
  for (const object of objects) {
    if (!fieldName(arena, object)) arena.keep(reordered.push(object));
  }
  arena.keep(form.put('Fields', reordered));

  const rank = new Map(names.map((name, index) => [name, index]));
  for (let pageIndex = 0; pageIndex < document.countPages(); pageIndex += 1) {
    const pageObject = arena.keep(document.findPage(pageIndex));
    const annotations = arena.keep(pageObject.get('Annots'));
    if (!annotations.isArray()) continue;
    const items = Array.from({ length: annotations.length }, (_, index) => ({
      index,
      object: arena.keep(annotations.get(index)),
    }));
    items.sort((left, right) => {
      const leftRank = rank.get(objectName(arena, left.object));
      const rightRank = rank.get(objectName(arena, right.object));
      if (leftRank === undefined && rightRank === undefined) return left.index - right.index;
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      return leftRank - rightRank;
    });
    const orderedAnnotations = arena.keep(document.newArray());
    for (const item of items) arena.keep(orderedAnnotations.push(item.object));
    arena.keep(pageObject.put('Annots', orderedAnnotations));
    const annotationOrder = arena.keep(document.newName('A'));
    arena.keep(pageObject.put('Tabs', annotationOrder));
    const page = arena.keep(document.loadPage(pageIndex));
    page.update();
  }
}

export function resetForm(arena: Arena, document: mupdf.PDFDocument): void {
  const trailer = arena.keep(document.getTrailer());
  const fields = arena.keep(trailer.get('Root', 'AcroForm', 'Fields'));
  if (!fields.isArray() || fields.length === 0) {
    throw new Error('This document has no AcroForm fields to reset.');
  }
  document.resetForm(fields, false);
}

export function projectedFieldValueBytes(name: string, value: string | boolean): number {
  return 4_096 + new TextEncoder().encode(`${name}${String(value)}`).byteLength * 4;
}

export function projectedFormFieldBytes(input: EngineTypes['FormFieldInput']): number {
  return (
    16_384 +
    new TextEncoder().encode(
      `${input.name}${input.label ?? ''}${input.options?.join('') ?? ''}`,
    ).byteLength *
      4
  );
}

export function projectedJavaScriptBytes(input: JavaScriptActionInput): number {
  return (
    16_384 +
    new TextEncoder().encode(`${input.scope}${input.name}${input.trigger ?? ''}${input.source}`)
      .byteLength *
      4
  );
}

export default {
  createFormField,
  countJavaScriptActions,
  deleteJavaScriptAction,
  disableDocumentScriptsForEvaluation,
  listJavaScriptActions,
  listFields,
  projectedFieldValueBytes,
  projectedFormFieldBytes,
  projectedJavaScriptBytes,
  reorderFormFields,
  resetForm,
  setJavaScriptAction,
  setFieldValue,
  setFieldValues,
  updateFormField,
  updateFormFields,
};
