import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  CopyPlus,
  FileInput,
  FileOutput,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  Trash2,
} from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';
import { DesignedCheckbox, DesignedSelect } from '../DesignedControls';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

type CompositionItem = EngineTypes['PageCompositionItem'];
type IncomingDocument = EngineTypes['IncomingDocumentInfo'];

type Preview =
  | { readonly action: 'delete'; readonly pages: readonly number[] }
  | {
      readonly action: 'reorder';
      readonly order: readonly number[];
      readonly description: string;
    }
  | { readonly action: 'rotate'; readonly pages: readonly number[]; readonly degrees: 90 | -90 }
  | { readonly action: 'insert'; readonly at: number }
  | {
      readonly action: 'box';
      readonly page: number;
      readonly box: EngineTypes['PageBox'];
      readonly rect: EngineTypes['PdfRect'];
    }
  | {
      readonly action: 'labels';
      readonly at: number;
      readonly style: EngineTypes['PageLabelStyle'];
      readonly prefix: string;
      readonly start: number;
    }
  | {
      readonly action: 'extract';
      readonly pages: readonly number[];
      readonly deleteOriginals: boolean;
    }
  | {
      readonly action: 'merge';
      readonly file: File;
      readonly incoming: IncomingDocument;
      readonly at: number;
    }
  | {
      readonly action: 'compose';
      readonly name: string;
      readonly description: string;
      readonly order: readonly CompositionItem[];
      readonly file?: File;
    }
  | {
      readonly action: 'outputs';
      readonly description: string;
      readonly groups: readonly (readonly number[])[];
    };

function parsePageRange(value: string, pageCount: number): number[] {
  if (!value.trim()) return [];
  const pages = new Set<number>();
  for (const token of value.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(token);
    if (!match) throw new Error(`"${token.trim()}" is not a page number or range.`);
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > pageCount) {
      throw new Error(`Page range ${token.trim()} is outside this ${pageCount}-page document.`);
    }
    for (let page = first; page <= last; page += 1) pages.add(page - 1);
  }
  return [...pages].sort((left, right) => left - right);
}

function contiguousRanges(
  groups: readonly (readonly number[])[],
): readonly (readonly [number, number])[] {
  return groups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined || last - first + 1 !== group.length) {
      throw new Error('This split requires contiguous page groups.');
    }
    return [first, last + 1] as const;
  });
}

function groupsByCount(pageCount: number, size: number): number[][] {
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    groups.push(
      Array.from({ length: Math.min(size, pageCount - start) }, (_, offset) => start + offset),
    );
  }
  return groups;
}

function interleave(currentCount: number, incomingCount: number): CompositionItem[] {
  const order: CompositionItem[] = [];
  const count = Math.max(currentCount, incomingCount);
  for (let index = 0; index < count; index += 1) {
    if (index < currentCount) order.push({ source: 'current', pageIndex: index });
    if (index < incomingCount) order.push({ source: 'incoming', pageIndex: index });
  }
  return order;
}

function movePage(order: readonly number[], source: number, insertion: number): number[] {
  const next = order.filter((page) => page !== source);
  const removedBefore = order.indexOf(source) < insertion ? 1 : 0;
  next.splice(Math.max(0, insertion - removedBefore), 0, source);
  return next;
}

function previewText(preview: Preview): string {
  if (preview.action === 'insert')
    return `Insert one blank page at position ${preview.at + 1}.`;
  if (preview.action === 'delete') {
    return `Delete pages ${preview.pages.map((page) => page + 1).join(', ')}.`;
  }
  if (preview.action === 'rotate') {
    return `Rotate document pages ${preview.pages.map((page) => page + 1).join(', ')} by ${
      preview.degrees
    } degrees.`;
  }
  if (preview.action === 'extract') {
    return `${preview.deleteOriginals ? 'Extract and remove' : 'Extract'} pages ${preview.pages
      .map((page) => page + 1)
      .join(', ')} into a new PDF.`;
  }
  if (preview.action === 'box') {
    return `Set the ${preview.box} of page ${preview.page + 1} to [${preview.rect
      .map((value) => Math.round(value))
      .join(', ')}] points.`;
  }
  if (preview.action === 'labels') {
    return `Start ${preview.style} page labels at page ${preview.at + 1} with prefix "${
      preview.prefix
    }" and number ${preview.start}.`;
  }
  if (preview.action === 'merge') {
    return `Insert all ${preview.incoming.pageCount} pages from ${preview.incoming.name} at position ${
      preview.at + 1
    }.`;
  }
  return preview.description;
}

export default function OrganizePages({
  engine,
  onMutation,
  onOutput,
  onRotateView,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onMutation' | 'onOutput' | 'onRotateView' | 'onError'>) {
  const [selected, setSelected] = useState<readonly number[]>([]);
  const [range, setRange] = useState('');
  const [insertAt, setInsertAt] = useState(engine.info.pages.length);
  const [splitSize, setSplitSize] = useState(1);
  const [splitText, setSplitText] = useState('');
  const [pageBox, setPageBox] = useState<EngineTypes['PageBox']>('CropBox');
  const [boxInset, setBoxInset] = useState(18);
  const [labelStyle, setLabelStyle] = useState<EngineTypes['PageLabelStyle']>('decimal');
  const [labelPrefix, setLabelPrefix] = useState('');
  const [labelStart, setLabelStart] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [incoming, setIncoming] = useState<{
    readonly file: File;
    readonly info: IncomingDocument;
  } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const mergeInput = useRef<HTMLInputElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const pageOrder = engine.info.pages.map((page) => page.index);

  const report = (action: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : 'Unknown page operation error.';
    onError(`${action} failed. ${detail}`);
  };

  const selectRange = () => {
    try {
      setSelected(parsePageRange(range, engine.info.pages.length));
    } catch (error) {
      report('Selecting the page range', error);
    }
  };

  const inspectIncoming = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    void file
      .arrayBuffer()
      .then((data) => engine.inspectIncomingDocument(file.name, data))
      .then((info) => setIncoming({ file, info }))
      .catch((error: unknown) => report('Inspecting the source PDF', error))
      .finally(() => setBusy(false));
  };

  const downloadGroups = async (groups: readonly (readonly number[])[]) => {
    for (const [index, group] of groups.entries()) {
      const output = await engine.extractPages(group);
      const base = output.name.replace(/-pages\.pdf$/i, '');
      onOutput(output.data, `${base}-part-${index + 1}.pdf`);
    }
  };

  const run = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      if (preview.action === 'delete') {
        onMutation(await engine.deletePages(preview.pages));
      } else if (preview.action === 'reorder') {
        onMutation(await engine.reorderPages(preview.order));
      } else if (preview.action === 'rotate') {
        onMutation(await engine.rotatePages(preview.pages, preview.degrees));
      } else if (preview.action === 'insert') {
        onMutation(await engine.insertBlankPage(preview.at));
      } else if (preview.action === 'box') {
        onMutation(await engine.setPageBoxes([preview.page], preview.box, preview.rect));
      } else if (preview.action === 'labels') {
        onMutation(
          await engine.setPageLabels(preview.at, preview.style, preview.prefix, preview.start),
        );
      } else if (preview.action === 'extract') {
        const output = await engine.extractPages(preview.pages, preview.deleteOriginals);
        onOutput(output.data, output.name);
        if (preview.deleteOriginals) {
          onMutation({ document: engine.info, journal: await engine.getJournal() });
        }
      } else if (preview.action === 'merge') {
        onMutation(
          await engine.mergeDocument(
            preview.file.name,
            await preview.file.arrayBuffer(),
            preview.at,
          ),
        );
      } else if (preview.action === 'compose') {
        onMutation(
          await engine.composePages(
            preview.name,
            preview.order,
            preview.file ? await preview.file.arrayBuffer() : undefined,
          ),
        );
      } else {
        await downloadGroups(preview.groups);
      }
      setPreview(null);
      setSelected([]);
    } catch (error) {
      report('Organizing pages', error);
    } finally {
      setBusy(false);
    }
  };

  const previewSplit = (description: string, groups: readonly (readonly number[])[]) => {
    if (groups.length < 2) {
      onError('Splitting pages requires at least two non-empty output documents.');
      return;
    }
    setPreview({ action: 'outputs', description, groups });
  };

  const previewReplace = () => {
    if (!incoming || selected.length === 0) return;
    const first = Math.min(...selected);
    const order: CompositionItem[] = [];
    for (const page of pageOrder) {
      if (page === first) {
        for (let index = 0; index < incoming.info.pageCount; index += 1) {
          order.push({ source: 'incoming', pageIndex: index });
        }
      }
      if (!selectedSet.has(page)) order.push({ source: 'current', pageIndex: page });
    }
    setPreview({
      action: 'compose',
      name: `Replace ${selected.length} page${selected.length === 1 ? '' : 's'}`,
      description: `Replace pages ${selected.map((page) => page + 1).join(', ')} with ${
        incoming.info.pageCount
      } pages from ${incoming.file.name}.`,
      order,
      file: incoming.file,
    });
  };

  return (
    <section className="tool-panel" aria-label="Organize pages">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Document structure</span>
          <h2>Organize pages</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>
      <p id="organize-drag-help" className="panel-intro">
        Drag pages to enable insertion targets and reorder them. Every destructive or bulk
        action stops at a result preview.
      </p>

      <div className="range-control">
        <label>
          <span>Page range</span>
          <input
            type="text"
            value={range}
            placeholder="1-3, 7"
            onChange={(event) => setRange(event.target.value)}
          />
        </label>
        <button type="button" onClick={selectRange}>
          Select range
        </button>
        <button type="button" onClick={() => setSelected(pageOrder)}>
          Select all
        </button>
      </div>

      <div className="organize-strip" aria-label="Page order">
        {pageOrder.map((pageIndex, position) => {
          const page = engine.info.pages[pageIndex];
          if (!page) return null;
          return (
            <div key={pageIndex} className="organize-slot">
              <button
                type="button"
                className="insertion-target"
                aria-label={`Move page ${dragging === null ? '' : dragging + 1} before page ${
                  pageIndex + 1
                }`}
                disabled={dragging === null}
                aria-describedby="organize-drag-help"
                onDragOver={(event) => {
                  if (dragging !== null) event.preventDefault();
                }}
                onDrop={(event: DragEvent<HTMLButtonElement>) => {
                  event.preventDefault();
                  if (dragging === null) return;
                  const order = movePage(pageOrder, dragging, position);
                  setPreview({
                    action: 'reorder',
                    order,
                    description: `Move page ${dragging + 1} to position ${
                      order.indexOf(dragging) + 1
                    }.`,
                  });
                  setDragging(null);
                }}
              >
                <span aria-hidden="true" />
              </button>
              <div
                className={`organize-page-choice${selectedSet.has(pageIndex) ? ' selected' : ''}`}
                draggable
                onDragStart={(event: DragEvent<HTMLDivElement>) => {
                  setDragging(pageIndex);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(pageIndex));
                }}
                onDragEnd={() => setDragging(null)}
              >
                <DesignedCheckbox
                  label={`Select page ${page.label}`}
                  checked={selectedSet.has(pageIndex)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, pageIndex].sort((left, right) => left - right)
                        : current.filter((index) => index !== pageIndex),
                    )
                  }
                />
                <strong>{page.label}</strong>
                <small>Page {pageIndex + 1}</small>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="insertion-target trailing"
          aria-label="Move page to end"
          disabled={dragging === null}
          aria-describedby="organize-drag-help"
          onDragOver={(event) => {
            if (dragging !== null) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging === null) return;
            const order = movePage(pageOrder, dragging, pageOrder.length);
            setPreview({
              action: 'reorder',
              order,
              description: `Move page ${dragging + 1} to the end.`,
            });
            setDragging(null);
          }}
        >
          <span aria-hidden="true" />
        </button>
      </div>

      <fieldset className="workflow-group">
        <legend>Rotate</legend>
        <div className="panel-actions">
          <button type="button" onClick={() => onRotateView(-90)}>
            <RotateCcw aria-hidden="true" size={16} /> Rotate view left
          </button>
          <button type="button" onClick={() => onRotateView(90)}>
            <RotateCw aria-hidden="true" size={16} /> Rotate view right
          </button>
          <button
            type="button"
            disabled={selected.length === 0}
            aria-describedby="organize-selection-help"
            onClick={() => setPreview({ action: 'rotate', pages: selected, degrees: 90 })}
          >
            <RotateCw aria-hidden="true" size={16} /> Rotate document pages
          </button>
        </div>
        <small id="organize-selection-help">
          View rotation is temporary. Select one or more pages before rotating document pages;
          document rotation is written and undoable.
        </small>
      </fieldset>

      <fieldset className="workflow-group">
        <legend>Crop boxes & labels</legend>
        <label>
          <span>Page box</span>
          <DesignedSelect
            label="Page box"
            value={pageBox}
            options={[
              { value: 'MediaBox', label: 'Media box' },
              { value: 'CropBox', label: 'Crop box' },
              { value: 'BleedBox', label: 'Bleed box' },
              { value: 'TrimBox', label: 'Trim box' },
              { value: 'ArtBox', label: 'Art box' },
            ]}
            onValueChange={setPageBox}
          />
        </label>
        <label>
          <span>Inset from current page bounds (pt)</span>
          <input
            type="number"
            min={0}
            value={boxInset}
            onChange={(event) => setBoxInset(Math.max(0, Number(event.target.value)))}
          />
        </label>
        <button
          type="button"
          disabled={selected.length !== 1}
          aria-describedby="organize-single-selection-help"
          onClick={() => {
            const pageIndex = selected[0];
            const page = pageIndex === undefined ? undefined : engine.info.pages[pageIndex];
            if (!page) return;
            setPreview({
              action: 'box',
              page: page.index,
              box: pageBox,
              rect: [
                page.bounds[0] + boxInset,
                page.bounds[1] + boxInset,
                page.bounds[2] - boxInset,
                page.bounds[3] - boxInset,
              ],
            });
          }}
        >
          Preview page box
        </button>
        <div className="property-grid">
          <label>
            <span>Label style</span>
            <DesignedSelect
              label="Page label style"
              value={labelStyle}
              options={[
                { value: 'none', label: 'Prefix only' },
                { value: 'decimal', label: '1, 2, 3' },
                { value: 'roman-upper', label: 'I, II, III' },
                { value: 'roman-lower', label: 'i, ii, iii' },
                { value: 'alpha-upper', label: 'A, B, C' },
                { value: 'alpha-lower', label: 'a, b, c' },
              ]}
              onValueChange={setLabelStyle}
            />
          </label>
          <label>
            <span>Prefix</span>
            <input
              value={labelPrefix}
              onChange={(event) => setLabelPrefix(event.target.value)}
            />
          </label>
          <label>
            <span>Start number</span>
            <input
              type="number"
              min={1}
              value={labelStart}
              onChange={(event) => setLabelStart(Math.max(1, Number(event.target.value)))}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() =>
            setPreview({
              action: 'labels',
              at: selected[0] ?? 0,
              style: labelStyle,
              prefix: labelPrefix,
              start: labelStart,
            })
          }
        >
          Preview page labels
        </button>
        <small id="organize-single-selection-help">
          Select exactly one page to preview a page box. Each PDF page box is edited by name;
          the app never approximates every box as one generic “crop”.
        </small>
      </fieldset>

      <fieldset className="workflow-group">
        <legend>Insert, merge & replace</legend>
        <label>
          <span>Insert before position</span>
          <DesignedSelect
            label="Insert before position"
            value={String(insertAt)}
            options={Array.from({ length: engine.info.pages.length + 1 }, (_, index) => ({
              value: String(index),
              label:
                index === engine.info.pages.length ? 'End of document' : `Page ${index + 1}`,
            }))}
            onValueChange={(value) => setInsertAt(Number(value))}
          />
        </label>
        <div className="panel-actions">
          <button type="button" onClick={() => setPreview({ action: 'insert', at: insertAt })}>
            <Plus aria-hidden="true" size={16} /> Insert blank page
          </button>
          <button
            type="button"
            onClick={() => mergeInput.current?.click()}
            disabled={busy}
            aria-describedby="organize-source-help"
          >
            <FileInput aria-hidden="true" size={16} /> Choose source PDF
          </button>
          <button
            type="button"
            disabled={!incoming}
            aria-describedby="organize-source-help"
            onClick={() => {
              if (incoming)
                setPreview({
                  action: 'merge',
                  file: incoming.file,
                  incoming: incoming.info,
                  at: insertAt,
                });
            }}
          >
            Merge at insertion point
          </button>
          <button
            type="button"
            disabled={!incoming || selected.length === 0}
            aria-describedby="organize-source-help"
            onClick={previewReplace}
          >
            Replace selected pages
          </button>
          <button
            type="button"
            disabled={!incoming}
            aria-describedby="organize-source-help"
            onClick={() => {
              if (!incoming) return;
              setPreview({
                action: 'compose',
                name: `Alternate with ${incoming.file.name}`,
                description: `Alternate ${engine.info.pages.length} current pages with ${incoming.info.pageCount} pages from ${incoming.file.name}.`,
                order: interleave(engine.info.pages.length, incoming.info.pageCount),
                file: incoming.file,
              });
            }}
          >
            <ArrowLeftRight aria-hidden="true" size={16} /> Alternate & mix
          </button>
        </div>
        <input
          ref={mergeInput}
          hidden
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Source PDF for page organization"
          onChange={inspectIncoming}
        />
        <small id="organize-source-help">
          {incoming
            ? `${incoming.file.name} · ${incoming.info.pageCount} pages ready. Select current pages before replacing them.`
            : 'Choose a source PDF before merging, replacing, or alternating pages.'}
        </small>
      </fieldset>

      <fieldset className="workflow-group">
        <legend>Extract & duplicate</legend>
        <div
          className="extract-drop-zone"
          onDragOver={(event) => {
            if (dragging !== null) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging !== null) {
              setPreview({ action: 'extract', pages: [dragging], deleteOriginals: false });
              setDragging(null);
            }
          }}
        >
          <FileOutput aria-hidden="true" size={18} />
          <span>Drop a dragged page here, or use the selected pages.</span>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            disabled={selected.length === 0}
            aria-describedby="organize-extract-help"
            onClick={() =>
              setPreview({ action: 'extract', pages: selected, deleteOriginals: false })
            }
          >
            <FileOutput aria-hidden="true" size={16} /> Extract selected
          </button>
          <button
            type="button"
            disabled={selected.length === 0 || selected.length === engine.info.pages.length}
            aria-describedby="organize-extract-help"
            onClick={() =>
              setPreview({ action: 'extract', pages: selected, deleteOriginals: true })
            }
          >
            <ArrowDownToLine aria-hidden="true" size={16} /> Extract & remove
          </button>
          <button
            type="button"
            disabled={selected.length === 0}
            aria-describedby="organize-extract-help"
            onClick={() => {
              const order = pageOrder.flatMap((pageIndex): CompositionItem[] =>
                selectedSet.has(pageIndex)
                  ? [
                      { source: 'current', pageIndex },
                      { source: 'current', pageIndex },
                    ]
                  : [{ source: 'current', pageIndex }],
              );
              setPreview({
                action: 'compose',
                name: 'Duplicate pages',
                description: `Duplicate pages ${selected.map((page) => page + 1).join(', ')}.`,
                order,
              });
            }}
          >
            <CopyPlus aria-hidden="true" size={16} /> Duplicate selected
          </button>
          <button
            type="button"
            disabled={selected.length === 0 || selected.length === engine.info.pages.length}
            aria-describedby="organize-extract-help"
            onClick={() => setPreview({ action: 'delete', pages: selected })}
          >
            <Trash2 aria-hidden="true" size={16} /> Delete selected
          </button>
        </div>
        <small id="organize-extract-help">
          Select pages first. Removing or deleting also requires at least one page to remain.
        </small>
      </fieldset>

      <fieldset className="workflow-group">
        <legend>Split</legend>
        <label>
          <span>Pages per output</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, engine.info.pages.length - 1)}
            value={splitSize}
            onChange={(event) => setSplitSize(Math.max(1, Number(event.target.value)))}
          />
        </label>
        <div className="panel-actions">
          <button
            type="button"
            disabled={engine.info.pages.length < 2}
            aria-describedby="organize-split-help"
            onClick={() => {
              const groups = groupsByCount(engine.info.pages.length, splitSize);
              contiguousRanges(groups);
              previewSplit(`Create ${groups.length} PDFs of up to ${splitSize} pages.`, groups);
            }}
          >
            <Scissors aria-hidden="true" size={16} /> Split by page count
          </button>
          <button
            type="button"
            disabled={engine.info.pages.length < 2}
            aria-describedby="organize-split-help"
            onClick={() => {
              const firstSize = Math.ceil(engine.info.pages.length / 2);
              const groups = groupsByCount(engine.info.pages.length, firstSize);
              previewSplit('Split this document into first and second halves.', groups);
            }}
          >
            Split in half
          </button>
          <button
            type="button"
            disabled={engine.info.pages.length < 2}
            aria-describedby="organize-split-help"
            onClick={() =>
              previewSplit('Create separate odd-page and even-page PDFs.', [
                pageOrder.filter((page) => page % 2 === 0),
                pageOrder.filter((page) => page % 2 === 1),
              ])
            }
          >
            Split odd / even
          </button>
          <button
            type="button"
            disabled={engine.info.outline.filter((item) => item.pageIndex !== null).length < 2}
            aria-describedby="organize-split-help"
            onClick={() => {
              const starts = [
                ...new Set(
                  engine.info.outline
                    .map((item) => item.pageIndex)
                    .filter((page): page is number => page !== null),
                ),
              ].sort((left, right) => left - right);
              const groups = starts.map((start, index) =>
                Array.from(
                  {
                    length: (starts[index + 1] ?? engine.info.pages.length) - start,
                  },
                  (_, offset) => start + offset,
                ),
              );
              previewSplit(`Create ${groups.length} PDFs from top-level bookmarks.`, groups);
            }}
          >
            Split by bookmarks
          </button>
        </div>
        <label>
          <span>Split before pages containing text</span>
          <input
            value={splitText}
            placeholder="Invoice"
            onChange={(event) => setSplitText(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!splitText.trim()}
          aria-describedby="organize-split-help"
          onClick={() => {
            void engine
              .search(splitText.trim())
              .then((result) => {
                const starts = [
                  0,
                  ...new Set(
                    result.hits
                      .map((hit) => hit.pageIndex)
                      .filter((pageIndex) => pageIndex > 0),
                  ),
                ].sort((left, right) => left - right);
                const groups = starts.map((start, index) =>
                  Array.from(
                    {
                      length: (starts[index + 1] ?? engine.info.pages.length) - start,
                    },
                    (_, offset) => start + offset,
                  ),
                );
                previewSplit(
                  `Create ${groups.length} PDFs, splitting before pages containing “${splitText.trim()}”.`,
                  groups,
                );
              })
              .catch((error: unknown) => report('Finding split text', error));
          }}
        >
          Preview split by text
        </button>
        <small id="organize-split-help">
          Split operations need at least two pages; bookmark splitting needs two bookmark
          destinations, and text splitting needs a search term.
        </small>
      </fieldset>

      {preview ? (
        <div className="result-preview" role="status">
          <strong>Result preview</strong>
          <p>{previewText(preview)}</p>
          <div className="panel-actions">
            <button
              type="button"
              className="primary-action"
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? 'Applying…' : 'Apply change'}
            </button>
            <button type="button" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
