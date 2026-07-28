import { useEffect, useState } from 'react';
import type { EngineTypes } from '@/lib/engine/port';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

export default function Security({
  engine,
  onMutation,
  onOutput,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onMutation' | 'onOutput' | 'onError'>) {
  const [state, setState] = useState<EngineTypes['OutputState'] | null>(null);
  const [encryption, setEncryption] = useState<'aes-256' | 'aes-128'>('aes-256');
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [confirmRewrite, setConfirmRewrite] = useState(false);

  useEffect(() => {
    void engine
      .getOutputState()
      .then(setState)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown security error.';
        onError(`Inspecting document security failed. ${detail}`);
      });
  }, [engine, onError]);

  return (
    <section className="tool-panel" aria-label="Security and redaction">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Protect output</span>
          <h2>Security</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>
      {state?.unappliedRedactions ? (
        <div className="warning-card" role="alert">
          <strong>Output blocked</strong>
          <p>
            {state.unappliedRedactions} unapplied redaction{' '}
            {state.unappliedRedactions === 1 ? 'mark is' : 'marks are'} present. A mark is not
            removed content.
          </p>
        </div>
      ) : null}
      <form
        className="security-form"
        onSubmit={(event) => {
          event.preventDefault();
          void engine
            .exportPdf({
              mode: 'full',
              garbage: 'deduplicate',
              compress: true,
              encrypt: encryption,
              'user-password': userPassword,
              'owner-password': ownerPassword,
              permissions: ['print', 'copy', 'annotate', 'form', 'accessibility'],
            })
            .then((data) =>
              onOutput(data, `${engine.info.name.replace(/\.pdf$/i, '')}-protected.pdf`),
            )
            .catch((error: unknown) => {
              const detail =
                error instanceof Error ? error.message : 'Unknown encryption error.';
              onError(`Creating the encrypted copy failed. ${detail}`);
            });
        }}
      >
        <label>
          <span>Encryption</span>
          <select
            value={encryption}
            onChange={(event) => setEncryption(event.target.value as typeof encryption)}
          >
            <option value="aes-256">AES-256</option>
            <option value="aes-128">AES-128 compatibility</option>
          </select>
        </label>
        <label>
          <span>Open password</span>
          <input
            type="password"
            value={userPassword}
            onChange={(event) => setUserPassword(event.target.value)}
          />
        </label>
        <label>
          <span>Permissions password</span>
          <input
            type="password"
            value={ownerPassword}
            onChange={(event) => setOwnerPassword(event.target.value)}
          />
        </label>
        <button type="submit">Create encrypted copy</button>
      </form>
      <div className="sanitize-card">
        <div>
          <strong>Sanitize</strong> <FeatureBadge status="LOCAL" />
          <p>
            Full garbage-collecting output removes the enumerated safe scope or refuses the
            document. It never reports a partial clean as success.
          </p>
        </div>
        {state?.signatures ? (
          <label>
            <input
              type="checkbox"
              checked={confirmRewrite}
              onChange={(event) => setConfirmRewrite(event.target.checked)}
            />
            I understand that a full rewrite invalidates {state.signatures} existing{' '}
            {state.signatures === 1 ? 'signature' : 'signatures'}.
          </label>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void engine
              .sanitize(confirmRewrite)
              .then((report) => {
                onMutation(report);
                onOutput(
                  report.data,
                  `${engine.info.name.replace(/\.pdf$/i, '')}-sanitized.pdf`,
                );
              })
              .catch((error: unknown) => {
                const detail =
                  error instanceof Error ? error.message : 'Unknown sanitization error.';
                onError(`Sanitizing the document failed. ${detail}`);
              });
          }}
        >
          Sanitize document and download
        </button>
      </div>
      <dl className="capability-list compact">
        <div>
          <dt>Selective apply-redaction</dt>
          <dd>
            <FeatureBadge status="EXCLUDED" /> Withdrawn after the content-stream fidelity gate
            failed. A visual cover is never called safe.
          </dd>
        </div>
        <div>
          <dt>Signing and certificate encryption</dt>
          <dd>
            <FeatureBadge status="OPEN" /> Not available. Timestamping, fresh revocation
            checking, and LTV are not provided.
          </dd>
        </div>
      </dl>
    </section>
  );
}
