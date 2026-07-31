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
type EngineEvent = EngineTypes['EngineEvent'];
type EngineResponseValue = EngineTypes['EngineResponseValue'];
type WorkerMessage = EngineTypes['WorkerMessage'];
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
    listener: (event: MessageEvent<WorkerMessage>) => void,
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
  readonly #eventListeners = new Set<(event: EngineEvent) => void>();
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

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  #onMessage = (event: MessageEvent<WorkerMessage>) => {
    if ('event' in event.data) {
      for (const listener of this.#eventListeners) listener(event.data);
      return;
    }
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
  #renderIdle: Promise<void> = Promise.resolve();
  #closed = false;
  #info: DocumentInfo;
  #documentRevision = 0;

  private constructor(
    info: DocumentInfo,
    private readonly documentRpc: WorkerRpc,
    private readonly sourceFile: File,
    private readonly budget: Budget,
    private readonly ios: boolean,
    private readonly password?: string,
  ) {
    this.#info = info;
  }

  get info(): DocumentInfo {
    return this.#info;
  }

  static async open(
    file: File,
    signal?: AbortSignal,
    password?: string,
  ): Promise<WorkerPdfEngine> {
    const budget = budgetFor(navigator);
    assertFileSize(file.size, budget);
    assertHeadroom(0, file.size * 2, budget);
    const persistenceKey = await documentPersistenceKey(file);
    const bytes = await file.arrayBuffer();
    if (signal?.aborted) throw abortReason(signal);

    const documentRpc = new WorkerRpc(
      new Worker(new URL('./worker/doc.worker.ts', import.meta.url), { type: 'module' }),
    );
    const ios = isIosLike(navigator);

    try {
      const info = await documentRpc.request<DocumentInfo>(
        {
          operation: 'open',
          payload: {
            name: file.name,
            ios,
            data: bytes,
            persistenceKey,
            ...(password === undefined ? {} : { password }),
          },
        },
        [bytes],
        signal,
      );
      return new WorkerPdfEngine(info, documentRpc, file, budget, ios, password);
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

  listAnnotations(pageIndex?: number): Promise<readonly EngineTypes['AnnotationInfo'][]> {
    return this.documentRpc.request({
      operation: 'listAnnotations',
      payload: pageIndex === undefined ? {} : { pageIndex },
    });
  }

  async addAnnotation(
    input: EngineTypes['AnnotationInput'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>(
        {
          operation: 'addAnnotation',
          payload: input,
        },
        [input.stampImage, input.attachment?.data].filter(
          (value): value is ArrayBuffer => value !== undefined,
        ),
      ),
    );
  }

  async editExistingText(
    input: EngineTypes['ExistingTextEditInput'],
  ): Promise<EngineTypes['ExistingTextEditReport']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['ExistingTextEditReport']>({
        operation: 'editExistingText',
        payload: input,
      }),
    ) as EngineTypes['ExistingTextEditReport'];
  }

  async addAnnotations(
    inputs: readonly EngineTypes['AnnotationInput'][],
  ): Promise<EngineTypes['MutationResult']> {
    const transfer = inputs.flatMap((input) =>
      [input.stampImage, input.attachment?.data].filter(
        (value): value is ArrayBuffer => value !== undefined,
      ),
    );
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>(
        {
          operation: 'addAnnotations',
          payload: { inputs },
        },
        transfer,
      ),
    );
  }

  async updateAnnotation(
    pageIndex: number,
    annotationId: number,
    changes: EngineTypes['AnnotationUpdate'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>(
        {
          operation: 'updateAnnotation',
          payload: { pageIndex, annotationId, changes },
        },
        [changes.stampImage, changes.attachment?.data].filter(
          (value): value is ArrayBuffer => value !== undefined,
        ),
      ),
    );
  }

  async deleteAnnotation(
    pageIndex: number,
    annotationId: number,
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'deleteAnnotation',
        payload: { pageIndex, annotationId },
      }),
    );
  }

  async reorderPages(order: readonly number[]): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'reorderPages',
        payload: { order },
      }),
    );
  }

  async rotatePages(
    pageIndices: readonly number[],
    degrees: 90 | 180 | 270 | -90 | -180 | -270,
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'rotatePages',
        payload: { pageIndices, degrees },
      }),
    );
  }

  async insertBlankPage(
    at: number,
    size?: EngineTypes['PdfRect'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'insertBlankPage',
        payload: size === undefined ? { at } : { at, size },
      }),
    );
  }

  async deletePages(pageIndices: readonly number[]): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'deletePages',
        payload: { pageIndices },
      }),
    );
  }

  async setPageBoxes(
    pageIndices: readonly number[],
    box: EngineTypes['PageBox'],
    rect: EngineTypes['PdfRect'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'setPageBoxes',
        payload: { pageIndices, box, rect },
      }),
    );
  }

  async setPageLabels(
    at: number,
    style: EngineTypes['PageLabelStyle'],
    prefix: string,
    start: number,
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'setPageLabels',
        payload: { at, style, prefix, start },
      }),
    );
  }

  async extractPages(
    pageIndices: readonly number[],
    deleteOriginals = false,
  ): Promise<EngineTypes['ExportedPdf']> {
    const output = await this.#mutationRequest<EngineTypes['ExportedPdf']>({
      operation: 'extractPages',
      payload: { pageIndices, deleteOriginals },
    });
    if (deleteOriginals) await this.#refreshInfo(true);
    return output;
  }

  async mergeDocument(
    name: string,
    data: ArrayBuffer,
    insertAt: number,
    sourcePages?: readonly number[],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>(
        {
          operation: 'mergeDocument',
          payload:
            sourcePages === undefined
              ? { name, data, insertAt }
              : { name, data, insertAt, sourcePages },
        },
        [data],
      ),
    );
  }

  async composePages(
    name: string,
    order: readonly EngineTypes['PageCompositionItem'][],
    data?: ArrayBuffer,
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>(
        {
          operation: 'composePages',
          payload: data === undefined ? { name, order } : { name, order, data },
        },
        data === undefined ? [] : [data],
      ),
    );
  }

  inspectIncomingDocument(
    name: string,
    data: ArrayBuffer,
  ): Promise<EngineTypes['IncomingDocumentInfo']> {
    return this.documentRpc.request(
      {
        operation: 'inspectIncomingDocument',
        payload: { name, data },
      },
      [data],
    );
  }

  compareDocument(name: string, data: ArrayBuffer): Promise<EngineTypes['CompareResult']> {
    return this.documentRpc.request(
      {
        operation: 'compareDocument',
        payload: { name, data },
      },
      [data],
    );
  }

  validatePdfA(): Promise<EngineTypes['PdfAReport']> {
    return this.documentRpc.request({ operation: 'validatePdfA', payload: {} });
  }

  splitDocument(
    ranges: readonly (readonly [number, number])[],
  ): Promise<readonly EngineTypes['ExportedPdf'][]> {
    return this.documentRpc.request({
      operation: 'splitDocument',
      payload: { ranges },
    });
  }

  listFields(): Promise<readonly EngineTypes['FormFieldInfo'][]> {
    return this.documentRpc.request({ operation: 'listFields', payload: {} });
  }

  async setFieldValue(
    name: string,
    value: string | boolean,
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'setFieldValue',
        payload: { name, value },
      }),
    );
  }

  async setFieldValues(
    values: Readonly<Record<string, string | boolean>>,
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'setFieldValues',
        payload: { values },
      }),
    );
  }

  async createFormField(
    input: EngineTypes['FormFieldInput'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'createFormField',
        payload: input,
      }),
    );
  }

  async updateFormField(
    name: string,
    changes: EngineTypes['FormFieldUpdate'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'updateFormField',
        payload: { name, changes },
      }),
    );
  }

  async updateFormFields(
    updates: readonly {
      readonly name: string;
      readonly changes: EngineTypes['FormFieldUpdate'];
    }[],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'updateFormFields',
        payload: { updates },
      }),
    );
  }

  async reorderFormFields(names: readonly string[]): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'reorderFormFields',
        payload: { names },
      }),
    );
  }

  async resetForm(): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'resetForm',
        payload: {},
      }),
    );
  }

  getJavaScriptState(): Promise<EngineTypes['JavaScriptState']> {
    return this.documentRpc.request({ operation: 'getJavaScriptState', payload: {} });
  }

  async setJavaScriptAction(
    input: EngineTypes['JavaScriptActionInput'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'setJavaScriptAction',
        payload: input,
      }),
    );
  }

  async deleteJavaScriptAction(
    input: EngineTypes['JavaScriptActionIdentity'],
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'deleteJavaScriptAction',
        payload: input,
      }),
    );
  }

  async executeJavaScript(source: string): Promise<EngineTypes['JavaScriptExecutionResult']> {
    return this.#mutationRequest<EngineTypes['JavaScriptExecutionResult']>({
      operation: 'executeJavaScript',
      payload: { source },
    });
  }

  async authenticateOwner(password: string): Promise<DocumentInfo> {
    const info = await this.documentRpc.request<DocumentInfo>({
      operation: 'authenticateOwner',
      payload: { password },
    });
    this.#info = info;
    return info;
  }

  async updateMetadata(
    values: Readonly<
      Partial<Record<'title' | 'author' | 'subject' | 'keywords' | 'language', string>>
    >,
  ): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'updateMetadata',
        payload: { values },
      }),
    );
  }

  save(options: EngineTypes['SaveOptions']): Promise<ArrayBuffer> {
    return this.#mutationRequest({ operation: 'save', payload: options });
  }

  exportPdf(options: EngineTypes['SaveOptions']): Promise<ArrayBuffer> {
    return this.#mutationRequest({ operation: 'exportPdf', payload: options });
  }

  async applyRedactions(
    confirmSignatureInvalidation: boolean,
  ): Promise<EngineTypes['ApplyRedactionsReport']> {
    const report = await this.#mutationRequest<EngineTypes['ApplyRedactionsReport']>({
      operation: 'applyRedactions',
      payload: { confirmSignatureInvalidation },
    });
    this.#acceptMutation(report);
    return report;
  }

  async redactPages(
    pageIndices: readonly number[],
    confirmSignatureInvalidation: boolean,
  ): Promise<EngineTypes['SanitizeReport']> {
    const report = await this.#mutationRequest<EngineTypes['SanitizeReport']>({
      operation: 'redactPages',
      payload: { pageIndices, confirmSignatureInvalidation },
    });
    this.#acceptMutation(report);
    return report;
  }

  async sanitize(
    confirmSignatureInvalidation: boolean,
  ): Promise<EngineTypes['SanitizeReport']> {
    const report = await this.#mutationRequest<EngineTypes['SanitizeReport']>({
      operation: 'sanitize',
      payload: { confirmSignatureInvalidation },
    });
    this.#acceptMutation(report);
    return report;
  }

  async undo(): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'undo',
        payload: {},
      }),
    );
  }

  async redo(): Promise<EngineTypes['MutationResult']> {
    return this.#acceptMutation(
      await this.#mutationRequest<EngineTypes['MutationResult']>({
        operation: 'redo',
        payload: {},
      }),
    );
  }

  getJournal(): Promise<EngineTypes['JournalState']> {
    return this.documentRpc.request({ operation: 'getJournal', payload: {} });
  }

  getOutputState(): Promise<EngineTypes['OutputState']> {
    return this.documentRpc.request({ operation: 'getOutputState', payload: {} });
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    return this.documentRpc.subscribe(listener);
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
    const bytes =
      this.#documentRevision === 0 && !this.info.encryption?.protected
        ? await this.sourceFile.arrayBuffer()
        : await this.documentRpc.request<ArrayBuffer>({
            operation: 'snapshotForSearch',
            payload: {},
          });
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
          payload: {
            name: this.sourceFile.name,
            ios: this.ios,
            data: bytes,
            ...(this.password === undefined ? {} : { password: this.password }),
          },
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
    const rendering = this.documentRpc.request<TileResult>(
      { operation: 'renderTile', payload: next.request },
      [],
      next.signal,
      true,
    );
    this.#renderIdle = rendering.then(
      () => undefined,
      () => undefined,
    );
    void rendering.then(next.resolve, next.reject).finally(() => {
      next.removeAbortListener();
      this.#renderingTile = false;
      this.#renderNextTile();
    });
  }

  async #mutationRequest<T>(
    request: Omit<EngineRequest, 'id'>,
    transfer: Transferable[] = [],
  ): Promise<T> {
    for (const tile of this.#tileQueue.splice(0)) {
      tile.removeAbortListener();
      tile.reject(new DOMException('Superseded by a document change.', 'AbortError'));
    }
    await this.#renderIdle;
    return this.documentRpc.request<T>(request, transfer);
  }

  #acceptMutation(result: EngineTypes['MutationResult']): EngineTypes['MutationResult'] {
    this.#info = result.document;
    this.#documentRevision += 1;
    this.#invalidateSearch();
    return result;
  }

  async #refreshInfo(changed = false): Promise<void> {
    this.#info = await this.documentRpc.request({
      operation: 'getDocumentInfo',
      payload: {},
    });
    if (changed) {
      this.#documentRevision += 1;
      this.#invalidateSearch();
    }
  }

  #invalidateSearch(): void {
    const pending = this.#searchRpcPromise;
    this.#searchRpcPromise = null;
    if (pending) void pending.then((rpc) => rpc.close()).catch(() => undefined);
  }
}

async function documentPersistenceKey(file: File): Promise<string> {
  const identity = new TextEncoder().encode(`${file.name}\0${file.size}\0${file.lastModified}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', identity));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const openPdfEngine: PdfEngineFactory = WorkerPdfEngine.open;

export default { openPdfEngine, WorkerRpc };
