import { LimitError } from '../../core/limits';
import type { EngineTypes } from '../port';

interface Destroyable {
  destroy(): void;
}

interface WorkerScope {
  postMessage(message: EngineTypes['EngineResponse'], transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<EngineTypes['EngineRequest']>) => void,
  ): void;
}

class Arena {
  readonly #handles: Destroyable[] = [];

  keep<T extends Destroyable>(handle: T): T {
    this.#handles.push(handle);
    return handle;
  }

  release(): void {
    const errors: unknown[] = [];
    for (let index = this.#handles.length - 1; index >= 0; index -= 1) {
      try {
        this.#handles[index]?.destroy();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#handles.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more MuPDF handles could not be released.');
    }
  }
}

const RETAINED = new Map<string, Destroyable>();

function retain<T extends Destroyable>(key: string, handle: T): T {
  const previous = RETAINED.get(key);
  if (previous) previous.destroy();
  RETAINED.set(key, handle);
  return handle;
}

function retained<T extends Destroyable>(key: string): T {
  const handle = RETAINED.get(key);
  if (!handle) throw new Error(`Required retained handle "${key}" is not available.`);
  return handle as T;
}

function releaseRetained(key?: string): void {
  if (key) {
    RETAINED.get(key)?.destroy();
    RETAINED.delete(key);
    return;
  }
  const handles = [...RETAINED.values()];
  RETAINED.clear();
  for (let index = handles.length - 1; index >= 0; index -= 1) {
    handles[index]?.destroy();
  }
}

async function withArena<T>(work: (arena: Arena) => T | Promise<T>): Promise<T> {
  const arena = new Arena();
  try {
    return await work(arena);
  } finally {
    arena.release();
  }
}

function serializeError(error: unknown): EngineTypes['SerializedEngineError'] {
  if (error instanceof LimitError) {
    return { name: error.name, code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { name: error.name, code: 'engine_error', message: error.message };
  }
  return {
    name: 'Error',
    code: 'engine_error',
    message: 'The document engine could not complete the operation.',
  };
}

function postSuccess(
  scope: WorkerScope,
  id: number,
  value: EngineTypes['EngineResponseValue'],
  transfer: Transferable[] = [],
): void {
  scope.postMessage({ id, ok: true, value } satisfies EngineTypes['EngineResponse'], transfer);
}

function postFailure(scope: WorkerScope, id: number, error: unknown): void {
  scope.postMessage({
    id,
    ok: false,
    error: serializeError(error),
  } satisfies EngineTypes['EngineResponse']);
}

export default {
  postFailure,
  postSuccess,
  releaseRetained,
  retain,
  retained,
  withArena,
};
