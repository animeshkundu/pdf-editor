import type * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import { Arena } from '../arena';
import type { EngineTypes } from '../../port';

export function journalState(
  document: mupdf.PDFDocument,
  revision = 0,
): EngineTypes['JournalState'] {
  const journal = document.getJournal();
  return {
    position: journal.position,
    steps: journal.steps,
    canUndo: document.canUndo(),
    canRedo: document.canRedo(),
    revision,
  };
}

export function journalHistory<T>(
  document: mupdf.PDFDocument,
  direction: 'undo' | 'redo',
  readState: () => T,
): T {
  if (direction === 'undo') document.undo();
  else document.redo();
  // Never compensate a failed read by silently reversing history. In particular, doing so
  // after undo makes the same unreadable state an inescapable trap on every retry.
  return readState();
}

export function journalOperation<T>(
  document: mupdf.PDFDocument,
  name: string,
  preflight: () => void,
  mutate: (arena: Arena) => T,
): T {
  preflight();
  document.beginOperation(name);
  const arena = new Arena();
  let result: T;
  try {
    result = mutate(arena);
  } catch (mutationError) {
    try {
      arena.release();
    } catch (releaseError) {
      try {
        document.abandonOperation();
      } catch (rollbackError) {
        throw new AggregateError(
          [mutationError, releaseError, rollbackError],
          `The failed "${name}" operation could not release its handles or be rolled back.`,
          { cause: rollbackError },
        );
      }
      throw new AggregateError(
        [mutationError, releaseError],
        `The failed "${name}" operation also could not release its handles.`,
        { cause: releaseError },
      );
    }
    try {
      document.abandonOperation();
    } catch (rollbackError) {
      throw new AggregateError(
        [mutationError, rollbackError],
        `The failed "${name}" operation could not be rolled back.`,
        { cause: rollbackError },
      );
    }
    throw mutationError;
  }

  // Once mutation succeeds, commit it before releasing temporary handles. A destructor
  // failure is cleanup damage, not a reason to discard otherwise successful document work.
  try {
    document.endOperation();
  } catch (commitError) {
    const errors: unknown[] = [commitError];
    try {
      arena.release();
    } catch (releaseError) {
      errors.push(releaseError);
    }
    try {
      document.abandonOperation();
    } catch (rollbackError) {
      errors.push(rollbackError);
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `The "${name}" operation could not be committed cleanly.`,
        {
          cause: commitError,
        },
      );
    }
    throw commitError;
  }
  arena.release();
  return result;
}

export default { journalHistory, journalOperation, journalState };
