import {
  assertFileSize,
  assertHeadroom,
  budgetFor,
  isIosLike,
  type Budget,
} from '../core/limits';
import engineErrors, { type EngineTypes } from './port';

type DocumentInfo = EngineTypes['DocumentInfo'];
type EngineRequest = EngineTypes['EngineRequest'];
type EngineResponse = EngineTypes['EngineResponse'];
type EngineResponseValue = EngineTypes['EngineResponseValue'];
type PageText = EngineTypes['PageText'];
type PdfEngine = EngineTypes['PdfEngine'];
type PdfEngineFactory = EngineTypes['PdfEngineFactory'];
type PdfPoint = EngineTypes['PdfPoint'];
type SearchResult = EngineTypes['SearchResult'];
type TextSelection = EngineTypes['TextSelection'];
type TileRequest = EngineTypes['TileRequest'];
type TileResult = EngineTypes['TileResult'];
const { EngineRequestError, WorkerCrashedError } = engineErrors;

interface WorkerLike {
  postMessage(message: EngineRequest, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<EngineResponse>) => void,
  ): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
  terminate(): void;
}

interface PendingRequest {
  readonly resolve: (value: EngineResponseValue) => void;
  readonly reject: (reason: unknown) => void;
  readonly cleanup: () => void;
  abortReason: unknown | null;
}

interface PendingTile {
  readonly request: TileRequest;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: TileResult) => void;
  readonly reject: (reason: unknown) => void;
  readonly removeAbortListener: () => void;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was cancelled.', 'AbortError');
}

class WorkerRpc {
  readonly #pending = new Map<number, PendingRequest>();
  readonly #ready: Promise<void>;
  readonly #resolveReady: () => void;
  readonly #startupTimer: ReturnType<typeof setTimeout>;
  #nextId = 1;
  #closed = false;

  constructor(
    private readonly worker: WorkerLike,
    private readonly requestTimeoutMs = 60_000,
  ) {
    let resolveReady: () => void = () => undefined;
    this.#ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    this.#resolveReady = resolveReady;
    this.#startupTimer = setTimeout(() => {
      this.#shutDown(
        new WorkerCrashedError(
          'The document engine did not start. Reopen the document to retry.',
        ),
      );
    }, 30_000);
    worker.addEventListener('message', this.#onMessage);
    worker.addEventListener('error', this.#onDeath);
    worker.addEventListener('messageerror', this.#onDeath);
  }

  request<T>(
    request: Omit<EngineRequest, 'id'>,
    transfer: Transferable[] = [],
    signal?: AbortSignal,
    waitForResponseAfterAbort = false,
  ): Promise<T> {
    if (this.#closed) return Promise.reject(new WorkerCrashedError());
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const reason = signal
          ? abortReason(signal)
          : new DOMException('The operation was cancelled.', 'AbortError');
        if (waitForResponseAfterAbort) {
          const pending = this.#pending.get(id);
          if (pending) pending.abortReason = reason;
          signal?.removeEventListener('abort', abort);
          return;
        }
        this.worker.postMessage({
          id: this.#nextId++,
          operation: 'cancel',
          payload: { requestId: id },
        });
        this.#pending.delete(id);
        cleanup();
        reject(reason);
      };
      const cleanup = () => {
        clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
      };
      const deadline = setTimeout(() => {
        this.#shutDown(
          new WorkerCrashedError(
            `The document engine timed out while running ${request.operation}. Reopen the document to retry.`,
          ),
        );
      }, this.requestTimeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup,
        abortReason: null,
      });
      signal?.addEventListener('abort', abort, { once: true });
      void this.#ready.then(() => {
        if (this.#pending.has(id) && !this.#closed) {
          this.worker.postMessage({ ...request, id } as EngineRequest, transfer);
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.request<void>({ operation: 'close', payload: {} });
    } finally {
      this.#shutDown(new WorkerCrashedError('The document was closed.', 'engine_closed'));
    }
  }

  #onMessage = (event: MessageEvent<EngineResponse>) => {
    if (event.data.id === 0 && event.data.ok) {
      clearTimeout(this.#startupTimer);
      this.#resolveReady();
      return;
    }
    const pending = this.#pending.get(event.data.id);
    if (!pending) return;
    this.#pending.delete(event.data.id);
    pending.cleanup();
    if (pending.abortReason !== null) {
      pending.reject(pending.abortReason);
      return;
    }
    if (event.data.ok) {
      pending.resolve(event.data.value);
    } else {
      pending.reject(new EngineRequestError(event.data.error.code, event.data.error.message));
    }
  };

  #onDeath = () => this.#shutDown(new WorkerCrashedError());

  #shutDown(error: InstanceType<typeof WorkerCrashedError>) {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#startupTimer);
    this.#resolveReady();
    this.worker.terminate();
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(pending.abortReason ?? error);
    }
    this.#pending.clear();
  }
}

class WorkerPdfEngine implements PdfEngine {
  readonly #tileQueue: PendingTile[] = [];
  #searchRpcPromise: Promise<WorkerRpc> | null = null;
  #renderingTile = false;
  #closed = false;

  private constructor(
    readonly info: DocumentInfo,
    private readonly documentRpc: WorkerRpc,
    private readonly sourceFile: File,
    private readonly budget: Budget,
    private readonly ios: boolean,
  ) {}

  static async open(file: File, signal?: AbortSignal): Promise<WorkerPdfEngine> {
    const budget = budgetFor(navigator);
    assertFileSize(file.size, budget);
    assertHeadroom(0, file.size * 2, budget);
    const bytes = await file.arrayBuffer();
    if (signal?.aborted) throw abortReason(signal);

    const documentRpc = new WorkerRpc(
      new Worker(new URL('./worker/doc.worker.ts', import.meta.url), { type: 'module' }),
    );
    const ios = isIosLike(navigator);

    try {
      const info = await documentRpc.request<DocumentInfo>(
        { operation: 'open', payload: { name: file.name, ios, data: bytes } },
        [bytes],
        signal,
      );
      return new WorkerPdfEngine(info, documentRpc, file, budget, ios);
    } catch (error) {
      await documentRpc.close().catch(() => undefined);
      throw error;
    }
  }

  renderTile(request: TileRequest, signal?: AbortSignal): Promise<TileResult> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise<TileResult>((resolve, reject) => {
      const abort = () => {
        const index = this.#tileQueue.indexOf(job);
        if (index < 0) return;
        this.#tileQueue.splice(index, 1);
        signal?.removeEventListener('abort', abort);
        reject(signal ? abortReason(signal) : new DOMException('Cancelled', 'AbortError'));
      };
      const job: PendingTile = {
        request,
        signal,
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.#tileQueue.push(job);
      this.#tileQueue.sort(
        (left, right) =>
          (left.request.priority ?? Number.MAX_SAFE_INTEGER) -
          (right.request.priority ?? Number.MAX_SAFE_INTEGER),
      );
      this.#renderNextTile();
    });
  }

  getPageText(pageIndex: number, signal?: AbortSignal): Promise<PageText> {
    return this.documentRpc.request<PageText>(
      { operation: 'getPageText', payload: { pageIndex } },
      [],
      signal,
    );
  }

  selectText(
    pageIndex: number,
    start: PdfPoint,
    end: PdfPoint,
    signal?: AbortSignal,
  ): Promise<TextSelection> {
    return this.documentRpc.request<TextSelection>(
      { operation: 'selectText', payload: { pageIndex, start, end } },
      [],
      signal,
    );
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const searchRpc = await this.#getSearchRpc();
    return searchRpc.request<SearchResult>(
      { operation: 'search', payload: { query } },
      [],
      signal,
    );
  }

  readAttachment(id: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    return this.documentRpc.request<ArrayBuffer>(
      { operation: 'readAttachment', payload: { id } },
      [],
      signal,
    );
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const tile of this.#tileQueue.splice(0)) {
      tile.removeAbortListener();
      tile.reject(new WorkerCrashedError('The document was closed.', 'engine_closed'));
    }
    const searchRpcPromise = this.#searchRpcPromise;
    this.#searchRpcPromise = null;
    await Promise.all([
      this.documentRpc.close(),
      searchRpcPromise
        ? searchRpcPromise.then((searchRpc) => searchRpc.close()).catch(() => undefined)
        : Promise.resolve(),
    ]);
  }

  #getSearchRpc(): Promise<WorkerRpc> {
    if (this.#closed) {
      return Promise.reject(
        new WorkerCrashedError('The document was closed.', 'engine_closed'),
      );
    }
    if (this.#searchRpcPromise) return this.#searchRpcPromise;
    assertHeadroom(this.sourceFile.size, this.sourceFile.size * 2, this.budget);
    const pending = this.#createSearchRpc();
    this.#searchRpcPromise = pending;
    void pending.catch(() => {
      if (this.#searchRpcPromise === pending) this.#searchRpcPromise = null;
    });
    return pending;
  }

  async #createSearchRpc(): Promise<WorkerRpc> {
    const bytes = await this.sourceFile.arrayBuffer();
    if (this.#closed) {
      throw new WorkerCrashedError('The document was closed.', 'engine_closed');
    }
    const searchRpc = new WorkerRpc(
      new Worker(new URL('./worker/search.worker.ts', import.meta.url), { type: 'module' }),
    );
    try {
      await searchRpc.request<void>(
        {
          operation: 'open',
          payload: { name: this.sourceFile.name, ios: this.ios, data: bytes },
        },
        [bytes],
      );
      return searchRpc;
    } catch (error) {
      await searchRpc.close().catch(() => undefined);
      throw error;
    }
  }

  #renderNextTile(): void {
    if (this.#renderingTile) return;
    const next = this.#tileQueue.shift();
    if (!next) return;
    if (next.signal?.aborted) {
      next.removeAbortListener();
      next.reject(abortReason(next.signal));
      this.#renderNextTile();
      return;
    }
    this.#renderingTile = true;
    void this.documentRpc
      .request<TileResult>(
        { operation: 'renderTile', payload: next.request },
        [],
        next.signal,
        true,
      )
      .then(next.resolve, next.reject)
      .finally(() => {
        next.removeAbortListener();
        this.#renderingTile = false;
        this.#renderNextTile();
      });
  }
}

const openPdfEngine: PdfEngineFactory = WorkerPdfEngine.open;

export default { openPdfEngine, WorkerRpc };
