import type { EngineTypes } from '@/lib/engine/port';

export interface ToolPanelProps {
  readonly engine: EngineTypes['PdfEngine'];
  readonly onMutation: (result: EngineTypes['MutationResult']) => void;
  readonly onNavigate: (pageIndex: number) => void;
  readonly onOutput: (data: ArrayBuffer, name: string) => void;
  readonly onRotateView: (degrees: 90 | -90) => void;
  readonly onError: (message: string) => void;
}
