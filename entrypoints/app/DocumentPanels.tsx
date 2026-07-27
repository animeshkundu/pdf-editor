import { useEffect, useRef, useState, type RefObject } from 'react';
import engineErrors, { type EngineTypes } from '@/lib/engine/port';
import renderLayout from '@/lib/render/layout';

type AttachmentInfo = EngineTypes['AttachmentInfo'];
type OutlineNode = EngineTypes['OutlineNode'];
type PageInfo = EngineTypes['PageInfo'];
type PdfEngine = EngineTypes['PdfEngine'];
type SearchHit = EngineTypes['SearchHit'];
type PanelKind = 'pages' | 'outline' | 'attachments' | 'search' | 'capabilities';
const { WorkerCrashedError } = engineErrors;
const { PDF_POINT_SCALE } = renderLayout;

interface PanelProps {
  readonly kind: PanelKind;
  readonly engine: PdfEngine;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly onNavigate: (pageIndex: number) => void;
  readonly onSearchHit: (hit: SearchHit) => void;
  readonly onError: (message: string) => void;
}

function StatusBadge({ children }: { readonly children: string }) {
  return (
    <span className={`status-badge status-${children.toLocaleLowerCase()}`}>{children}</span>
  );
}

function Thumbnail({
  engine,
  page,
  onNavigate,
  onError,
}: {
  readonly engine: PdfEngine;
  readonly page: PageInfo;
  readonly onNavigate: (pageIndex: number) => void;
  readonly onError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(144 / page.width, 188 / page.height);
    const width = Math.max(1, Math.ceil(page.width * scale));
    const height = Math.max(1, Math.ceil(page.height * scale));
    const controller = new AbortController();
    void engine
      .renderTile(
        {
          pageIndex: page.index,
          scale,
          x: 0,
          y: 0,
          width,
          height,
          priority: Number.MAX_SAFE_INTEGER,
        },
        controller.signal,
      )
      .then((tile) => {
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = tile.width;
        canvas.height = tile.height;
        context.putImageData(
          new ImageData(new Uint8ClampedArray(tile.pixels), tile.width, tile.height),
          0,
          0,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof WorkerCrashedError && error.code === 'engine_closed') return;
        const detail = error instanceof Error ? error.message : 'Unknown thumbnail error.';
        onError(`Rendering page ${page.index + 1} preview failed. ${detail}`);
      });
    return () => controller.abort();
  }, [engine, onError, page]);

  return (
    <button type="button" className="thumbnail-button" onClick={() => onNavigate(page.index)}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          aspectRatio: `${page.width * PDF_POINT_SCALE} / ${page.height * PDF_POINT_SCALE}`,
        }}
      />
      <span>
        Page {page.label} <small>{page.index + 1}</small>
      </span>
    </button>
  );
}

function PagesPanel({
  engine,
  onNavigate,
  onError,
}: Pick<PanelProps, 'engine' | 'onNavigate' | 'onError'>) {
  const [range, setRange] = useState<readonly [number, number]>([
    0,
    Math.min(8, engine.info.pages.length),
  ]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowHeight = 232;
  return (
    <>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Navigate</span>
          <h2>Pages</h2>
        </div>
        <StatusBadge>LOCAL</StatusBadge>
      </div>
      <div
        ref={scrollerRef}
        className="thumbnail-scroller"
        onScroll={(event) => {
          const first = Math.max(0, Math.floor(event.currentTarget.scrollTop / rowHeight) - 2);
          const count = Math.ceil(event.currentTarget.clientHeight / rowHeight) + 4;
          setRange([first, Math.min(engine.info.pages.length, first + count)]);
        }}
      >
        <div
          className="thumbnail-spacer"
          style={{ height: `${engine.info.pages.length * rowHeight}px` }}
        >
          {engine.info.pages.slice(range[0], range[1]).map((page) => (
            <div
              className="thumbnail-row"
              key={page.index}
              style={{ transform: `translateY(${page.index * rowHeight}px)` }}
            >
              <Thumbnail
                engine={engine}
                page={page}
                onNavigate={onNavigate}
                onError={onError}
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function OutlineTree({
  nodes,
  onNavigate,
}: {
  readonly nodes: readonly OutlineNode[];
  readonly onNavigate: (pageIndex: number) => void;
}) {
  return (
    <ul className="outline-tree">
      {nodes.map((node, index) => (
        <li key={`${node.title}-${index}`}>
          <button
            type="button"
            disabled={node.pageIndex === null}
            onClick={() => {
              if (node.pageIndex !== null) onNavigate(node.pageIndex);
            }}
          >
            {node.title}
          </button>
          {node.children.length > 0 ? (
            <OutlineTree nodes={node.children} onNavigate={onNavigate} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OutlinePanel({ engine, onNavigate }: Pick<PanelProps, 'engine' | 'onNavigate'>) {
  return (
    <>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Document map</span>
          <h2>Outline</h2>
        </div>
        <StatusBadge>LOCAL</StatusBadge>
      </div>
      {engine.info.outline.length > 0 ? (
        <OutlineTree nodes={engine.info.outline} onNavigate={onNavigate} />
      ) : (
        <p className="empty-message">This document has no bookmarks.</p>
      )}
    </>
  );
}

function AttachmentRow({
  attachment,
  engine,
  onError,
}: {
  readonly attachment: AttachmentInfo;
  readonly engine: PdfEngine;
  readonly onError: (message: string) => void;
}) {
  return (
    <li>
      <div>
        <strong>{attachment.filename}</strong>
        <small>{attachment.mimeType}</small>
      </div>
      <button
        type="button"
        onClick={() => {
          void engine
            .readAttachment(attachment.id)
            .then((bytes) => {
              const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
              const link = document.createElement('a');
              link.href = url;
              link.download = attachment.filename;
              link.click();
              URL.revokeObjectURL(url);
            })
            .catch((error: unknown) => {
              if (error instanceof WorkerCrashedError && error.code === 'engine_closed') return;
              const detail =
                error instanceof Error ? error.message : 'Unknown attachment error.';
              onError(`Saving ${attachment.filename} failed. ${detail}`);
            });
        }}
      >
        Save
      </button>
    </li>
  );
}

function AttachmentsPanel({ engine, onError }: Pick<PanelProps, 'engine' | 'onError'>) {
  return (
    <>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Embedded files</span>
          <h2>Attachments</h2>
        </div>
        <StatusBadge>LOCAL</StatusBadge>
      </div>
      {engine.info.attachments.length > 0 ? (
        <ul className="attachment-list">
          {engine.info.attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              engine={engine}
              onError={onError}
            />
          ))}
        </ul>
      ) : (
        <p className="empty-message">This document has no embedded files.</p>
      )}
    </>
  );
}

function SearchPanel({
  engine,
  searchInputRef,
  onSearchHit,
  onError,
}: Pick<PanelProps, 'engine' | 'searchInputRef' | 'onSearchHit' | 'onError'>) {
  const [query, setQuery] = useState('');
  const [resultQuery, setResultQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const activeSearch = useRef<AbortController | null>(null);

  const runSearch = () => {
    const submittedQuery = query.trim();
    activeSearch.current?.abort();
    activeSearch.current = new AbortController();
    setHits([]);
    setTruncated(false);
    setResultQuery(submittedQuery);
    setSearching(true);
    void engine
      .search(submittedQuery, activeSearch.current.signal)
      .then((result) => {
        setHits(result.hits);
        setTruncated(result.truncated);
        if (result.hits[0]) onSearchHit(result.hits[0]);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof WorkerCrashedError && error.code === 'engine_closed') return;
        setHits([]);
        setTruncated(false);
        const detail = error instanceof Error ? error.message : 'Unknown search error.';
        onError(`Search failed. ${detail}`);
      })
      .finally(() => setSearching(false));
  };

  useEffect(() => () => activeSearch.current?.abort(), []);

  return (
    <>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Whole document</span>
          <h2>Find</h2>
        </div>
        <StatusBadge>EQUIV</StatusBadge>
      </div>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search every page"
          aria-label="Find in document"
        />
        <button type="submit" disabled={!query.trim() || searching}>
          {searching ? 'Searching…' : 'Find'}
        </button>
      </form>
      <p className="result-summary" aria-live="polite">
        {hits.length === 0
          ? 'No matches'
          : truncated
            ? `First ${hits.length} matches · refine your search to see every result`
            : `${hits.length} matches`}
      </p>
      <ol className="search-results">
        {hits.map((hit, index) => (
          <li key={`${hit.pageIndex}-${index}`}>
            <button type="button" onClick={() => onSearchHit(hit)}>
              <span>“{resultQuery}”</span>
              <small>Page {hit.pageLabel}</small>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function CapabilitiesPanel() {
  return (
    <>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Honest scope</span>
          <h2>Capabilities</h2>
        </div>
      </div>
      <dl className="capability-list">
        <div>
          <dt>Viewing, navigation, selection</dt>
          <dd>
            <StatusBadge>LOCAL</StatusBadge> Available in this release.
          </dd>
        </div>
        <div>
          <dt>Whole-document find</dt>
          <dd>
            <StatusBadge>EQUIV</StatusBadge> Uses local engine search because pages contain no
            positioned DOM text.
          </dd>
        </div>
        <div>
          <dt>Existing-text editing</dt>
          <dd>
            <StatusBadge>DEGRADED</StatusBadge> Not available in this viewer release. The only
            permitted future path is a disclosed annotation overlay; original text remains.
          </dd>
        </div>
        <div>
          <dt>True redaction</dt>
          <dd>
            <StatusBadge>EXCLUDED</StatusBadge> Withdrawn after the content rewrite failed its
            fidelity gate. A black box is never presented as redaction.
          </dd>
        </div>
        <div>
          <dt>Digital signing</dt>
          <dd>
            <StatusBadge>OPEN</StatusBadge> Unavailable pending the synchronous signer bridge
            spike; timestamping, revocation, and LTV remain excluded.
          </dd>
        </div>
      </dl>
    </>
  );
}

export default function DocumentPanel(props: PanelProps) {
  return (
    <aside className="context-panel" aria-label={`${props.kind} panel`}>
      {props.kind === 'pages' ? <PagesPanel {...props} /> : null}
      {props.kind === 'outline' ? <OutlinePanel {...props} /> : null}
      {props.kind === 'attachments' ? <AttachmentsPanel {...props} /> : null}
      {props.kind === 'search' ? <SearchPanel {...props} /> : null}
      {props.kind === 'capabilities' ? <CapabilitiesPanel /> : null}
    </aside>
  );
}
