import engineClient from '@/lib/engine/client';
import engineErrors, { type EngineTypes } from '@/lib/engine/port';
import renderLayout from '@/lib/render/layout';

type EngineRequest = EngineTypes['EngineRequest'];
type EngineResponse = EngineTypes['EngineResponse'];
type WorkerLike = ConstructorParameters<typeof engineClient.WorkerRpc>[0];
const { WorkerRpc } = engineClient;
const { WorkerCrashedError } = engineErrors;
const { MAX_SCROLL_HEIGHT, MAX_TILE_SIZE, PageLayout, tileRects, viewportTileRects } =
  renderLayout;

class FakeWorker implements WorkerLike {
  readonly sent: EngineRequest[] = [];
  readonly #messageListeners: ((event: MessageEvent<EngineResponse>) => void)[] = [];
  readonly #deathListeners: ((event: Event) => void)[] = [];
  terminated = false;

  postMessage(message: EngineRequest): void {
    this.sent.push(message);
  }

  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent<EngineResponse>) => void) | ((event: Event) => void),
  ): void {
    if (type === 'message') {
      this.#messageListeners.push(listener as (event: MessageEvent<EngineResponse>) => void);
    } else {
      this.#deathListeners.push(listener as (event: Event) => void);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: EngineResponse): void {
    for (const listener of this.#messageListeners) {
      listener(new MessageEvent('message', { data: response }));
    }
  }

  crash(): void {
    for (const listener of this.#deathListeners) listener(new Event('error'));
  }

  ready(): void {
    this.respond({ id: 0, ok: true, value: undefined });
  }
}

describe('VIEW-002 tiled viewer kernels', () => {
  const pages = [
    { index: 0, label: '1', bounds: [0, 0, 100, 200] as const, width: 100, height: 200 },
    { index: 1, label: '2', bounds: [0, 0, 100, 300] as const, width: 100, height: 300 },
    { index: 2, label: '3', bounds: [0, 0, 100, 400] as const, width: 100, height: 400 },
  ];

  it('keeps every uninterruptible engine render within the 512 px tile ceiling', () => {
    const tiles = tileRects(1_201, 801);
    expect(tiles).toHaveLength(6);
    expect(
      tiles.every((tile) => tile.width <= MAX_TILE_SIZE && tile.height <= MAX_TILE_SIZE),
    ).toBe(true);
    expect(tiles.reduce((pixels, tile) => pixels + tile.width * tile.height, 0)).toBe(
      1_201 * 801,
    );
  });

  it('uses prefix sums and finds a bounded visible page range without DOM measurement', () => {
    const layout = new PageLayout(pages, 1);
    expect(layout.offsetFor(0)).toBe(24);
    expect(layout.offsetFor(1)).toBeGreaterThan(layout.offsetFor(0));
    expect(layout.pageAt(layout.offsetFor(2) + 1)).toBe(2);
    expect(layout.visibleRange(layout.offsetFor(1), 100, 0)).toEqual([1, 2]);
  });

  it('maps maximum-page documents through a browser-safe virtual scroll range', () => {
    const manyPages = Array.from({ length: 10_000 }, (_, index) => ({
      index,
      label: String(index + 1),
      bounds: [0, 0, 612, 792] as const,
      width: 612,
      height: 792,
    }));
    const layout = new PageLayout(manyPages, 8);
    const viewportHeight = 900;
    const lastPageOffset = layout.offsetFor(9_999);
    const physicalOffset = layout.scrollOffsetForLogical(lastPageOffset, viewportHeight);

    expect(layout.totalHeight).toBeGreaterThan(MAX_SCROLL_HEIGHT);
    expect(layout.scrollHeight()).toBe(MAX_SCROLL_HEIGHT);
    expect(physicalOffset).toBeLessThan(MAX_SCROLL_HEIGHT);
    expect(layout.logicalOffsetForScroll(physicalOffset, viewportHeight)).toBeCloseTo(
      lastPageOffset,
      5,
    );
  });

  it('renders only the viewport ring on an adversarial high-zoom page', () => {
    const tiles = viewportTileRects(153_600, 153_600, {
      left: 70_000,
      top: 80_000,
      width: 1_920,
      height: 1_080,
    });
    expect(tiles.length).toBeLessThanOrEqual(35);
    expect(tiles.every((tile) => tile.width <= 512 && tile.height <= 512)).toBe(true);
    expect(tiles.some((tile) => tile.x <= 70_000 && tile.x + tile.width > 70_000)).toBe(true);
  });

  it('rejects invalid tile ceilings rather than looping', () => {
    expect(() => tileRects(100, 100, 0)).toThrow('positive finite');
  });
});

describe('R4 worker crash and cancellation', () => {
  it('rejects every in-flight request with a typed error when a worker dies', async () => {
    const worker = new FakeWorker();
    const rpc = new WorkerRpc(worker);
    worker.ready();
    const pending = rpc.request({
      operation: 'getPageText',
      payload: { pageIndex: 0 },
    });

    worker.crash();

    await expect(pending).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(worker.terminated).toBe(true);
  });

  it('drops a superseded response and sends cancellation to the worker', async () => {
    const worker = new FakeWorker();
    const rpc = new WorkerRpc(worker);
    worker.ready();
    const controller = new AbortController();
    const pending = rpc.request(
      { operation: 'getPageText', payload: { pageIndex: 0 } },
      [],
      controller.signal,
    );
    await Promise.resolve();
    const requestId = worker.sent[0]?.id;

    controller.abort(new DOMException('Superseded', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.sent.at(-1)).toMatchObject({
      operation: 'cancel',
      payload: { requestId },
    });

    if (requestId) worker.respond({ id: requestId, ok: true, value: undefined });
    expect(worker.terminated).toBe(false);
  });

  it('keeps a render slot occupied until an aborted synchronous render responds', async () => {
    const worker = new FakeWorker();
    const rpc = new WorkerRpc(worker);
    worker.ready();
    const controller = new AbortController();
    let settled = false;
    const pending = rpc
      .request(
        {
          operation: 'renderTile',
          payload: { pageIndex: 0, scale: 1, x: 0, y: 0, width: 16, height: 16 },
        },
        [],
        controller.signal,
        true,
      )
      .finally(() => {
        settled = true;
      });
    await Promise.resolve();
    const requestId = worker.sent[0]?.id;

    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(worker.sent).toHaveLength(1);

    if (requestId) worker.respond({ id: requestId, ok: true, value: undefined });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(settled).toBe(true);
  });

  it('terminates a worker and rejects pending work when an operation exceeds its deadline', async () => {
    const worker = new FakeWorker();
    const rpc = new WorkerRpc(worker, 5);
    worker.ready();

    const pending = rpc.request({
      operation: 'getPageText',
      payload: { pageIndex: 0 },
    });

    await expect(pending).rejects.toMatchObject({
      name: 'WorkerCrashedError',
      message: expect.stringContaining('timed out'),
    });
    expect(worker.terminated).toBe(true);
  });
});
