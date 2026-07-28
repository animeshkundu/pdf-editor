import { create } from 'zustand';

export type EditorTool =
  | 'default'
  | 'note'
  | 'highlight'
  | 'free-text'
  | 'ink'
  | 'shape'
  | 'redaction-mark'
  | 'form-field';

interface ToolState {
  readonly activeTool: EditorTool;
  readonly sticky: boolean;
  readonly selectedAnnotationId: number | null;
  readonly selectedPageIndices: readonly number[];
  selectTool(tool: EditorTool, sticky?: boolean): void;
  selectAnnotation(id: number | null): void;
  selectPages(pageIndices: readonly number[]): void;
  resetTool(): void;
}

export const useToolStore = create<ToolState>((set) => ({
  activeTool: 'default',
  sticky: false,
  selectedAnnotationId: null,
  selectedPageIndices: [],
  selectTool: (activeTool, sticky = false) => set({ activeTool, sticky }),
  selectAnnotation: (selectedAnnotationId) => set({ selectedAnnotationId }),
  selectPages: (selectedPageIndices) => set({ selectedPageIndices }),
  resetTool: () => set({ activeTool: 'default', sticky: false }),
}));

export default useToolStore;
