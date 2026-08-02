import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, Play, Plus, Upload, Workflow } from 'lucide-react';
import commandRegistry, {
  COMMANDS,
  type Pipeline,
  type ResolvedCommand,
} from '@/lib/commands/registry';
import type { EngineTypes } from '@/lib/engine/port';
import { DesignedSelect } from '../DesignedControls';
import FeatureBadge from '../FeatureBadge';

function downloadPipeline(pipeline: Pipeline): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(pipeline, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${pipeline.name.trim().replace(/\s+/g, '-').toLocaleLowerCase() || 'pipeline'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AutomationBuilder({
  engine,
  commands,
  onError,
}: {
  readonly engine: EngineTypes['PdfEngine'];
  readonly commands: readonly ResolvedCommand[];
  readonly onError: (message: string) => void;
}) {
  const [name, setName] = useState('Local document output');
  const [steps, setSteps] = useState<readonly string[]>([]);
  const [candidate, setCandidate] = useState('save');
  const [preview, setPreview] = useState<ReturnType<
    typeof commandRegistry.parsePipeline
  > | null>(null);
  const [running, setRunning] = useState(false);
  const [consoleSource, setConsoleSource] = useState(
    'console.println("Local PDF JavaScript");\n2 + 2;',
  );
  const [consoleResult, setConsoleResult] = useState<
    EngineTypes['JavaScriptExecutionResult'] | null
  >(null);
  const [runningConsole, setRunningConsole] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const safe = useMemo(() => COMMANDS.filter((command) => command.pipelineSafe), []);
  const pipeline: Pipeline = {
    version: 1,
    name,
    steps: steps.map((commandId) => ({ commandId })),
  };

  const execute = async (value: Pipeline) => {
    setRunning(true);
    try {
      const resolved = new Map(commands.map((command) => [command.id, command]));
      for (const step of value.steps) {
        const command = resolved.get(step.commandId);
        if (!command) throw new Error(`Unknown command "${step.commandId}".`);
        if (command.disabled) {
          throw new Error(command.disabledReason ?? `"${command.label}" is unavailable.`);
        }
        await command.run();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown automation error.';
      onError(`Running the pipeline failed. ${detail}`);
    } finally {
      setRunning(false);
    }
  };

  const importPipeline = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file
      .text()
      .then((value) => commandRegistry.parsePipeline(value))
      .then(setPreview)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown pipeline error.';
        onError(`Importing the pipeline failed. ${detail}`);
      });
  };

  return (
    <section className="tool-panel" aria-label="Automation pipeline builder">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">No-code local actions</span>
          <h2>Automation</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>
      <p id="pipeline-step-help" className="panel-intro">
        Build from the same registry as the toolbar and command palette. Imported pipelines are
        shown first and never execute on import. Add at least one step before running or
        exporting.
      </p>
      <label>
        <span>Pipeline name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="pipeline-add">
        <DesignedSelect
          label="Pipeline command"
          value={candidate}
          options={safe.map((command) => ({
            value: command.id,
            label: `${typeof command.label === 'string' ? command.label : command.id} · ${
              command.status
            }`,
          }))}
          onValueChange={setCandidate}
        />
        <button type="button" onClick={() => setSteps((current) => [...current, candidate])}>
          <Plus aria-hidden="true" size={15} /> Add step
        </button>
      </div>
      <ol className="pipeline-steps">
        {steps.map((id, index) => {
          const definition = COMMANDS.find((command) => command.id === id);
          return (
            <li key={`${id}-${index}`}>
              <Workflow aria-hidden="true" size={15} />
              <span>
                {definition && typeof definition.label === 'string' ? definition.label : id}
              </span>
              <FeatureBadge status={definition?.status ?? 'OPEN'} />
              <button
                type="button"
                aria-label={`Remove step ${index + 1}`}
                onClick={() =>
                  setSteps((current) =>
                    current.filter((_step, stepIndex) => stepIndex !== index),
                  )
                }
              >
                Remove
              </button>
            </li>
          );
        })}
      </ol>
      <div className="panel-actions">
        <button
          type="button"
          disabled={steps.length === 0 || running}
          aria-describedby="pipeline-step-help"
          onClick={() => void execute(pipeline)}
        >
          <Play aria-hidden="true" size={15} /> {running ? 'Running…' : 'Run pipeline'}
        </button>
        <button
          type="button"
          disabled={steps.length === 0}
          aria-describedby="pipeline-step-help"
          onClick={() => downloadPipeline(pipeline)}
        >
          <Download aria-hidden="true" size={15} /> Export pipeline
        </button>
        <button type="button" onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" size={15} /> Import pipeline
        </button>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept="application/json,.json"
        aria-label="Import automation pipeline"
        onChange={importPipeline}
      />
      {preview ? (
        <div className="result-preview" role="status">
          <strong>Imported pipeline preview · {preview.pipeline.name}</strong>
          <ol>
            {preview.commands.map((command) => (
              <li key={command.id}>
                {command.label} <FeatureBadge status={command.status} />
              </li>
            ))}
          </ol>
          <div className="panel-actions">
            <button
              type="button"
              onClick={() => {
                setName(preview.pipeline.name);
                setSteps(preview.pipeline.steps.map((step) => step.commandId));
                setPreview(null);
              }}
            >
              Add to builder
            </button>
            <button type="button" onClick={() => setPreview(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : null}
      <fieldset className="workflow-group">
        <legend>
          Document JavaScript console <FeatureBadge status="LOCAL" />
        </legend>
        <p id="javascript-console-help" className="scope-note">
          Run MuJS against a disposable snapshot in this document&apos;s isolated worker.
          Evaluation cannot change the open PDF. Network APIs are absent; external requests are
          observed and blocked. Enter JavaScript before running it.
        </p>
        <label>
          <span>JavaScript source</span>
          <textarea
            rows={8}
            spellCheck={false}
            value={consoleSource}
            onChange={(event) => setConsoleSource(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary-action"
          disabled={runningConsole || !consoleSource.trim()}
          aria-describedby="javascript-console-help"
          onClick={() => {
            setRunningConsole(true);
            void engine
              .executeJavaScript(consoleSource)
              .then((result) => {
                setConsoleResult(result);
              })
              .catch((error: unknown) => {
                const detail =
                  error instanceof Error ? error.message : 'Unknown JavaScript console error.';
                onError(`Running document JavaScript failed. ${detail}`);
              })
              .finally(() => setRunningConsole(false));
          }}
        >
          <Play aria-hidden="true" size={15} />{' '}
          {runningConsole ? 'Running JavaScript…' : 'Run JavaScript'}
        </button>
        {consoleResult ? (
          <div className="result-preview" role="status">
            <strong>Console result</strong>
            <pre>{consoleResult.result}</pre>
            {consoleResult.events.length > 0 ? (
              <ul>
                {consoleResult.events.map((event, index) => (
                  <li key={`${event.type}-${index}`}>
                    {event.type}: {event.detail} {event.blocked ? 'Blocked.' : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      <p className="scope-note">
        <FeatureBadge status="EXCLUDED" /> Acrobat Action Wizard files and folder-level scripts
        are never interpreted. <FeatureBadge status="LOCAL" /> Document scripts and the
        authoring console run only inside the document worker.
      </p>
    </section>
  );
}
