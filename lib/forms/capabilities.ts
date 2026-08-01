import type { EngineTypes } from '../engine/port';

export interface RequiredFieldFailure {
  readonly name: string;
  readonly label: string;
  readonly pageIndex: number;
}

export interface FormWidgetHighlight {
  readonly pageIndex: number;
  readonly rect: EngineTypes['PdfRect'];
  readonly label: string;
  readonly type: string;
  readonly required: boolean;
}

export interface DetectedFormCandidate {
  readonly id: string;
  readonly label: string;
  readonly rect: EngineTypes['PdfRect'];
  readonly type: 'text' | 'checkbox';
  readonly confidence: number;
}

export interface ProposedFormField extends DetectedFormCandidate {
  readonly proposalOnly: true;
  readonly name: string;
}

export interface DetectionScore {
  readonly precision: number;
  readonly recall: number;
}

type FormField = EngineTypes['FormFieldInfo'];

function hasValue(value: string | boolean | undefined): boolean {
  return typeof value === 'boolean' ? value : Boolean(value?.trim() && value !== 'Off');
}

function proposalName(label: string, fallback: string): string {
  const normalized = label
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

/** Canvas-ready geometry. Rendering is intentionally left to the page canvas owner. */
export function formWidgetHighlights(fields: readonly FormField[]): FormWidgetHighlight[] {
  return fields.map((field) => ({
    pageIndex: field.pageIndex,
    rect: field.rect,
    label: field.label || field.name || 'Unnamed field',
    type: field.type,
    required: field.required,
  }));
}

export function requiredFieldFailures(
  fields: readonly FormField[],
  values: Readonly<Record<string, string | boolean>> = {},
): RequiredFieldFailure[] {
  return fields
    .filter((field) => field.required)
    .filter((field) => !hasValue(values[field.name] ?? field.value))
    .map((field) => ({
      name: field.name || field.label || 'Unnamed field',
      label: field.label || field.name || 'Unnamed field',
      pageIndex: field.pageIndex,
    }));
}

export function fieldOptions(fields: readonly FormField[], name: string): string[] {
  return [
    ...new Set(fields.filter((field) => field.name === name).flatMap((field) => field.options)),
  ];
}

/**
 * Deliberately returns proposals, not mutation inputs. A caller must explicitly accept a
 * proposal before it can reach createFormField.
 */
export function proposeFormFields(
  candidates: readonly DetectedFormCandidate[],
  minimumConfidence = 0.8,
): ProposedFormField[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.confidence >= minimumConfidence &&
        candidate.label.trim().length > 0 &&
        candidate.rect.every(Number.isFinite) &&
        candidate.rect[2] > candidate.rect[0] &&
        candidate.rect[3] > candidate.rect[1],
    )
    .map((candidate) => ({
      ...candidate,
      proposalOnly: true,
      name: proposalName(candidate.label, `proposal_${candidate.id}`),
    }));
}

export function detectionScore(
  proposedIds: readonly string[],
  expectedIds: readonly string[],
): DetectionScore {
  const proposed = new Set(proposedIds);
  const expected = new Set(expectedIds);
  let truePositives = 0;
  for (const id of proposed) if (expected.has(id)) truePositives += 1;
  return {
    precision: proposed.size === 0 ? 1 : truePositives / proposed.size,
    recall: expected.size === 0 ? 1 : truePositives / expected.size,
  };
}

export default {
  detectionScore,
  fieldOptions,
  formWidgetHighlights,
  proposeFormFields,
  requiredFieldFailures,
};
