import EditorShell from './EditorShell';
import engineClient from '@/lib/engine/client';
import type { EngineTypes } from '@/lib/engine/port';
import * as Tooltip from '@radix-ui/react-tooltip';

type PdfEngineFactory = EngineTypes['PdfEngineFactory'];

export default function App({
  engineFactory = engineClient.openPdfEngine,
}: {
  readonly engineFactory?: PdfEngineFactory;
}) {
  return (
    <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
      <EditorShell engineFactory={engineFactory} />
    </Tooltip.Provider>
  );
}
