import { useEffect, useState } from 'react';
import type { EngineTypes } from '@/lib/engine/port';
import { useDocumentStore } from '@/lib/store/document';
import FeatureBadge from '../FeatureBadge';
import { describeRedactionOutcome, snapshotRedactionText } from '../redactionOutcome';
import type { ToolPanelProps } from './types';

export default function Security({
  engine,
  onMutation,
  onOutput,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onMutation' | 'onOutput' | 'onError'>) {
  const setRedactionNotice = useDocumentStore((store) => store.setRedactionNotice);
  const [state, setState] = useState<EngineTypes['OutputState'] | null>(null);
  const [encryption, setEncryption] = useState<'aes-256' | 'aes-128'>('aes-256');
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [currentOwnerPassword, setCurrentOwnerPassword] = useState('');
  const [ownerAuthenticatedEngine, setOwnerAuthenticatedEngine] = useState<
    EngineTypes['PdfEngine'] | null
  >(null);
  const authenticationRole =
    ownerAuthenticatedEngine === engine
      ? 'owner'
      : (engine.info.encryption?.authenticatedAs ?? null);
  const [ownerAuthenticationError, setOwnerAuthenticationError] = useState('');
  const [authenticatingOwner, setAuthenticatingOwner] = useState(false);
  const [confirmRewrite, setConfirmRewrite] = useState(false);
  const [redactionOutcome, setRedactionOutcome] = useState<string | null>(null);
  const [applyingRedactions, setApplyingRedactions] = useState(false);
  const security = state?.security;
  const rc4ReadOnly = security?.encryption.algorithm === 'rc4';

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
      {rc4ReadOnly ? (
        <div className="warning-card" role="alert">
          <strong>
            Weak RC4 encryption · read-only <FeatureBadge status="DEGRADED" />
          </strong>
          <p>
            {security.encryption.disclosure ??
              'RC4 encryption is broken. This PDF is open for reading only.'}
          </p>
          <p>
            Protection dictionary: V={security.encryption.version ?? 'unknown'}, R=
            {security.encryption.revision ?? 'unknown'}. Output below is restricted to a full
            garbage-collecting AES-256 replacement. RC4 is never written.
          </p>
        </div>
      ) : null}
      {security?.signatures.length ? (
        <section className="sanitize-card" aria-label="Signature coverage">
          <div>
            <strong>
              Signature fields <FeatureBadge status="DEGRADED" />
            </strong>
            <p>
              Coverage and later-revision evidence are shown separately. This is not
              cryptographic validation and does not classify changes against DocMDP or field
              locks.
            </p>
          </div>
          <ol className="capability-list compact">
            {security.signatures.map((signature, index) => (
              <li key={`${signature.name}:${index}`}>
                <strong>{signature.name}</strong>
                <p>{signature.signed ? 'Signed field' : 'Unsigned signature field'}</p>
                {signature.coveredRanges.length ? (
                  <>
                    <p>
                      Covered bytes: {signature.coveredBytes.toLocaleString()} across{' '}
                      {signature.coveredRanges.length}{' '}
                      {signature.coveredRanges.length === 1 ? 'range' : 'ranges'}.
                    </p>
                    <ul>
                      {signature.coveredRanges.map((range, rangeIndex) => (
                        <li key={`${range.offset}:${range.length}:${rangeIndex}`}>
                          [{range.offset.toLocaleString()}, {range.end.toLocaleString()}) ·{' '}
                          {range.length.toLocaleString()} bytes
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {signature.signed ? (
                  <p>
                    Current document: {signature.documentRevisions}{' '}
                    {signature.documentRevisions === 1 ? 'revision' : 'revisions'}.{' '}
                    {signature.laterChanges === true
                      ? `${signature.laterBytes?.toLocaleString() ?? 'Unknown'} later bytes exist outside the signed revision.`
                      : signature.laterChanges === false
                        ? 'No later bytes exist after the signed revision.'
                        : 'Later-byte evidence is unavailable.'}
                  </p>
                ) : null}
                {signature.changeHistoryValidationCode !== null ? (
                  <p>
                    Raw change-history evidence code: {signature.changeHistoryValidationCode}.
                    No semantic change classification is claimed.
                  </p>
                ) : null}
                {signature.issues.map((issue) => (
                  <p key={issue} role="alert">
                    {issue}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {state?.unappliedRedactions ? (
        <div className="warning-card" role="alert">
          <strong>
            Output blocked · Apply redaction marks <FeatureBadge status="DEGRADED" />
          </strong>
          <p>
            {state.unappliedRedactions} unapplied redaction{' '}
            {state.unappliedRedactions === 1 ? 'mark is' : 'marks are'} present. A mark is not
            removed content. Applying removes marked content and unblocks output.
          </p>
          <p>
            DEGRADED: redaction writes through a content-stream filter that perturbs rendering
            on some documents.
          </p>
          {state.signatures > 0 ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmRewrite}
                onChange={(event) => setConfirmRewrite(event.target.checked)}
              />
              <span>
                I understand that applying redactions invalidates {state.signatures} existing{' '}
                {state.signatures === 1 ? 'signature' : 'signatures'}.
              </span>
            </label>
          ) : null}
          <button
            type="button"
            disabled={applyingRedactions || (state.signatures > 0 && !confirmRewrite)}
            onClick={() => {
              setApplyingRedactions(true);
              setRedactionOutcome(null);
              void engine
                .listAnnotations()
                .then(async (annotations) => {
                  const redactions = annotations.filter(
                    (annotation) => annotation.type === 'Redact',
                  );
                  const before = await snapshotRedactionText(engine, redactions);
                  const report = await engine.applyRedactions(confirmRewrite);
                  onMutation(report);
                  setState((current) =>
                    current ? { ...current, unappliedRedactions: 0 } : current,
                  );
                  const after = await snapshotRedactionText(engine, redactions);
                  const notice = describeRedactionOutcome(report, before, after);
                  setRedactionOutcome(notice);
                  setRedactionNotice(notice);
                })
                .catch((error: unknown) => {
                  const detail =
                    error instanceof Error ? error.message : 'Unknown redaction error.';
                  setRedactionOutcome(detail);
                })
                .finally(() => setApplyingRedactions(false));
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
      {engine.info.encryption?.protected && authenticationRole === 'user' ? (
        <form
          className="security-form warning-card"
          onSubmit={(event) => {
            event.preventDefault();
            setAuthenticatingOwner(true);
            setOwnerAuthenticationError('');
            void engine
              .authenticateOwner(currentOwnerPassword)
              .then((info) => {
                if (info.encryption?.authenticatedAs === 'owner') {
                  setOwnerAuthenticatedEngine(engine);
                }
                setCurrentOwnerPassword('');
              })
              .catch((error: unknown) => {
                const detail =
                  error instanceof Error ? error.message : 'Unknown authentication error.';
                setOwnerAuthenticationError(detail);
              })
              .finally(() => setAuthenticatingOwner(false));
          }}
        >
          <strong>Owner controls are locked</strong>
          <p>
            This PDF opened with reader permissions. Authenticate its current owner password
            before changing protection or permissions.
          </p>
          <label>
            <span>Current owner password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentOwnerPassword}
              disabled={authenticatingOwner}
              onChange={(event) => setCurrentOwnerPassword(event.target.value)}
            />
          </label>
          {ownerAuthenticationError ? <p role="alert">{ownerAuthenticationError}</p> : null}
          <button type="submit" disabled={authenticatingOwner}>
            {authenticatingOwner ? 'Authenticating…' : 'Unlock owner controls'}
          </button>
        </form>
      ) : authenticationRole === 'owner' ? (
        <p className="result-summary" role="status">
          Owner controls unlocked for this local session.
        </p>
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
              encrypt: rc4ReadOnly ? 'aes-256' : encryption,
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
            value={rc4ReadOnly ? 'aes-256' : encryption}
            disabled={rc4ReadOnly}
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
        <button type="submit">
          {rc4ReadOnly ? 'Replace RC4 with AES-256 copy' : 'Create encrypted copy'}
        </button>
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
            <FeatureBadge status="DEGRADED" /> Removes marked content through a content-stream
            filter. Refused when object metadata, marked-content property dictionaries, or Form
            XObject content prevents proving removal.
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
