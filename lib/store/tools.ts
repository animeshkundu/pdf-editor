import { create } from 'zustand';
import type { EngineTypes } from '@/lib/engine/port';

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
  readonly formFields: readonly EngineTypes['FormFieldInfo'][];
  readonly formFieldsHighlighted: boolean;
  selectTool(tool: EditorTool, sticky?: boolean): void;
  selectAnnotation(id: number | null): void;
  selectPages(pageIndices: readonly number[]): void;
  setFormOverlay(fields: readonly EngineTypes['FormFieldInfo'][], highlighted: boolean): void;
  resetTool(): void;
}

export const useToolStore = create<ToolState>((set) => ({
  activeTool: 'default',
  sticky: false,
  selectedAnnotationId: null,
  selectedPageIndices: [],
  formFields: [],
  formFieldsHighlighted: false,
  selectTool: (activeTool, sticky = false) => set({ activeTool, sticky }),
  selectAnnotation: (selectedAnnotationId) => set({ selectedAnnotationId }),
  selectPages: (selectedPageIndices) => set({ selectedPageIndices }),
  setFormOverlay: (formFields, formFieldsHighlighted) =>
    set({ formFields, formFieldsHighlighted }),
  resetTool: () => set({ activeTool: 'default', sticky: false }),
}));

export default useToolStore;
