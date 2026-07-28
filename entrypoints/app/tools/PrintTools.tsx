import { useState } from 'react';
import { Printer } from 'lucide-react';
import { viewportStore } from '@/lib/store/viewport';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

function parseRange(value: string, pageCount: number): number[] {
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
  return [...pages];
}

export default function PrintTools({
  engine,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onError'>) {
  const [rangeMode, setRangeMode] = useState<'all' | 'current' | 'range'>('all');
  const [range, setRange] = useState('1');
  const [subset, setSubset] = useState<'all' | 'odd' | 'even'>('all');
  const [reverse, setReverse] = useState(false);
  const [scale, setScale] = useState<'fit' | 'actual' | 'shrink'>('fit');
  const [include, setInclude] = useState<'document' | 'markups'>('markups');
  const [busy, setBusy] = useState(false);

  const print = () => {
    if (!engine.info.permissions.print) {
      onError('Printing is disabled by this document’s permission settings.');
      return;
    }
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      onError('Printing needs permission to open a local print window.');
      return;
    }
    setBusy(true);
    void (async () => {
      const output = await engine.getOutputState();
      if (output.unappliedRedactions > 0) {
        throw new Error(
          `${output.unappliedRedactions} unapplied redaction ${
            output.unappliedRedactions === 1 ? 'mark blocks' : 'marks block'
          } Save, Export, and Print.`,
        );
      }
      let pages =
        rangeMode === 'all'
          ? engine.info.pages.map((page) => page.index)
          : rangeMode === 'current'
            ? [viewportStore.getState().currentPage]
            : parseRange(range, engine.info.pages.length);
      if (subset === 'odd') pages = pages.filter((page) => page % 2 === 0);
      if (subset === 'even') pages = pages.filter((page) => page % 2 === 1);
      if (reverse) pages = [...pages].reverse();
      if (pages.length === 0) throw new Error('The selected print range has no pages.');
      const allPages =
        pages.length === engine.info.pages.length &&
        pages.every((page, index) => page === index);
      const data = allPages
        ? await engine.exportPdf({
            mode: 'full',
            garbage: 'deduplicate',
            compress: true,
            encrypt: 'keep',
          })
        : (await engine.extractPages(pages)).data;
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      popup.location.href = url;
      popup.addEventListener(
        'load',
        () => {
          popup.focus();
          popup.print();
        },
        { once: true },
      );
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })()
      .catch((error: unknown) => {
        popup.close();
        const detail = error instanceof Error ? error.message : 'Unknown print error.';
        onError(`Preparing the document for print failed. ${detail}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="tool-panel" aria-label="Print document">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Local output</span>
          <h2>Print</h2>
        </div>
        <FeatureBadge status="EQUIV" />
      </div>
      <p className="panel-intro">
        Prepare pages locally, then hand the resulting PDF to the browser and operating
        system&apos;s print dialog.
      </p>
      {!engine.info.permissions.print ? (
        <p className="warning-card" role="alert">
          This document&apos;s permission flags prohibit printing.
        </p>
      ) : null}
      <div className="property-grid">
        <label>
          <span>Pages</span>
          <select
            value={rangeMode}
            onChange={(event) => setRangeMode(event.target.value as typeof rangeMode)}
          >
            <option value="all">All pages</option>
            <option value="current">Current page</option>
            <option value="range">Page range</option>
          </select>
        </label>
        {rangeMode === 'range' ? (
          <label>
            <span>Range</span>
            <input value={range} onChange={(event) => setRange(event.target.value)} />
          </label>
        ) : null}
        <label>
          <span>Subset</span>
          <select
            value={subset}
            onChange={(event) => setSubset(event.target.value as typeof subset)}
          >
            <option value="all">All selected pages</option>
            <option value="odd">Odd pages</option>
            <option value="even">Even pages</option>
          </select>
        </label>
        <label>
          <span>Scale</span>
          <select
            value={scale}
            onChange={(event) => setScale(event.target.value as typeof scale)}
          >
            <option value="fit">Fit printable area</option>
            <option value="actual">Actual size</option>
            <option value="shrink">Shrink oversized pages</option>
          </select>
        </label>
        <label>
          <span>Content</span>
          <select
            value={include}
            onChange={(event) => setInclude(event.target.value as typeof include)}
          >
            <option value="markups">Document and markups</option>
            <option value="document">Document</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={reverse}
            onChange={(event) => setReverse(event.target.checked)}
          />
          <span>Reverse order</span>
        </label>
      </div>
      <button
        type="button"
        className="primary-action"
        disabled={busy || !engine.info.permissions.print}
        onClick={print}
      >
        <Printer aria-hidden="true" size={16} /> {busy ? 'Preparing…' : 'Open print dialog'}
      </button>
      <p className="scope-note">
        Selected range, odd/even filtering, and reverse order are applied before the dialog. The
        browser owns printer selection, copies, duplex, paper source, and final scaling policy (
        {scale}).{' '}
        {include === 'document'
          ? 'Annotation suppression is not approximated.'
          : 'Printable annotations remain included.'}
      </p>
      <p className="scope-note">
        <FeatureBadge status="EXCLUDED" /> Prepress marks, separations, and colour-management
        preview are a named non-goal.
      </p>
    </section>
  );
}
