import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, TestTube2, Upload } from 'lucide-react';
import { assertFileSize, budgetFor } from '@/lib/core/limits';
import type { EngineTypes } from '@/lib/engine/port';
import formCapabilities from '@/lib/forms/capabilities';
import { useToolStore } from '@/lib/store/tools';
import formData, { type FormDataFormat } from '@/lib/text/fdf';
import ActiveTextEntry from '../ActiveTextEntry';
import { DesignedCheckbox, DesignedDisclosure, DesignedSelect } from '../DesignedControls';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

type FormField = EngineTypes['FormFieldInfo'];
type FormFieldType = EngineTypes['FormFieldType'];

function downloadText(name: string, type: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function uniqueNames(fields: readonly FormField[]): string[] {
  return [...new Set(fields.map((field) => field.name).filter(Boolean))];
}

export default function PrepareForm({
  engine,
  onMutation,
  onNavigate,
  onError,
  onNotice,
}: Pick<ToolPanelProps, 'engine' | 'onMutation' | 'onNavigate' | 'onError' | 'onNotice'>) {
  const [fields, setFields] = useState<readonly FormField[]>([]);
  const [selected, setSelected] = useState('');
  const [layoutSelection, setLayoutSelection] = useState<readonly string[]>([]);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'tab' | 'name' | 'type' | 'page'>('tab');
  const [tabOrder, setTabOrder] = useState<readonly string[]>([]);
  const [editingValue, setEditingValue] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testValues, setTestValues] = useState<Readonly<Record<string, string | boolean>>>({});
  const [highlightFields, setHighlightFields] = useState(true);
  const [format, setFormat] = useState<FormDataFormat>('xfdf');
  const [creating, setCreating] = useState(false);
  const [fieldType, setFieldType] = useState<FormFieldType>('text');
  const [fieldName, setFieldName] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldPage, setFieldPage] = useState(0);
  const [fieldOptions, setFieldOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [password, setPassword] = useState(false);
  const [comb, setComb] = useState(false);
  const [editable, setEditable] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [rect, setRect] = useState({ x: 72, y: 96, width: 216, height: 32 });
  const [javaScript, setJavaScript] = useState<EngineTypes['JavaScriptState'] | null>(null);
  const [scriptScope, setScriptScope] = useState<'document' | 'field'>('field');
  const [scriptName, setScriptName] = useState('');
  const [scriptTrigger, setScriptTrigger] =
    useState<EngineTypes['JavaScriptTrigger']>('validate');
  const [scriptSource, setScriptSource] = useState('event.rc = event.value.length > 0;');
  const [savingScript, setSavingScript] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const setFormOverlay = useToolStore((state) => state.setFormOverlay);

  const load = useCallback(() => {
    void engine
      .listFields()
      .then((nextFields) => {
        setFields(nextFields);
        setTabOrder((current) => {
          const names = uniqueNames(nextFields);
          return current.length === names.length &&
            current.every((name) => names.includes(name))
            ? current
            : names;
        });
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown form error.';
        onError(`Loading form fields failed. ${detail}`);
      });
  }, [engine, onError]);

  const loadJavaScript = useCallback(() => {
    void engine
      .getJavaScriptState()
      .then(setJavaScript)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown JavaScript error.';
        onError(`Loading form JavaScript failed. ${detail}`);
      });
  }, [engine, onError]);

  useEffect(() => {
    load();
    loadJavaScript();
  }, [load, loadJavaScript]);

  useEffect(() => {
    setFormOverlay(fields, highlightFields);
    return () => setFormOverlay([], false);
  }, [fields, highlightFields, setFormOverlay]);

  useEffect(() => {
    const selectClickedField = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly name?: string }>).detail;
      if (detail?.name && fields.some((field) => field.name === detail.name)) {
        setSelected(detail.name);
      }
    };
    document.addEventListener('pdf-form-field-click', selectClickedField);
    return () => document.removeEventListener('pdf-form-field-click', selectClickedField);
  }, [fields]);

  const selectedField = fields.find((field) => field.name === selected);
  const selectedOptions = useMemo(
    () => formCapabilities.fieldOptions(fields, selected),
    [fields, selected],
  );
  const selectedValue =
    selectedField && selectedField.name in testValues
      ? String(testValues[selectedField.name])
      : (selectedField?.value ?? '');
  const selectedLayoutSet = useMemo(() => new Set(layoutSelection), [layoutSelection]);
  const widgetHighlights = useMemo(
    () => formCapabilities.formWidgetHighlights(fields),
    [fields],
  );

  const visible = useMemo(() => {
    const rank = new Map(tabOrder.map((name, index) => [name, index]));
    const needle = filter.trim().toLocaleLowerCase();
    return [...fields]
      .filter((field) =>
        `${field.name} ${field.label} ${field.type}`.toLocaleLowerCase().includes(needle),
      )
      .sort((left, right) => {
        if (sort === 'tab') return (rank.get(left.name) ?? 0) - (rank.get(right.name) ?? 0);
        if (sort === 'page') return left.pageIndex - right.pageIndex;
        return left[sort].localeCompare(right[sort]);
      });
  }, [fields, filter, sort, tabOrder]);

  const applyValue = (field: FormField, value: string | boolean) => {
    if (testMode) {
      setTestValues((current) => ({ ...current, [field.name]: value }));
      setEditingValue(false);
      return;
    }
    void engine
      .setFieldValue(field.name, value)
      .then((result) => {
        onMutation(result);
        setEditingValue(false);
        load();
        loadJavaScript();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown form error.';
        onError(`Filling "${field.name}" failed. ${detail}`);
      });
  };

  const saveScript = () => {
    const name =
      scriptScope === 'field'
        ? scriptName || selectedField?.name || uniqueNames(fields)[0] || ''
        : scriptName;
    const input: EngineTypes['JavaScriptActionInput'] = {
      scope: scriptScope,
      name,
      source: scriptSource,
      ...(scriptScope === 'field' ? { trigger: scriptTrigger } : {}),
    };
    setSavingScript(true);
    void engine
      .setJavaScriptAction(input)
      .then((result) => {
        onMutation(result);
        loadJavaScript();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown JavaScript error.';
        onError(`Saving the JavaScript action failed. ${detail}`);
      })
      .finally(() => setSavingScript(false));
  };

  const createField = () => {
    const page = engine.info.pages[fieldPage];
    if (!page) {
      onError('Choose a page for the new field.');
      return;
    }
    const fieldRect: EngineTypes['PdfRect'] = [
      page.bounds[0] + rect.x,
      page.bounds[1] + rect.y,
      page.bounds[0] + rect.x + rect.width,
      page.bounds[1] + rect.y + rect.height,
    ];
    const input: EngineTypes['FormFieldInput'] = {
      pageIndex: fieldPage,
      name: fieldName,
      label: fieldLabel,
      type: fieldType,
      rect: fieldRect,
      required,
      readOnly,
      multiline,
      password,
      comb,
      editable,
      multiple,
      ...(fieldType === 'combo' || fieldType === 'list'
        ? {
            options: fieldOptions
              .split(',')
              .map((option) => option.trim())
              .filter(Boolean),
          }
        : {}),
    };
    setCreating(true);
    void engine
      .createFormField(input)
      .then((result) => {
        onMutation(result);
        setFieldName('');
        setFieldLabel('');
        load();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown form authoring error.';
        const rc4Disclosure = engine.info.encryption?.disclosure;
        onError(
          engine.info.encryption?.algorithm === 'rc4' && rc4Disclosure
            ? `Creating the form field failed. ${rc4Disclosure}`
            : `Creating the form field failed. ${detail}`,
        );
      })
      .finally(() => setCreating(false));
  };

  const updateSelectedGeometry = () => {
    if (!selectedField) return;
    const page = engine.info.pages[selectedField.pageIndex];
    if (!page) return;
    void engine
      .updateFormField(selectedField.name, {
        label: fieldLabel || selectedField.label,
        required,
        readOnly,
        rect: [
          page.bounds[0] + rect.x,
          page.bounds[1] + rect.y,
          page.bounds[0] + rect.x + rect.width,
          page.bounds[1] + rect.y + rect.height,
        ],
      })
      .then((result) => {
        onMutation(result);
        load();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown form authoring error.';
        onError(`Updating "${selectedField.name}" failed. ${detail}`);
      });
  };

  const arrangeFields = (mode: 'left' | 'vertical') => {
    const selectedFields = fields.filter((field) => selectedLayoutSet.has(field.name));
    if (selectedFields.length < (mode === 'vertical' ? 3 : 2)) return;
    if (new Set(selectedFields.map((field) => field.pageIndex)).size !== 1) {
      onError('Align and distribute fields only when the selected fields share one page.');
      return;
    }
    let updates: readonly {
      readonly name: string;
      readonly changes: EngineTypes['FormFieldUpdate'];
    }[];
    if (mode === 'left') {
      const left = Math.min(...selectedFields.map((field) => field.rect[0]));
      updates = selectedFields.map((field) => ({
        name: field.name,
        changes: {
          rect: [left, field.rect[1], left + (field.rect[2] - field.rect[0]), field.rect[3]],
        },
      }));
    } else {
      const ordered = [...selectedFields].sort((left, right) => left.rect[1] - right.rect[1]);
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      if (!first || !last) return;
      const step = (last.rect[1] - first.rect[1]) / (ordered.length - 1);
      updates = ordered.map((field, index) => {
        const top = first.rect[1] + step * index;
        return {
          name: field.name,
          changes: {
            rect: [field.rect[0], top, field.rect[2], top + (field.rect[3] - field.rect[1])],
          },
        };
      });
    }
    void engine
      .updateFormFields(updates)
      .then((result) => {
        onMutation(result);
        load();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown form layout error.';
        onError(`Arranging form fields failed. ${detail}`);
      });
  };

  const importValues = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      assertFileSize(file.size, budgetFor(navigator));
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'The form-data file is too large.';
      onError(`Importing form data failed. ${detail}`);
      return;
    }
    void file
      .text()
      .then((text) => formData.parseFormData(format, text, uniqueNames(fields)))
      .then((values) => {
        if (testMode) {
          setTestValues(values);
          return undefined;
        }
        return engine.setFieldValues(values).then((result) => {
          onMutation(result);
          load();
        });
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown form-data error.';
        onError(`Importing form data failed. ${detail}`);
      });
  };

  const validateRequired = (): boolean => {
    const failures = formCapabilities.requiredFieldFailures(fields, testValues);
    const first = failures[0];
    if (!first) return true;
    const named = failures.map((failure) => `"${failure.label}"`).join(', ');
    setSelected(first.name);
    onNavigate(first.pageIndex);
    onError(
      `Required-field validation blocked this action. Complete ${named} before continuing.`,
    );
    return false;
  };

  return (
    <section
      className="tool-panel"
      aria-label="Prepare form"
      data-form-widget-highlights={JSON.stringify(widgetHighlights)}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">AcroForm</span>
          <h2>Forms</h2>
        </div>
        <FeatureBadge status="DEGRADED" />
      </div>

      <p className="warning-card" role="status">
        DEGRADED: saved form values can be entered only by selecting a field in the list below
        and choosing Edit field value or Toggle field. Clicking a field on the PDF page is not
        wired to the editor.
      </p>

      <div className="form-mode-bar">
        <button
          type="button"
          aria-pressed={testMode}
          onClick={() => {
            setTestMode((value) => !value);
            setTestValues({});
          }}
        >
          <TestTube2 aria-hidden="true" size={16} /> {testMode ? 'Exit test mode' : 'Test form'}
        </button>
        <button
          type="button"
          aria-pressed={highlightFields}
          onClick={() => setHighlightFields((value) => !value)}
        >
          Highlight fields
        </button>
      </div>
      {testMode ? (
        <p className="warning-card" role="status">
          Test values are isolated in memory. They do not enter undo history, recovery storage,
          export, or saved PDF output.
        </p>
      ) : null}

      <DesignedDisclosure
        className="form-authoring"
        defaultOpen={fields.length === 0}
        title={
          <>
            <Plus aria-hidden="true" size={16} /> Add a field
          </>
        }
      >
        <div className="property-grid">
          <label>
            <span>Field type</span>
            <DesignedSelect
              label="Field type"
              value={fieldType}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'checkbox', label: 'Check box' },
                { value: 'radio', label: 'Radio button' },
                { value: 'combo', label: 'Dropdown' },
                { value: 'list', label: 'List box' },
                { value: 'button', label: 'Button' },
                { value: 'signature', label: 'Signature field' },
              ]}
              onValueChange={setFieldType}
            />
          </label>
          <label>
            <span>Unique name</span>
            <input value={fieldName} onChange={(event) => setFieldName(event.target.value)} />
          </label>
          <label>
            <span>Accessible label</span>
            <input value={fieldLabel} onChange={(event) => setFieldLabel(event.target.value)} />
          </label>
          <label>
            <span>Page</span>
            <DesignedSelect
              label="Field page"
              value={String(fieldPage)}
              options={engine.info.pages.map((page) => ({
                value: String(page.index),
                label: page.label,
              }))}
              onValueChange={(value) => setFieldPage(Number(value))}
            />
          </label>
          {(fieldType === 'combo' || fieldType === 'list') && (
            <label>
              <span>Options, comma separated</span>
              <input
                value={fieldOptions}
                onChange={(event) => setFieldOptions(event.target.value)}
              />
            </label>
          )}
          {(['x', 'y', 'width', 'height'] as const).map((dimension) => (
            <label key={dimension}>
              <span>{dimension.toLocaleUpperCase()} (pt)</span>
              <input
                type="number"
                min={dimension === 'width' || dimension === 'height' ? 1 : 0}
                value={rect[dimension]}
                onChange={(event) =>
                  setRect((current) => ({
                    ...current,
                    [dimension]: Number(event.target.value),
                  }))
                }
              />
            </label>
          ))}
          <DesignedCheckbox label="Required" checked={required} onCheckedChange={setRequired} />
          <DesignedCheckbox
            label="Read-only"
            checked={readOnly}
            onCheckedChange={setReadOnly}
          />
          {fieldType === 'text' ? (
            <>
              <DesignedCheckbox
                label="Multiline"
                checked={multiline}
                onCheckedChange={setMultiline}
              />
              <DesignedCheckbox
                label="Password"
                checked={password}
                onCheckedChange={setPassword}
              />
              <DesignedCheckbox label="Comb" checked={comb} onCheckedChange={setComb} />
            </>
          ) : null}
          {fieldType === 'combo' ? (
            <DesignedCheckbox
              label="Editable dropdown"
              checked={editable}
              onCheckedChange={setEditable}
            />
          ) : null}
          {fieldType === 'list' ? (
            <DesignedCheckbox
              label="Multiple selection"
              checked={multiple}
              onCheckedChange={setMultiple}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={creating || !fieldName.trim()}
          aria-describedby="form-create-help"
          onClick={createField}
        >
          {creating ? 'Creating…' : 'Create field'}
        </button>
        <p id="form-create-help" className="scope-note">
          Give the field a unique name before creating it.
        </p>
      </DesignedDisclosure>

      <div className="table-controls">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter form fields"
          placeholder="Filter fields"
        />
        <label>
          <span>Sort</span>
          <DesignedSelect
            label="Sort form fields"
            value={sort}
            options={[
              { value: 'tab', label: 'Tab order' },
              { value: 'name', label: 'Name' },
              { value: 'type', label: 'Type' },
              { value: 'page', label: 'Page' },
            ]}
            onValueChange={setSort}
          />
        </label>
      </div>

      {fields.length > 0 ? (
        <>
          <div className="data-table-scroll">
            <table className={`data-table${highlightFields ? ' highlight-fields' : ''}`}>
              <thead>
                <tr>
                  <th scope="col">Arrange</th>
                  <th scope="col">Tab</th>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Page</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((field) => (
                  <tr key={`${field.pageIndex}-${field.id}`}>
                    <td>
                      <DesignedCheckbox
                        label={<span className="sr-only">Select {field.name} for layout</span>}
                        checked={selectedLayoutSet.has(field.name)}
                        onCheckedChange={(checked) =>
                          setLayoutSelection((current) =>
                            checked
                              ? [...new Set([...current, field.name])]
                              : current.filter((name) => name !== field.name),
                          )
                        }
                      />
                    </td>
                    <td>{tabOrder.indexOf(field.name) + 1}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(field.name);
                          setFieldLabel(field.label);
                          setRequired(field.required);
                          setReadOnly(field.readOnly);
                          const page = engine.info.pages[field.pageIndex];
                          if (page) {
                            setRect({
                              x: field.rect[0] - page.bounds[0],
                              y: field.rect[1] - page.bounds[1],
                              width: field.rect[2] - field.rect[0],
                              height: field.rect[3] - field.rect[1],
                            });
                          }
                          onNavigate(field.pageIndex);
                        }}
                      >
                        {field.name || field.label || 'Unnamed field'}
                      </button>
                    </td>
                    <td>{field.type}</td>
                    <td>{engine.info.pages[field.pageIndex]?.label ?? field.pageIndex + 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedField ? (
            <div className="field-editor">
              <strong>{selectedField.name}</strong>
              <span id="selected-field-access">
                {selectedField.required ? 'Required' : 'Optional'} ·{' '}
                {selectedField.readOnly ? 'Read-only' : 'Editable'}
              </span>
              {['check-box', 'checkbox'].includes(selectedField.type.toLocaleLowerCase()) ? (
                <button
                  type="button"
                  disabled={selectedField.readOnly}
                  aria-describedby="selected-field-access"
                  onClick={() => applyValue(selectedField, selectedValue === 'Off')}
                >
                  Toggle field
                </button>
              ) : ['radio-button', 'radiobutton'].includes(
                  selectedField.type.toLocaleLowerCase(),
                ) ? (
                selectedOptions.length > 0 ? (
                  <label>
                    <span>Selected option</span>
                    <select
                      value={selectedValue}
                      disabled={selectedField.readOnly}
                      onChange={(event) => applyValue(selectedField, event.target.value)}
                    >
                      <option value="Off">No selection</option>
                      {selectedOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <button
                    type="button"
                    disabled={selectedField.readOnly}
                    onClick={() => applyValue(selectedField, selectedValue === 'Off')}
                  >
                    Toggle radio field
                  </button>
                )
              ) : ['push-button', 'pushbutton', 'signature'].includes(
                  selectedField.type.toLocaleLowerCase(),
                ) ? (
                <p className="scope-note">
                  {selectedField.type.toLocaleLowerCase() === 'signature'
                    ? 'Unsigned signature field. Signing is not performed from form filling.'
                    : 'This button has no action authored here and does not submit anything.'}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={selectedField.readOnly}
                  aria-describedby="selected-field-access"
                  onClick={() => setEditingValue(true)}
                >
                  Edit field value
                </button>
              )}
              <button type="button" onClick={updateSelectedGeometry}>
                Apply position, size & properties
              </button>
            </div>
          ) : null}

          {editingValue && selectedField ? (
            <ActiveTextEntry
              kind="form-field"
              label={`Value for ${selectedField.name}`}
              initialValue={selectedValue}
              onCommit={(value) => applyValue(selectedField, value)}
              onCancel={() => setEditingValue(false)}
            />
          ) : null}

          <div className="form-layout-actions">
            <button
              type="button"
              disabled={layoutSelection.length < 2}
              aria-describedby="form-layout-help"
              onClick={() => arrangeFields('left')}
            >
              Align left
            </button>
            <button
              type="button"
              disabled={layoutSelection.length < 3}
              aria-describedby="form-layout-help"
              onClick={() => arrangeFields('vertical')}
            >
              Distribute vertically
            </button>
          </div>
          <p id="form-layout-help" className="scope-note">
            Select at least two fields to align them and at least three to distribute them.
          </p>

          <DesignedDisclosure className="tab-order-editor" title="Numbered tab-order path">
            <p id="tab-order-help" className="scope-note">
              The first field cannot move earlier and the last field cannot move later.
            </p>
            <ol>
              {tabOrder.map((name, index) => (
                <li key={name}>
                  <span>{name}</span>
                  <button
                    type="button"
                    aria-label={`Move ${name} earlier`}
                    disabled={index === 0}
                    aria-describedby="tab-order-help"
                    onClick={() =>
                      setTabOrder((current) => {
                        const next = [...current];
                        const [item] = next.splice(index, 1);
                        if (item !== undefined) next.splice(index - 1, 0, item);
                        return next;
                      })
                    }
                  >
                    <ArrowUp aria-hidden="true" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${name} later`}
                    disabled={index === tabOrder.length - 1}
                    aria-describedby="tab-order-help"
                    onClick={() =>
                      setTabOrder((current) => {
                        const next = [...current];
                        const [item] = next.splice(index, 1);
                        if (item !== undefined) next.splice(index + 1, 0, item);
                        return next;
                      })
                    }
                  >
                    <ArrowDown aria-hidden="true" size={14} />
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => {
                void engine
                  .reorderFormFields(tabOrder)
                  .then((result) => {
                    onMutation(result);
                    load();
                  })
                  .catch((error: unknown) => {
                    const detail =
                      error instanceof Error ? error.message : 'Unknown tab-order error.';
                    onError(`Updating the tab order failed. ${detail}`);
                  });
              }}
            >
              Apply tab order
            </button>
          </DesignedDisclosure>

          <div className="panel-actions">
            <button
              type="button"
              onClick={() => {
                if (validateRequired())
                  onNotice('Form validation complete. Every required field has a value.');
              }}
            >
              Validate required fields
            </button>
            <button
              type="button"
              onClick={() => {
                if (testMode) {
                  setTestValues({});
                  return;
                }
                void engine
                  .resetForm()
                  .then((result) => {
                    onMutation(result);
                    load();
                  })
                  .catch((error: unknown) => {
                    const detail =
                      error instanceof Error ? error.message : 'Unknown form error.';
                    onError(`Resetting the form failed. ${detail}`);
                  });
              }}
            >
              Reset form
            </button>
          </div>

          <fieldset className="workflow-group">
            <legend>Form data</legend>
            <label>
              <span>Format</span>
              <DesignedSelect
                label="Form data format"
                value={format}
                options={[
                  { value: 'fdf', label: 'FDF' },
                  { value: 'xfdf', label: 'XFDF' },
                  { value: 'xml', label: 'XML' },
                  { value: 'csv', label: 'CSV' },
                ]}
                onValueChange={setFormat}
              />
            </label>
            <div className="panel-actions">
              <button
                type="button"
                onClick={() => {
                  if (!validateRequired()) return;
                  const mime = format === 'csv' ? 'text/csv' : 'application/xml';
                  downloadText(
                    `${engine.info.name.replace(/\.pdf$/i, '')}.${format}`,
                    mime,
                    formData.exportFormData(format, fields),
                  );
                }}
              >
                <Download aria-hidden="true" size={15} /> Export {format.toLocaleUpperCase()}
              </button>
              <button type="button" onClick={() => importInput.current?.click()}>
                <Upload aria-hidden="true" size={15} /> Import {format.toLocaleUpperCase()}
              </button>
            </div>
            <p className="scope-note">
              Imported data is previewed by format and can only set known field names. Actions,
              scripts, external references, and submit targets are never executed.
            </p>
            <input
              ref={importInput}
              hidden
              type="file"
              aria-label={`Import ${format.toLocaleUpperCase()} form data`}
              onChange={importValues}
            />
          </fieldset>
        </>
      ) : (
        <p className="empty-message">
          This document has no AcroForm fields. Use “Add a field” to create an interoperable
          text, choice, button, check, radio, or signature field.
        </p>
      )}

      <DesignedDisclosure
        className="workflow-group"
        title={
          <>
            Form and document JavaScript <FeatureBadge status="LOCAL" />
          </>
        }
      >
        <p className="scope-note">
          Scripts run inside the document worker with MuJS limits. Alerts and requests to open
          URLs, print, submit, email, or invoke menu commands are recorded below and never
          performed by the browser.
        </p>
        <div className="property-grid">
          <label>
            <span>Script scope</span>
            <DesignedSelect
              label="Script scope"
              value={scriptScope}
              options={[
                { value: 'field', label: 'Form field event' },
                { value: 'document', label: 'Document-level script' },
              ]}
              onValueChange={(scope) => {
                setScriptScope(scope);
                setScriptName(scope === 'field' ? (selectedField?.name ?? '') : '');
              }}
            />
          </label>
          {scriptScope === 'field' ? (
            <>
              <label>
                <span>Field</span>
                <DesignedSelect
                  label="Script field"
                  value={scriptName}
                  options={[
                    { value: '', label: 'Choose field' },
                    ...uniqueNames(fields).map((name) => ({ value: name, label: name })),
                  ]}
                  onValueChange={setScriptName}
                />
              </label>
              <label>
                <span>Event</span>
                <DesignedSelect
                  label="Script event"
                  value={scriptTrigger}
                  options={[
                    { value: 'keystroke', label: 'Keystroke' },
                    { value: 'validate', label: 'Validate' },
                    { value: 'calculate', label: 'Calculate' },
                    { value: 'format', label: 'Format' },
                  ]}
                  onValueChange={setScriptTrigger}
                />
              </label>
            </>
          ) : (
            <label>
              <span>Script name</span>
              <input
                value={scriptName}
                onChange={(event) => setScriptName(event.target.value)}
                placeholder="Document calculations"
              />
            </label>
          )}
        </div>
        <label>
          <span>JavaScript source</span>
          <textarea
            rows={7}
            value={scriptSource}
            spellCheck={false}
            onChange={(event) => setScriptSource(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary-action"
          disabled={
            savingScript ||
            !scriptSource.trim() ||
            !(scriptName || (scriptScope === 'field' && selectedField?.name))
          }
          aria-describedby="script-save-help"
          onClick={saveScript}
        >
          {savingScript ? 'Saving…' : 'Save JavaScript action'}
        </button>
        <p id="script-save-help" className="scope-note">
          Choose a target, provide a name when needed, and enter JavaScript before saving.
        </p>
        {javaScript?.scripts.length ? (
          <ul className="script-list">
            {javaScript.scripts.map((script) => (
              <li key={script.id}>
                <button
                  type="button"
                  onClick={() => {
                    setScriptScope(script.scope);
                    setScriptName(script.fieldName ?? script.name);
                    if (script.trigger) setScriptTrigger(script.trigger);
                    setScriptSource(script.source);
                  }}
                >
                  <strong>{script.name}</strong>
                  <span>{script.scope === 'document' ? 'Document' : 'Field action'}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${script.name}`}
                  onClick={() => {
                    void engine
                      .deleteJavaScriptAction({
                        scope: script.scope,
                        name: script.fieldName ?? script.name,
                        ...(script.trigger ? { trigger: script.trigger } : {}),
                      })
                      .then((result) => {
                        onMutation(result);
                        loadJavaScript();
                      })
                      .catch((error: unknown) => {
                        const detail =
                          error instanceof Error ? error.message : 'Unknown JavaScript error.';
                        onError(`Removing "${script.name}" failed. ${detail}`);
                      });
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-message">No document or field JavaScript actions are authored.</p>
        )}
        {javaScript?.events.length ? (
          <div className="result-preview" role="status">
            <strong>Observed JavaScript events</strong>
            <ul>
              {javaScript.events.slice(-8).map((event, index) => (
                <li key={`${event.type}-${index}`}>
                  {event.type}: {event.detail} {event.blocked ? 'Blocked.' : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DesignedDisclosure>

      <p className="scope-note">
        Barcode fields are unavailable: no independently decodable encoder is bundled. Automatic
        field detection remains proposal-only until page text geometry is exposed by the engine.
        Form-history storage remains off: persistent history needs a document-scoped engine
        identity so values cannot cross document boundaries. <FeatureBadge status="LOCAL" />{' '}
        Keystroke, validate, calculate, format, and document-level JavaScript run locally with
        observable blocked side effects.
      </p>
      <p className="scope-note">
        <FeatureBadge status="EXCLUDED" /> Requesting e-signatures and LiveCycle or AEM rights
        management are hosted workflows and are not available. Signature fields remain ordinary
        local PDF form fields.
      </p>
    </section>
  );
}
