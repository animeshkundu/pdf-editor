import type * as mupdf from '../../../vendor/mupdf-wasm/dist/mupdf.js';
import { persistenceSnapshot } from './save';

// The engine admits at most sixteen executions at 16 MiB each for one document lifetime.
// MuJS does not refund its allowance when memory is released, so project the full cumulative
// allowance before creating the context. Console evaluation clones the PDF and temporarily
// owns a separately bounded context that is destroyed before the request returns.
export const JAVASCRIPT_EXECUTION_MEMORY_ALLOWANCE = 16 << 20;
export const JAVASCRIPT_EXECUTION_LIMIT = 16;
export const JAVASCRIPT_CONTEXT_MEMORY_LIMIT =
  JAVASCRIPT_EXECUTION_MEMORY_ALLOWANCE * JAVASCRIPT_EXECUTION_LIMIT;

export function javaScriptContextProjection(hasScripts: boolean): number {
  return hasScripts ? JAVASCRIPT_CONTEXT_MEMORY_LIMIT : 0;
}

export class DocumentSizeAccounting {
  #bytes = 0;

  get bytes(): number {
    return this.#bytes;
  }

  reset(bytes: number): void {
    this.#bytes = bytes;
  }

  refresh(document: mupdf.PDFDocument): void {
    // A garbage-collected snapshot measures the current reachable document after mutation,
    // undo, redo, deletion, or rollback. Accumulated projections never repay journal
    // reversals and eventually deny every operation in a long editing session.
    this.#bytes = persistenceSnapshot(document).byteLength;
  }
}

export default {
  DocumentSizeAccounting,
  JAVASCRIPT_CONTEXT_MEMORY_LIMIT,
  JAVASCRIPT_EXECUTION_LIMIT,
  JAVASCRIPT_EXECUTION_MEMORY_ALLOWANCE,
  javaScriptContextProjection,
};
