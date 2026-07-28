// @vitest-environment jsdom

import formData from '../lib/text/fdf';
import type { EngineTypes } from '../lib/engine/port';

const fields: readonly EngineTypes['FormFieldInfo'][] = [
  {
    id: 1,
    pageIndex: 0,
    name: 'full_name',
    label: 'Full name',
    type: 'Text',
    value: 'Ada, "Countess"',
    readOnly: false,
    required: true,
    multiline: false,
    password: false,
    options: [],
    rect: [0, 0, 100, 20],
  },
];

describe('FORM-025/FORM-026 form-data interchange', () => {
  for (const format of ['fdf', 'xfdf', 'xml', 'csv'] as const) {
    it(`round-trips ${format.toUpperCase()} without executing imported content`, () => {
      const exported = formData.exportFormData(format, fields);
      expect(formData.parseFormData(format, exported, ['full_name'])).toEqual({
        full_name: 'Ada, "Countess"',
      });
    });
  }

  it('rejects unknown fields rather than applying a lossy approximation', () => {
    expect(() =>
      formData.parseFormData(
        'xfdf',
        '<xfdf><fields><field name="unknown"><value>x</value></field></fields></xfdf>',
        ['full_name'],
      ),
    ).toThrow('fields that do not exist: unknown');
  });
});
