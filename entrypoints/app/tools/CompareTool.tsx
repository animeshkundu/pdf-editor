import { useRef, useState, type ChangeEvent } from 'react';
import { FileSearch } from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

export default function CompareTool({
  engine,
  onNavigate,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onNavigate' | 'onError'>) {
  const [result, setResult] = useState<EngineTypes['CompareResult'] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const compare = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    void file
      .arrayBuffer()
      .then((data) => engine.compareDocument(file.name, data))
      .then(setResult)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown comparison error.';
        onError(`Comparing the documents failed. ${detail}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="tool-panel" aria-label="Compare documents">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Local review</span>
          <h2>Compare</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>
      <p className="panel-intro">
        Compare page text, dimensions, labels, additions, and removals without uploading either
        document.
      </p>
      <button
        type="button"
        className="primary-action"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <FileSearch aria-hidden="true" size={16} />{' '}
        {busy ? 'Comparing…' : 'Choose comparison PDF'}
      </button>
      <input
        ref={input}
        hidden
        type="file"
        accept="application/pdf,.pdf"
        aria-label="PDF to compare"
        onChange={compare}
      />
      {result ? (
        <>
          <div className="compare-summary" role="status">
            <strong>{result.incomingName}</strong>
            <span>{result.same} same</span>
            <span>{result.changed} changed</span>
            <span>{result.added} added</span>
            <span>{result.removed} removed</span>
          </div>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Result</th>
                  <th scope="col">Text</th>
                  <th scope="col">Geometry</th>
                </tr>
              </thead>
              <tbody>
                {result.pages.map((page) => (
                  <tr key={page.pageIndex}>
                    <td>
                      <button
                        type="button"
                        disabled={page.status === 'added'}
                        onClick={() => onNavigate(page.pageIndex)}
                      >
                        {page.pageIndex + 1}
                      </button>
                    </td>
                    <td>
                      <span className={`comparison-${page.status}`}>{page.status}</span>
                    </td>
                    <td>
                      {page.currentCharacters} → {page.incomingCharacters}
                      {page.rasterReviewRecommended ? (
                        <small> · raster review recommended</small>
                      ) : null}
                    </td>
                    <td>{page.dimensionsChanged ? 'changed' : 'same'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="scope-note">
            <FeatureBadge status="DEGRADED" /> Scanned pages with no extractable text are
            identified for raster/OCR review rather than silently called equal.
          </p>
        </>
      ) : null}
    </section>
  );
}
