import { useEffect, useState } from 'react';
import { Pause, Play, Wrench } from 'lucide-react';
import { viewportStore } from '@/lib/store/viewport';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

export default function AccessibilityTools({
  engine,
  onMutation,
  onNavigate,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onMutation' | 'onNavigate' | 'onError'>) {
  const [title, setTitle] = useState(engine.info.title);
  const [language, setLanguage] = useState('en');
  const [audit, setAudit] = useState<readonly string[]>([]);
  const [speaking, setSpeaking] = useState(false);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const readCurrentPage = () => {
    if (!('speechSynthesis' in window)) {
      onError('Read Out Loud is unavailable because this browser has no SpeechSynthesis API.');
      return;
    }
    const pageIndex = viewportStore.getState().currentPage;
    void engine
      .getPageText(pageIndex)
      .then((page) => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(page.text);
        utterance.lang = language;
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        setSpeaking(true);
        window.speechSynthesis.speak(utterance);
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown speech error.';
        onError(`Reading the current page failed. ${detail}`);
      });
  };

  const runAudit = () => {
    void (async () => {
      const findings: string[] = [];
      if (!engine.info.title.trim() || engine.info.title === engine.info.name) {
        findings.push('Document title is missing or still matches the filename.');
      }
      if (engine.info.outline.length === 0 && engine.info.pages.length > 3) {
        findings.push('Long document has no outline landmarks.');
      }
      const fields = await engine.listFields();
      const unnamed = fields.filter((field) => !field.name || !field.label);
      if (unnamed.length > 0)
        findings.push(`${unnamed.length} form fields need names or labels.`);
      for (const page of engine.info.pages) {
        const text = await engine.getPageText(page.index);
        if (text.analysis === 'partial') {
          findings.push(`Page ${page.label} has partial reading-order analysis.`);
        }
      }
      setAudit(
        findings.length > 0 ? findings : ['No issues found by the available local checks.'],
      );
    })().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Unknown accessibility error.';
      onError(`Running the accessibility check failed. ${detail}`);
    });
  };

  return (
    <section className="tool-panel" aria-label="Accessibility tools">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Inclusive documents</span>
          <h2>Accessibility</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>

      <article className="workflow-card">
        <div className="panel-heading">
          <h3>Read Out Loud</h3>
          <FeatureBadge status="EQUIV" />
        </div>
        <p>
          Uses the browser&apos;s installed voices and the current page&apos;s local reading
          order.
        </p>
        <div className="panel-actions">
          <button
            type="button"
            disabled={speaking}
            aria-describedby="read-aloud-status"
            onClick={readCurrentPage}
          >
            <Play aria-hidden="true" size={16} /> Read current page
          </button>
          <button
            type="button"
            disabled={!speaking}
            aria-describedby="read-aloud-status"
            onClick={() => {
              window.speechSynthesis.cancel();
              setSpeaking(false);
            }}
          >
            <Pause aria-hidden="true" size={16} /> Stop
          </button>
        </div>
        <p id="read-aloud-status" className="scope-note">
          {speaking
            ? 'Reading is active; stop it before starting again.'
            : 'Start reading before the Stop control becomes available.'}
        </p>
      </article>

      <article className="workflow-card">
        <h3>Document properties</h3>
        <div className="property-grid">
          <label>
            <span>Document title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>Primary language</span>
            <input value={language} onChange={(event) => setLanguage(event.target.value)} />
          </label>
        </div>
        <button
          type="button"
          onClick={() => {
            void engine
              .updateMetadata({ title, language })
              .then(onMutation)
              .catch((error: unknown) => {
                const detail =
                  error instanceof Error ? error.message : 'Unknown metadata error.';
                onError(`Updating accessibility properties failed. ${detail}`);
              });
          }}
        >
          <Wrench aria-hidden="true" size={16} /> Apply title & language
        </button>
      </article>

      <article className="workflow-card">
        <h3>Accessibility check</h3>
        <button type="button" onClick={runAudit}>
          Run local check
        </button>
        {audit.length > 0 ? (
          <ul className="audit-findings" role="status">
            {audit.map((finding) => (
              <li key={finding}>
                <button
                  type="button"
                  onClick={() => {
                    const match = /Page (.+?) has/.exec(finding);
                    const page = engine.info.pages.find(
                      (candidate) => candidate.label === match?.[1],
                    );
                    if (page) onNavigate(page.index);
                  }}
                >
                  {finding}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="scope-note">
          The check reports only evidence this build can inspect. It never certifies a document
          as WCAG-conformant from a partial structure traversal.
        </p>
      </article>
      <p className="scope-note">
        <FeatureBadge status="DEGRADED" /> Inferred reading order for untagged documents needs
        review. <FeatureBadge status="EXCLUDED" /> Autotagging and reading-order repair are not
        available; correct the source document or use a dedicated tagging tool.
      </p>
    </section>
  );
}
