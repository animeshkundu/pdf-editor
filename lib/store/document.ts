import { create } from 'zustand';
import type { EngineTypes } from '../engine/port';

interface DocumentState {
  readonly engine: EngineTypes['PdfEngine'] | null;
  readonly journal: EngineTypes['JournalState'];
  readonly output: EngineTypes['OutputState'] | null;
  readonly persistenceError: string | null;
  readonly dirty: boolean;
  readonly savedJournalRevision: number;
  setEngine(engine: EngineTypes['PdfEngine'] | null): void;
  applyMutation(result: EngineTypes['MutationResult']): void;
  setOutput(output: EngineTypes['OutputState']): void;
  handleEngineEvent(event: EngineTypes['EngineEvent']): void;
  markSaved(): void;
  markRecovered(): void;
  clear(): void;
}

const EMPTY_JOURNAL: EngineTypes['JournalState'] = {
  position: 0,
  steps: [],
  canUndo: false,
  canRedo: false,
  revision: 0,
};

export const useDocumentStore = create<DocumentState>((set) => ({
  engine: null,
  journal: EMPTY_JOURNAL,
  output: null,
  persistenceError: null,
  dirty: false,
  savedJournalRevision: 0,
  setEngine: (engine) =>
    set({
      engine,
      journal: EMPTY_JOURNAL,
      output: null,
      persistenceError: null,
      dirty: false,
      savedJournalRevision: 0,
    }),
  applyMutation: (result) =>
    set((state) => ({
      journal: result.journal,
      dirty: result.journal.revision !== state.savedJournalRevision,
    })),
  setOutput: (output) => set({ output }),
  handleEngineEvent: (event) => {
    if (event.event === 'persistence-error') set({ persistenceError: event.message });
    else if (!event.available)
      set({ persistenceError: event.reason ?? 'Crash recovery is unavailable.' });
  },
  markSaved: () =>
    set((state) => ({
      dirty: false,
      savedJournalRevision: state.journal.revision,
    })),
  markRecovered: () => set({ dirty: true }),
  clear: () =>
    set({
      engine: null,
      journal: EMPTY_JOURNAL,
      output: null,
      persistenceError: null,
      dirty: false,
      savedJournalRevision: 0,
    }),
}));

export default useDocumentStore;
