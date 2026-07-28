import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowUpRight,
  Circle,
  Cloud,
  Download,
  FileImage,
  Highlighter,
  MessageSquareText,
  Minus,
  Paperclip,
  PenLine,
  Redo2,
  Ruler,
  Save,
  Shapes,
  Stamp,
  Square,
  Strikethrough,
  TextCursorInput,
  Type,
  Underline,
  Upload,
  Waves,
} from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';
import { useDocumentStore } from '@/lib/store/document';
import { useToolStore } from '@/lib/store/tools';
import { viewportStore } from '@/lib/store/viewport';
import ActiveTextEntry from '../ActiveTextEntry';
import FeatureBadge from '../FeatureBadge';
import { describeRedactionOutcome, snapshotRedactionText } from '../redactionOutcome';
import type { ToolPanelProps } from './types';

type AnnotationType = EngineTypes['AnnotationType'];
type AnnotationInput = EngineTypes['AnnotationInput'];
type AnnotationInfo = EngineTypes['AnnotationInfo'];
type MutableAnnotationInput = {
  -readonly [Key in keyof AnnotationInput]: AnnotationInput[Key];
};

interface ToolDefinition {
  readonly id: string;
  readonly type: AnnotationType;
  readonly label: string;
  readonly group: 'Text' | 'Draw' | 'Stamp & attach' | 'Measure' | 'Safety';
  readonly icon: typeof Type;
  readonly status: EngineTypes['FeatureStatus'];
  readonly textEntry?: boolean;
  readonly disclosure?: string;
  readonly variant?:
    | 'arrow'
    | 'callout'
    | 'cloud'
    | 'dynamic-stamp'
    | 'distance'
    | 'perimeter'
    | 'area'
    | 'replace';
}

const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'note',
    type: 'Text',
    label: 'Sticky note',
    group: 'Text',
    icon: MessageSquareText,
    status: 'LOCAL',
  },
  {
    id: 'text-box',
    type: 'FreeText',
    label: 'Text box',
    group: 'Text',
    icon: Type,
    status: 'LOCAL',
    textEntry: true,
  },
  {
    id: 'callout',
    type: 'FreeText',
    label: 'Callout',
    group: 'Text',
    icon: TextCursorInput,
    status: 'LOCAL',
    textEntry: true,
    variant: 'callout',
  },
  {
    id: 'highlight',
    type: 'Highlight',
    label: 'Highlight',
    group: 'Text',
    icon: Highlighter,
    status: 'LOCAL',
  },
  {
    id: 'underline',
    type: 'Underline',
    label: 'Underline',
    group: 'Text',
    icon: Underline,
    status: 'LOCAL',
  },
  {
    id: 'strikeout',
    type: 'StrikeOut',
    label: 'Strikethrough',
    group: 'Text',
    icon: Strikethrough,
    status: 'LOCAL',
  },
  {
    id: 'squiggly',
    type: 'Squiggly',
    label: 'Squiggly',
    group: 'Text',
    icon: Waves,
    status: 'LOCAL',
  },
  {
    id: 'caret',
    type: 'Caret',
    label: 'Insert caret',
    group: 'Text',
    icon: TextCursorInput,
    status: 'LOCAL',
  },
  {
    id: 'replace',
    type: 'StrikeOut',
    label: 'Replace suggestion',
    group: 'Text',
    icon: TextCursorInput,
    status: 'LOCAL',
    textEntry: true,
    variant: 'replace',
  },
  { id: 'line', type: 'Line', label: 'Line', group: 'Draw', icon: Minus, status: 'LOCAL' },
  {
    id: 'arrow',
    type: 'Line',
    label: 'Arrow',
    group: 'Draw',
    icon: ArrowUpRight,
    status: 'LOCAL',
    variant: 'arrow',
  },
  {
    id: 'rectangle',
    type: 'Square',
    label: 'Rectangle',
    group: 'Draw',
    icon: Square,
    status: 'LOCAL',
  },
  { id: 'oval', type: 'Circle', label: 'Oval', group: 'Draw', icon: Circle, status: 'LOCAL' },
  {
    id: 'polygon',
    type: 'Polygon',
    label: 'Polygon',
    group: 'Draw',
    icon: Shapes,
    status: 'LOCAL',
  },
  {
    id: 'polyline',
    type: 'PolyLine',
    label: 'Connected lines',
    group: 'Draw',
    icon: PenLine,
    status: 'LOCAL',
  },
  {
    id: 'cloud',
    type: 'Polygon',
    label: 'Cloud',
    group: 'Draw',
    icon: Cloud,
    status: 'LOCAL',
    variant: 'cloud',
  },
  { id: 'pencil', type: 'Ink', label: 'Pencil', group: 'Draw', icon: PenLine, status: 'LOCAL' },
  {
    id: 'stamp',
    type: 'Stamp',
    label: 'Approved stamp',
    group: 'Stamp & attach',
    icon: Stamp,
    status: 'LOCAL',
  },
  {
    id: 'dynamic-stamp',
    type: 'Stamp',
    label: 'Dynamic stamp',
    group: 'Stamp & attach',
    icon: Stamp,
    status: 'LOCAL',
    variant: 'dynamic-stamp',
  },
  {
    id: 'image-stamp',
    type: 'Stamp',
    label: 'Image stamp',
    group: 'Stamp & attach',
    icon: FileImage,
    status: 'LOCAL',
  },
  {
    id: 'attachment',
    type: 'FileAttachment',
    label: 'Attach file',
    group: 'Stamp & attach',
    icon: Paperclip,
    status: 'LOCAL',
  },
  {
    id: 'distance',
    type: 'Line',
    label: 'Distance',
    group: 'Measure',
    icon: Ruler,
    status: 'LOCAL',
    variant: 'distance',
  },
  {
    id: 'perimeter',
    type: 'PolyLine',
    label: 'Perimeter',
    group: 'Measure',
    icon: Ruler,
    status: 'LOCAL',
    variant: 'perimeter',
  },
  {
    id: 'area',
    type: 'Polygon',
    label: 'Area',
    group: 'Measure',
    icon: Shapes,
    status: 'LOCAL',
    variant: 'area',
  },
  {
    id: 'redaction',
    type: 'Redact',
    label: 'Redaction mark',
    group: 'Safety',
    icon: Redo2,
    status: 'LOCAL',
    disclosure:
      'Choose this tool, then drag the exact page region to redact. For text, select it and use the selection action. A mark does not remove content until applied.',
  },
];

const GROUPS = ['Text', 'Draw', 'Stamp & attach', 'Measure', 'Safety'] as const;
const PRINT_FLAG = 4;
const READ_ONLY_FLAG = 64;
const LOCKED_FLAG = 128;

interface ToolProperties {
  readonly color: string;
  readonly fill: string;
  readonly opacity: number;
  readonly weight: number;
  readonly style: EngineTypes['AnnotationBorderStyle'];
  readonly author: string;
  readonly subject: string;
  readonly locked: boolean;
  readonly readOnly: boolean;
  readonly scale: number;
  readonly units: 'pt' | 'in' | 'mm' | 'cm';
}

const DEFAULT_PROPERTIES: ToolProperties = {
  color: '#4a6bf7',
  fill: '#eef1ff',
  opacity: 1,
  weight: 2,
  style: 'Solid',
  author: '',
  subject: '',
  locked: false,
  readOnly: false,
  scale: 1,
  units: 'pt',
};

function colorComponents(value: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return [0, 0, 0];
  const hex = match[1];
  if (!hex) return [0, 0, 0];
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function measurement(value: number, properties: ToolProperties): string {
  const scaled = value * properties.scale;
  const converted =
    properties.units === 'in'
      ? scaled / 72
      : properties.units === 'mm'
        ? (scaled / 72) * 25.4
        : properties.units === 'cm'
          ? (scaled / 72) * 2.54
          : scaled;
  return `${converted.toFixed(2)} ${properties.units}`;
}

function annotationFlags(properties: ToolProperties): number {
  return (
    PRINT_FLAG |
    (properties.readOnly ? READ_ONLY_FLAG : 0) |
    (properties.locked ? LOCKED_FLAG : 0)
  );
}

function supportsBorder(type: string): boolean {
  return ['FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Ink'].includes(type);
}

function downloadJson(name: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function MarkupTools({
  engine,
  onMutation,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onMutation' | 'onError'>) {
  const [annotations, setAnnotations] = useState<readonly AnnotationInfo[]>([]);
  const activeEditorTool = useToolStore((state) => state.activeTool);
  const selectEditorTool = useToolStore((state) => state.selectTool);
  const setRedactionNotice = useDocumentStore((state) => state.setRedactionNotice);
  const [busy, setBusy] = useState(false);
  const [outputState, setOutputState] = useState<EngineTypes['OutputState'] | null>(null);
  const [confirmSignatureInvalidation, setConfirmSignatureInvalidation] = useState(false);
  const [redactionOutcome, setRedactionOutcome] = useState<string | null>(null);
  const [activeTextTool, setActiveTextTool] = useState<ToolDefinition | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationInfo | null>(null);
  const [properties, setProperties] = useState<ToolProperties>(DEFAULT_PROPERTIES);
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<
    readonly { readonly name: string; readonly properties: ToolProperties }[]
  >([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void Promise.all([engine.listAnnotations(), engine.getOutputState()])
      .then(([items, nextOutputState]) => {
        setAnnotations(items);
        setOutputState(nextOutputState);
        setSelectedAnnotation((selected) =>
          selected ? (items.find((item) => item.id === selected.id) ?? null) : null,
        );
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown annotation error.';
        onError(`Loading comments failed. ${detail}`);
      });
  }, [engine, onError]);

  useEffect(load, [load]);

  const groupedTools = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        tools: TOOLS.filter((tool) => tool.group === group),
      })),
    [],
  );

  const add = (
    tool: ToolDefinition,
    suppliedContents?: string,
    payload?: Pick<AnnotationInput, 'stampImage' | 'attachment'>,
  ) => {
    const pageIndex = Math.min(
      engine.info.pages.length - 1,
      viewportStore.getState().currentPage,
    );
    const page = engine.info.pages[pageIndex];
    if (!page) return;
    const width = Math.min(180, page.width * 0.35);
    const height =
      tool.type === 'Text'
        ? Math.min(28, page.height * 0.08)
        : Math.min(72, page.height * 0.14);
    const left = page.bounds[0] + (page.width - width) / 2;
    const top = page.bounds[1] + page.height * 0.18;
    const rect: EngineTypes['PdfRect'] = [left, top, left + width, top + height];
    const colour = colorComponents(properties.color);
    const input: MutableAnnotationInput = {
      pageIndex,
      type: tool.type,
      rect,
      contents:
        suppliedContents ??
        (tool.type === 'Redact'
          ? 'Unapplied redaction mark'
          : tool.variant === 'dynamic-stamp'
            ? `REVIEWED · ${properties.author || 'Local user'} · ${new Date().toLocaleString()}`
            : tool.type === 'Stamp'
              ? 'Approved'
              : tool.type === 'Text'
                ? 'New note'
                : ''),
      author: properties.author,
      subject: properties.subject,
      color: tool.type === 'Redact' ? [0, 0, 0] : colour,
      opacity:
        tool.type === 'Highlight' ? Math.min(properties.opacity, 0.35) : properties.opacity,
      flags: annotationFlags(properties),
      ...payload,
    };

    if (['Highlight', 'Underline', 'Squiggly', 'StrikeOut'].includes(tool.type)) {
      input.quadPoints = [
        [rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]],
      ];
    }
    if (tool.type === 'Line') {
      input.line = [
        [rect[0], rect[3]],
        [rect[2], rect[1]],
      ];
      input.lineEndingStyles =
        tool.variant === 'arrow' ? ['None', 'ClosedArrow'] : ['None', 'None'];
      if (tool.variant === 'distance') {
        input.intent = 'LineDimension';
        input.contents = `Distance ${measurement(width, properties)} · scale ${properties.scale}:1`;
      }
    }
    if (tool.type === 'Polygon' || tool.type === 'PolyLine') {
      input.vertices = [
        [rect[0], rect[3]],
        [rect[0] + width * 0.2, rect[1]],
        [rect[2], rect[1] + height * 0.25],
        [rect[2] - width * 0.15, rect[3]],
      ];
      if (tool.type === 'Polygon') {
        input.interiorColor = colorComponents(properties.fill);
      }
      if (tool.variant === 'cloud') {
        input.intent = 'PolygonCloud';
        input.borderEffect = 'Cloudy';
        input.borderEffectIntensity = 1;
      } else if (tool.variant === 'perimeter') {
        input.intent = 'PloyLine';
        input.contents = `Perimeter ${measurement((width + height) * 2, properties)}`;
      } else if (tool.variant === 'area') {
        input.intent = 'PolygonDimension';
        input.contents = `Area ${measurement(width * height, {
          ...properties,
          scale: properties.scale * properties.scale,
        })}²`;
      }
    }
    if (tool.type === 'Ink') {
      input.inkList = [
        [
          [rect[0], rect[3]],
          [rect[0] + width * 0.25, rect[1] + height * 0.25],
          [rect[0] + width * 0.6, rect[1] + height * 0.75],
          [rect[2], rect[1]],
        ],
      ];
    }
    if (tool.variant === 'callout') {
      input.intent = 'FreeTextCallout';
      input.calloutLine = [
        [rect[0], rect[3]],
        [rect[0] - width * 0.3, rect[3] + height * 0.25],
      ];
    }
    if (tool.type === 'Stamp' && !payload?.stampImage) input.icon = 'Approved';
    if (supportsBorder(tool.type)) {
      input.borderWidth = properties.weight;
      input.borderStyle = properties.style;
      if (properties.style === 'Dashed') input.borderDashPattern = [4, 3];
    }

    setBusy(true);
    void engine
      .addAnnotation(input)
      .then((result) => {
        onMutation(result);
        setActiveTextTool(null);
        load();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown annotation error.';
        onError(`Adding ${tool.label} failed. ${detail}`);
      })
      .finally(() => setBusy(false));
  };

  const selectFile = (
    event: ChangeEvent<HTMLInputElement>,
    kind: 'stampImage' | 'attachment',
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const tool = TOOLS.find((candidate) =>
      kind === 'stampImage' ? candidate.id === 'image-stamp' : candidate.id === 'attachment',
    );
    if (!tool) return;
    void file
      .arrayBuffer()
      .then((data) => {
        if (kind === 'stampImage') add(tool, file.name, { stampImage: data });
        else {
          add(tool, file.name, {
            attachment: {
              name: file.name,
              mimeType: file.type || 'application/octet-stream',
              data,
            },
          });
        }
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown file error.';
        onError(`Reading ${file.name} failed. ${detail}`);
      });
  };

  const applySelectedProperties = () => {
    if (!selectedAnnotation) return;
    const changes: EngineTypes['AnnotationUpdate'] = {
      color: colorComponents(properties.color),
      opacity: properties.opacity,
      author: properties.author,
      subject: properties.subject,
      flags: annotationFlags(properties),
      ...(supportsBorder(selectedAnnotation.type)
        ? {
            borderWidth: properties.weight,
            borderStyle: properties.style,
            ...(properties.style === 'Dashed' ? { borderDashPattern: [4, 3] } : {}),
          }
        : {}),
    };
    setBusy(true);
    void engine
      .updateAnnotation(selectedAnnotation.pageIndex, selectedAnnotation.id, changes)
      .then((result) => {
        onMutation(result);
        load();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown annotation error.';
        onError(`Updating the selected annotation failed. ${detail}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="tool-panel" aria-label="Markup tools">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Review</span>
          <h2>Comment & markup</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>
      <p className="panel-intro">
        Marks are interoperable PDF annotations. Properties are written into each annotation and
        its appearance is regenerated in the worker.
      </p>

      <details className="property-drawer">
        <summary>Tool properties</summary>
        <div className="property-grid">
          <label>
            <span>Line colour</span>
            <input
              type="color"
              value={properties.color}
              onChange={(event) =>
                setProperties((current) => ({ ...current, color: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Fill colour</span>
            <input
              type="color"
              value={properties.fill}
              onChange={(event) =>
                setProperties((current) => ({ ...current, fill: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Opacity {Math.round(properties.opacity * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={properties.opacity}
              onChange={(event) =>
                setProperties((current) => ({
                  ...current,
                  opacity: Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            <span>Line weight</span>
            <input
              type="number"
              min={0}
              max={100}
              value={properties.weight}
              onChange={(event) =>
                setProperties((current) => ({
                  ...current,
                  weight: Number(event.target.value),
                }))
              }
            />
          </label>
          <label>
            <span>Line style</span>
            <select
              value={properties.style}
              onChange={(event) =>
                setProperties((current) => ({
                  ...current,
                  style: event.target.value as ToolProperties['style'],
                }))
              }
            >
              <option value="Solid">Solid</option>
              <option value="Dashed">Dashed</option>
              <option value="Underline">Underline</option>
            </select>
          </label>
          <label>
            <span>Author</span>
            <input
              type="text"
              value={properties.author}
              onChange={(event) =>
                setProperties((current) => ({ ...current, author: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Subject</span>
            <input
              type="text"
              value={properties.subject}
              onChange={(event) =>
                setProperties((current) => ({ ...current, subject: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Measurement scale</span>
            <input
              type="number"
              min={0.0001}
              step={0.1}
              value={properties.scale}
              onChange={(event) =>
                setProperties((current) => ({
                  ...current,
                  scale: Math.max(0.0001, Number(event.target.value)),
                }))
              }
            />
          </label>
          <label>
            <span>Units</span>
            <select
              value={properties.units}
              onChange={(event) =>
                setProperties((current) => ({
                  ...current,
                  units: event.target.value as ToolProperties['units'],
                }))
              }
            >
              <option value="pt">Points</option>
              <option value="in">Inches</option>
              <option value="mm">Millimetres</option>
              <option value="cm">Centimetres</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={properties.locked}
              onChange={(event) =>
                setProperties((current) => ({ ...current, locked: event.target.checked }))
              }
            />
            <span>Locked</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={properties.readOnly}
              onChange={(event) =>
                setProperties((current) => ({ ...current, readOnly: event.target.checked }))
              }
            />
            <span>Read-only</span>
          </label>
        </div>
        <div className="preset-controls">
          <input
            type="text"
            value={presetName}
            aria-label="Tool set name"
            placeholder="Tool set name"
            onChange={(event) => setPresetName(event.target.value)}
          />
          <button
            type="button"
            disabled={!presetName.trim()}
            onClick={() => {
              setPresets((current) => [
                ...current.filter((preset) => preset.name !== presetName.trim()),
                { name: presetName.trim(), properties },
              ]);
              setPresetName('');
            }}
          >
            <Save aria-hidden="true" size={15} /> Save named set
          </button>
          <button
            type="button"
            disabled={presets.length === 0}
            onClick={() => downloadJson('papertrail-tool-sets.json', { version: 1, presets })}
          >
            <Download aria-hidden="true" size={15} /> Export sets
          </button>
        </div>
        <div className="preset-list">
          {presets.map((preset) => (
            <button
              type="button"
              key={preset.name}
              onClick={() => setProperties(preset.properties)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </details>

      {outputState?.unappliedRedactions ? (
        <div className="warning-card" role="alert">
          <strong>
            Apply {outputState.unappliedRedactions} redaction{' '}
            {outputState.unappliedRedactions === 1 ? 'mark' : 'marks'}{' '}
            <FeatureBadge status="DEGRADED" />
          </strong>
          <p>
            Applying removes the marked content and unblocks Save, Export, Print, extract,
            split, and sanitize. DEGRADED: redaction writes through a content-stream filter that
            perturbs rendering on some documents.
          </p>
          {outputState.signatures > 0 ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmSignatureInvalidation}
                onChange={(event) => setConfirmSignatureInvalidation(event.target.checked)}
              />
              <span>
                I understand that applying redactions invalidates {outputState.signatures}{' '}
                existing {outputState.signatures === 1 ? 'signature' : 'signatures'}.
              </span>
            </label>
          ) : null}
          <button
            type="button"
            disabled={busy || (outputState.signatures > 0 && !confirmSignatureInvalidation)}
            onClick={() => {
              setBusy(true);
              setRedactionOutcome(null);
              const markedPages = [
                ...new Set(
                  annotations
                    .filter((annotation) => annotation.type === 'Redact')
                    .map((annotation) => annotation.pageIndex),
                ),
              ];
              void snapshotRedactionText(engine, markedPages)
                .then(async (before) => {
                  const report = await engine.applyRedactions(confirmSignatureInvalidation);
                  onMutation(report);
                  const after = await snapshotRedactionText(engine, markedPages);
                  const notice = describeRedactionOutcome(report, before, after);
                  setRedactionOutcome(notice);
                  setRedactionNotice(notice);
                  load();
                })
                .catch((error: unknown) => {
                  const detail =
                    error instanceof Error ? error.message : 'Unknown redaction error.';
                  setRedactionOutcome(detail);
                })
                .finally(() => setBusy(false));
            }}
          >
            Apply redaction marks
          </button>
          {redactionOutcome ? <p role="alert">{redactionOutcome}</p> : null}
        </div>
      ) : redactionOutcome ? (
        <p className="result-summary" role="status">
          {redactionOutcome}
        </p>
      ) : null}

      {groupedTools.map(({ group, tools }) => (
        <fieldset className="tool-family" key={group}>
          <legend>{group}</legend>
          <div className="tool-grid">
            {tools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  type="button"
                  key={tool.id}
                  disabled={busy}
                  aria-pressed={
                    tool.id === 'redaction' ? activeEditorTool === 'redaction-mark' : undefined
                  }
                  aria-describedby={tool.disclosure ? `disclosure-${tool.id}` : undefined}
                  onClick={() => {
                    if (tool.id === 'image-stamp') imageInput.current?.click();
                    else if (tool.id === 'attachment') attachmentInput.current?.click();
                    else if (tool.id === 'redaction') {
                      selectEditorTool(
                        activeEditorTool === 'redaction-mark' ? 'default' : 'redaction-mark',
                      );
                    } else if (tool.textEntry) setActiveTextTool(tool);
                    else add(tool);
                  }}
                >
                  <Icon aria-hidden="true" size={17} />
                  <span>{tool.label}</span>
                  <FeatureBadge status={tool.status} />
                  {tool.disclosure ? (
                    <small id={`disclosure-${tool.id}`}>{tool.disclosure}</small>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <input
        ref={imageInput}
        hidden
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Image for custom stamp"
        onChange={(event) => selectFile(event, 'stampImage')}
      />
      <input
        ref={attachmentInput}
        hidden
        type="file"
        aria-label="File to attach as a comment"
        onChange={(event) => selectFile(event, 'attachment')}
      />

      {activeTextTool ? (
        <ActiveTextEntry
          kind={activeTextTool.variant === 'replace' ? 'comment' : 'overlay'}
          label={
            activeTextTool.variant === 'replace'
              ? 'Replacement suggestion'
              : activeTextTool.variant === 'callout'
                ? 'Callout text'
                : 'Overlay text'
          }
          onCommit={(value) => add(activeTextTool, value)}
          onCancel={() => setActiveTextTool(null)}
        />
      ) : null}

      <p className="result-summary" aria-live="polite">
        {annotations.length} {annotations.length === 1 ? 'annotation' : 'annotations'} in this
        document
      </p>
      {annotations.length > 0 ? (
        <details className="annotation-inspector">
          <summary>
            {annotations.length} {annotations.length === 1 ? 'annotation' : 'annotations'} ·
            edit existing
          </summary>
          <div className="annotation-picker">
            {annotations.map((annotation) => (
              <button
                type="button"
                className={selectedAnnotation?.id === annotation.id ? 'active' : ''}
                key={`${annotation.pageIndex}-${annotation.id}`}
                onClick={() => setSelectedAnnotation(annotation)}
              >
                {annotation.type} · page {annotation.pageIndex + 1}
              </button>
            ))}
          </div>
          {selectedAnnotation ? (
            <div className="panel-actions">
              <button type="button" disabled={busy} onClick={applySelectedProperties}>
                Apply properties to selected mark
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void engine
                    .deleteAnnotation(selectedAnnotation.pageIndex, selectedAnnotation.id)
                    .then((result) => {
                      onMutation(result);
                      setSelectedAnnotation(null);
                      load();
                    })
                    .catch((error: unknown) => {
                      const detail =
                        error instanceof Error ? error.message : 'Unknown annotation error.';
                      onError(`Deleting the selected annotation failed. ${detail}`);
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Delete selected mark
              </button>
            </div>
          ) : null}
        </details>
      ) : (
        <p className="empty-message">Choose a markup tool to add the first annotation.</p>
      )}

      <p className="scope-note">
        <Upload aria-hidden="true" size={14} /> Image and attachment bytes are read locally and
        sent only to this document&apos;s worker.
      </p>
    </section>
  );
}
