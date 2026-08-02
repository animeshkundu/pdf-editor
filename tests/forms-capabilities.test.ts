import formCapabilities from '../lib/forms/capabilities';
import { FormHistory, type FormHistoryStorage } from '../lib/store/form-history';
import type { EngineTypes } from '../lib/engine/port';

const fields: readonly EngineTypes['FormFieldInfo'][] = [
  {
    id: 1,
    pageIndex: 2,
    name: 'name',
    label: 'Full name',
    type: 'Text',
    value: '',
    readOnly: false,
    required: true,
    multiline: false,
    password: false,
    options: [],
    rect: [10, 20, 110, 40],
  },
  {
    id: 2,
    pageIndex: 2,
    name: 'consent',
    label: 'Consent',
    type: 'CheckBox',
    value: 'Off',
    readOnly: false,
    required: true,
    multiline: false,
    password: false,
    options: [],
    rect: [120, 20, 140, 40],
  },
];

class MemoryStorage implements FormHistoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('FORM-011/FORM-012 form functional helpers', () => {
  it('provides page-widget canvas geometry without a DOM text overlay', () => {
    expect(formCapabilities.formWidgetHighlights(fields)).toEqual([
      {
        pageIndex: 2,
        rect: [10, 20, 110, 40],
        label: 'Full name',
        type: 'Text',
        required: true,
      },
      {
        pageIndex: 2,
        rect: [120, 20, 140, 40],
        label: 'Consent',
        type: 'CheckBox',
        required: true,
      },
    ]);
  });

  it('identifies every required field that blocks a form-data export', () => {
    expect(formCapabilities.requiredFieldFailures(fields)).toEqual([
      { name: 'name', label: 'Full name', pageIndex: 2 },
      { name: 'consent', label: 'Consent', pageIndex: 2 },
    ]);
    expect(
      formCapabilities.requiredFieldFailures(fields, { name: 'Ada Lovelace', consent: true }),
    ).toEqual([]);
  });

  it('unions export values across every widget in a radio group', () => {
    const radioWidgets = ['Red', 'Green', 'Blue'].map(
      (option, index): EngineTypes['FormFieldInfo'] => ({
        id: index + 10,
        pageIndex: 0,
        name: 'Color',
        label: 'Color',
        type: 'RadioButton',
        value: 'Off',
        readOnly: false,
        required: false,
        multiline: false,
        password: false,
        options: [option],
        rect: [index * 20, 0, index * 20 + 10, 10],
      }),
    );
    expect(formCapabilities.fieldOptions(radioWidgets, 'Color')).toEqual([
      'Red',
      'Green',
      'Blue',
    ]);
  });
});

describe('FORM-013 consented document-scoped history', () => {
  it('is disabled by default, never crosses document identities, and is clearable', () => {
    const storage = new MemoryStorage();
    const first = new FormHistory({ documentId: 'document-a', storage });
    const second = new FormHistory({ documentId: 'document-b', storage });

    first.remember('name', 'Ada');
    expect(first.suggestions('name')).toEqual([]);

    first.setEnabled(true);
    first.remember('name', 'Ada');
    first.remember('name', 'Grace');
    expect(first.suggestions('name')).toEqual(['Grace', 'Ada']);
    second.setEnabled(true);
    expect(second.suggestions('name')).toEqual([]);

    first.clear();
    expect(first.suggestions('name')).toEqual([]);
  });
});

describe('FORM-023 labelled proposal fixture', () => {
  // Fixture labels are the accepted ground truth; proposals remain data, never mutations.
  const fixture = [
    {
      id: 'name',
      label: 'Full name',
      rect: [10, 10, 180, 34] as const,
      type: 'text' as const,
      confidence: 0.96,
      expected: true,
    },
    {
      id: 'consent',
      label: 'I agree',
      rect: [10, 50, 28, 68] as const,
      type: 'checkbox' as const,
      confidence: 0.91,
      expected: true,
    },
    {
      id: 'heading-rule',
      label: 'Personal details',
      rect: [10, 80, 220, 82] as const,
      type: 'text' as const,
      confidence: 0.31,
      expected: false,
    },
  ];

  it('meets the stated 0.90 precision and recall floor without auto-applying', () => {
    const proposals = formCapabilities.proposeFormFields(fixture);
    expect(proposals).toEqual([
      expect.objectContaining({ id: 'name', proposalOnly: true, name: 'full_name' }),
      expect.objectContaining({ id: 'consent', proposalOnly: true, name: 'i_agree' }),
    ]);
    const score = formCapabilities.detectionScore(
      proposals.map((proposal) => proposal.id),
      fixture.filter((candidate) => candidate.expected).map((candidate) => candidate.id),
    );
    expect(score.precision).toBeGreaterThanOrEqual(0.9);
    expect(score.recall).toBeGreaterThanOrEqual(0.9);
  });
});
