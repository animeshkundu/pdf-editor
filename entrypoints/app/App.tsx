import EditorShell from './EditorShell';
import engineClient from '@/lib/engine/client';
import type { EngineTypes } from '@/lib/engine/port';

type PdfEngineFactory = EngineTypes['PdfEngineFactory'];

export default function App({
  engineFactory = engineClient.openPdfEngine,
}: {
  readonly engineFactory?: PdfEngineFactory;
}) {
  return <EditorShell engineFactory={engineFactory} />;
}
