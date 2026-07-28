import type * as mupdf from '../../../../vendor/mupdf-wasm/dist/mupdf.js';
import { withArenaSync, type Arena } from '../arena';
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

export function journalOperation<T>(
  document: mupdf.PDFDocument,
  name: string,
  preflight: () => void,
  mutate: (arena: Arena) => T,
): T {
  preflight();
  document.beginOperation(name);
  let operationOpen = true;
  try {
    const result = withArenaSync(mutate);
    document.endOperation();
    operationOpen = false;
    return result;
  } catch (error) {
    if (operationOpen) {
      try {
        document.abandonOperation();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `The failed "${name}" operation could not be rolled back.`,
          { cause: rollbackError },
        );
      }
    }
    throw error;
  }
}

export default { journalOperation, journalState };
