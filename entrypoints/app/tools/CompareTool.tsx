import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FileSearch, ScanText } from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';
import ocrClient, { type OcrResult, isAbortError } from '@/lib/ocr/client';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

type PageEnrichment = {
  readonly ocr?: OcrResult;
};

function TextDiffView({
  diff,
}: {
  readonly diff: NonNullable<EngineTypes['CompareResult']['pages'][number]['textDiff']>;
}) {
  const insWords = diff.insertedWords;
  const delWords = diff.deletedWords;
  return (
    <div className="text-diff-summary" aria-label="Text changes">
      {insWords > 0 && (
        <span className="diff-insert">
          +{insWords} word{insWords !== 1 ? 's' : ''}
        </span>
      )}
      {delWords > 0 && (
        <span className="diff-delete">
          −{delWords} word{delWords !== 1 ? 's' : ''}
        </span>
      )}
      {insWords === 0 && delWords === 0 && <span className="diff-equal">text unchanged</span>}
      {diff.truncated && <small> (truncated)</small>}
    </div>
  );
}

export default function CompareTool({
  engine,
  onNavigate,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onNavigate' | 'onError'>) {
  const [result, setResult] = useState<EngineTypes['CompareResult'] | null>(null);
  const [enrichments, setEnrichments] = useState<Map<number, PageEnrichment>>(new Map());
  const [busy, setBusy] = useState(false);
  const [enrichingPage, setEnrichingPage] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ocrController = useRef<AbortController | null>(null);
  const ocrGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ocrGeneration.current += 1;
      ocrController.current?.abort();
      ocrController.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      ocrGeneration.current += 1;
      ocrController.current?.abort();
      ocrController.current = null;
      if (mounted.current) setEnrichingPage(null);
    },
    [engine],
  );

  const compare = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setEnrichments(new Map());
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

  // Current-page OCR is inspection only. CMPR-009 remains EXCLUDED because this cannot
  // recognize the incoming page or produce a scanned-against-digital comparison result.
  const enrichWithOcr = (resultPageIndex: number, currentPageIndex: number) => {
    if (enrichments.get(resultPageIndex)?.ocr) return;
    if (enrichingPage === resultPageIndex) return;
    ocrController.current?.abort();
    const controller = new AbortController();
    const generation = ++ocrGeneration.current;
    ocrController.current = controller;
    setEnrichingPage(resultPageIndex);
    void ocrClient
      .recognizePage(engine, currentPageIndex, controller.signal)
      .then((ocr) => {
        if (generation !== ocrGeneration.current || controller.signal.aborted) return;
        setEnrichments((prev) => {
          const next = new Map(prev);
          next.set(resultPageIndex, { ...prev.get(resultPageIndex), ocr });
          return next;
        });
      })
      .catch((error: unknown) => {
        if (generation !== ocrGeneration.current || isAbortError(error)) return;
        const detail = error instanceof Error ? error.message : 'Unknown OCR error.';
        onError(`Inspecting the current scanned page failed. ${detail}`);
      })
      .finally(() => {
        if (!mounted.current || generation !== ocrGeneration.current) return;
        ocrController.current = null;
        setEnrichingPage(null);
      });
  };

  return (
    <section className="tool-panel" aria-label="Compare documents">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Local review</span>
          <h2>Compare</h2>
        </div>
        <FeatureBadge status="DEGRADED" />
      </div>
      <p className="panel-intro">
        Text, dimensions, labels, additions, and removals are compared locally. Scanned or
        raster-only pages need raster/OCR review before you rely on the result.
      </p>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        aria-label="PDF to compare"
        onChange={compare}
      />
      <button
        type="button"
        className="primary-action"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <FileSearch aria-hidden="true" size={16} />{' '}
        {busy ? 'Comparing…' : 'Choose comparison PDF'}
      </button>
      <p className="scope-note">
        <FeatureBadge status="OPEN" /> Scanned-against-digital comparison needs a two-document
        OCR workflow. Bundled OCR can inspect the current page across the supported browser
        floor, but that result is not yet compared with the incoming page.
      </p>
      {result ? (
        <>
          <div className="compare-summary" role="status">
            <strong>{result.incomingName}</strong>
            <span>{result.same} same</span>
            <span>{result.changed} changed</span>
            <span>{result.moved} moved</span>
            <span>{result.added} added</span>
            <span>{result.removed} removed</span>
          </div>
          {result.truncated ? (
            <p className="warning-card" role="alert">
              Comparison stopped at {result.comparedCurrentPages} of {result.totalCurrentPages}{' '}
              current pages and {result.comparedIncomingPages} of {result.totalIncomingPages}{' '}
              incoming pages. Pages beyond that limit were not classified.
            </p>
          ) : null}
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Result</th>
                  <th scope="col">Text</th>
                  <th scope="col">Geometry</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.pages.map((page) => {
                  const enrichment = enrichments.get(page.pageIndex);
                  const isEnriching = enrichingPage === page.pageIndex;
                  return (
                    <tr
                      key={`${page.status}:${page.pageIndex}:${page.currentPageIndex ?? 'incoming'}`}
                    >
                      <td>
                        <button
                          type="button"
                          disabled={page.currentPageIndex === undefined}
                          onClick={() => onNavigate(page.currentPageIndex ?? page.pageIndex)}
                        >
                          {page.pageIndex + 1}
                        </button>
                      </td>
                      <td>
                        <span className={`comparison-${page.status}`}>{page.status}</span>
                      </td>
                      <td>
                        {page.currentCharacters} → {page.incomingCharacters}
                        {page.textDiff ? <TextDiffView diff={page.textDiff} /> : null}
                      </td>
                      <td>{page.dimensionsChanged ? 'changed' : 'same'}</td>
                      <td>
                        {page.rasterDiff ? (
                          <small>
                            RMSE {page.rasterDiff.rmse.toFixed(3)}
                            {page.rasterDiff.exceedsThreshold ? ' · visual change' : ''}
                          </small>
                        ) : page.rasterReviewRecommended ? (
                          enrichment?.ocr ? (
                            <span title={enrichment.ocr.text.slice(0, 200)}>
                              OCR: {enrichment.ocr.text.length} chars ·{' '}
                              {Math.round(enrichment.ocr.confidence)}%
                            </span>
                          ) : page.currentPageIndex !== undefined ? (
                            <button
                              type="button"
                              className="inline-action"
                              disabled={isEnriching}
                              aria-label={`Run OCR on page ${page.pageIndex + 1} for comparison`}
                              onClick={() =>
                                enrichWithOcr(page.pageIndex, page.currentPageIndex!)
                              }
                              title="Inspect the current scanned page with on-device OCR"
                            >
                              <ScanText aria-hidden="true" size={13} />{' '}
                              {isEnriching ? '…' : 'OCR'}
                            </button>
                          ) : (
                            <small>Incoming scanned page requires OCR before comparison.</small>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="scope-note">
            <FeatureBadge status="OPEN" /> Scanned pages with no extractable text are identified
            for review. Bundled cross-browser OCR can inspect the current page, but comparing
            both documents still needs an explicit two-document OCR workflow.
          </p>
          <p className="scope-note">
            Page moves use measured text similarity. Image and graphic differences use a
            same-engine 128 px raster RMSE; the report identifies changed regions, not the PDF
            object that changed.
          </p>
        </>
      ) : null}
    </section>
  );
}
