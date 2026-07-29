import { useDocumentStore } from '../lib/store/document';

const document = {
  name: 'contract.pdf',
  title: 'Contract',
  pages: [],
  outline: [],
  attachments: [],
  permissions: { copy: true, print: true, annotate: true },
} as const;

describe('PAGE-020 journal-derived dirty state', () => {
  beforeEach(() => useDocumentStore.getState().clear());

  it('keeps a divergent edit dirty even when it reuses the saved journal position', () => {
    useDocumentStore.getState().applyMutation({
      document,
      journal: {
        position: 1,
        steps: ['First edit'],
        canUndo: true,
        canRedo: false,
        revision: 1,
      },
    });
    useDocumentStore.getState().markSaved();
    expect(useDocumentStore.getState().dirty).toBe(false);

    useDocumentStore.getState().applyMutation({
      document,
      journal: {
        position: 1,
        steps: ['Divergent edit'],
        canUndo: true,
        canRedo: false,
        revision: 3,
      },
    });
    expect(useDocumentStore.getState().dirty).toBe(true);
  });
});
