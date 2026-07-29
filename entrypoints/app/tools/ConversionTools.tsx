import { useState } from 'react';
import { Download, FileCheck2, ScanText } from 'lucide-react';
import ocrClient, { type OcrResult } from '@/lib/ocr/client';
import type { EngineTypes } from '@/lib/engine/port';
import { viewportStore } from '@/lib/store/viewport';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

function download(name: string, type: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ConversionTools({
  engine,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onError'>) {
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [pdfa, setPdfa] = useState<EngineTypes['PdfAReport'] | null>(null);
  const [busy, setBusy] = useState<'ocr' | 'pdfa' | 'markdown' | null>(null);

  const recognize = () => {
    setBusy('ocr');
    void ocrClient
      .recognizePage(engine, viewportStore.getState().currentPage)
      .then(setOcr)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown OCR error.';
        onError(`Recognizing this page failed. ${detail}`);
      })
      .finally(() => setBusy(null));
  };

  const validate = () => {
    setBusy('pdfa');
    void engine
      .validatePdfA()
      .then(setPdfa)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown PDF/A error.';
        onError(`Validating PDF/A conformance failed. ${detail}`);
      })
      .finally(() => setBusy(null));
  };

  const markdown = () => {
    setBusy('markdown');
    void (async () => {
      const sections: string[] = [];
      for (const page of engine.info.pages) {
        const text = await engine.getPageText(page.index);
        sections.push(`## Page ${page.label}\n\n${text.text.trim()}`);
      }
      download(
        `${engine.info.name.replace(/\.pdf$/i, '')}.md`,
        'text/markdown',
        `# ${engine.info.title}\n\n${sections.join('\n\n')}\n`,
      );
    })()
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown Markdown error.';
        onError(`Exporting Markdown failed. ${detail}`);
      })
      .finally(() => setBusy(null));
  };

  return (
    <section className="tool-panel" aria-label="Convert and validate">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Document lab</span>
          <h2>Convert & validate</h2>
        </div>
      </div>

      <article className="workflow-card">
        <div className="panel-heading">
          <h3>On-device OCR</h3>
          <FeatureBadge status="DEGRADED" />
        </div>
        <p>
          Uses the browser&apos;s installed TextDetector when available. No model or page image
          is downloaded.
        </p>
        <button type="button" disabled={busy !== null} onClick={recognize}>
          <ScanText aria-hidden="true" size={16} />{' '}
          {busy === 'ocr' ? 'Recognizing…' : 'Recognize current page'}
        </button>
        {ocr ? (
          ocr.available ? (
            <>
              <textarea readOnly aria-label="Recognized page text" value={ocr.text} />
              <button
                type="button"
                onClick={() =>
                  download(
                    `${engine.info.name.replace(/\.pdf$/i, '')}-ocr.txt`,
                    'text/plain',
                    ocr.text,
                  )
                }
              >
                <Download aria-hidden="true" size={15} /> Download recognized text
              </button>
            </>
          ) : (
            <p className="warning-card" role="status">
              {ocr.reason}
            </p>
          )
        ) : null}
      </article>

      <article className="workflow-card">
        <div className="panel-heading">
          <h3>PDF/A validation</h3>
          <FeatureBadge status="LOCAL" />
        </div>
        <p>
          Checks identification metadata, output intent, embedded fonts, encryption, actions,
          and attachment-profile compatibility in the worker.
        </p>
        <button type="button" disabled={busy !== null} onClick={validate}>
          <FileCheck2 aria-hidden="true" size={16} />{' '}
          {busy === 'pdfa' ? 'Validating…' : 'Validate PDF/A'}
        </button>
        {pdfa ? (
          <div className="validation-report" role="status">
            <strong>
              {pdfa.valid ? `${pdfa.profile ?? 'PDF/A'} checks pass` : 'PDF/A checks failed'}
            </strong>
            <ul>
              {pdfa.checks.map((check) => (
                <li key={check.id} data-passed={check.passed}>
                  <span>
                    {check.passed ? 'Pass' : 'Fail'} · {check.label}
                  </span>
                  <small>{check.detail}</small>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="scope-note">
          Conversion is not approximated: a conforming output intent and profile resources must
          be present before the app can claim a PDF/A conversion.
        </p>
      </article>

      <article className="workflow-card">
        <div className="panel-heading">
          <h3>PDF to Markdown</h3>
          <FeatureBadge status="DEGRADED" />
        </div>
        <p>
          Exports local structured text by page. Complex reading order remains disclosed as
          inferred where the structure tree cannot be traversed.
        </p>
        <button type="button" disabled={busy !== null} onClick={markdown}>
          <Download aria-hidden="true" size={16} />{' '}
          {busy === 'markdown' ? 'Exporting…' : 'Download Markdown'}
        </button>
      </article>
    </section>
  );
}
