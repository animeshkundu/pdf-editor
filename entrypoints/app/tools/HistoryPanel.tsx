import { useEffect, useState } from 'react';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

export default function HistoryPanel({
  engine,
  onMutation,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onMutation' | 'onError'>) {
  const [journal, setJournal] = useState<Awaited<ReturnType<typeof engine.getJournal>> | null>(
    null,
  );

  useEffect(() => {
    void engine
      .getJournal()
      .then(setJournal)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown history error.';
        onError(`Loading document history failed. ${detail}`);
      });
  }, [engine, onError]);

  return (
    <section className="tool-panel" aria-label="Document history">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">MuPDF journal</span>
          <h2>History</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>
      <div className="panel-actions">
        <button
          type="button"
          disabled={!journal?.canUndo}
          title={journal?.canUndo ? undefined : 'There is no document change to undo.'}
          onClick={() => {
            void engine
              .undo()
              .then((result) => {
                setJournal(result.journal);
                onMutation(result);
              })
              .catch((error: unknown) => {
                const detail = error instanceof Error ? error.message : 'Unknown undo error.';
                onError(`Undo failed. ${detail}`);
              });
          }}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!journal?.canRedo}
          title={journal?.canRedo ? undefined : 'There is no document change to redo.'}
          onClick={() => {
            void engine
              .redo()
              .then((result) => {
                setJournal(result.journal);
                onMutation(result);
              })
              .catch((error: unknown) => {
                const detail = error instanceof Error ? error.message : 'Unknown redo error.';
                onError(`Redo failed. ${detail}`);
              });
          }}
        >
          Redo
        </button>
      </div>
      {journal?.steps.length ? (
        <ol className="history-list">
          {journal.steps.map((step, index) => (
            <li
              key={`${step}-${index}`}
              data-current={index + 1 === journal.position ? 'true' : undefined}
              data-future={index >= journal.position ? 'true' : undefined}
            >
              <span>{index + 1}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-message">
          Document changes will appear here as one step per action.
        </p>
      )}
    </section>
  );
}
