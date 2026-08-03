import { runInNewContext } from 'node:vm';
import { renderServiceWorkerSource } from '../scripts/service-worker-source';

const ORIGIN = 'https://papertrail.test';
const APP_URL = `${ORIGIN}/pdf/app/`;
const CACHE_VERSION = '0123456789abcdef01234567';
const CACHE_NAME = `papertrail-app-${CACHE_VERSION}`;
const ASSETS = ['assets/app.js', 'assets/engine.wasm'] as const;
const PRECACHE_URLS = [APP_URL, ...ASSETS.map((path) => new URL(path, APP_URL).href)];

function keyUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return new URL(input, ORIGIN).href;
  if (input instanceof URL) return input.href;
  return input.url;
}

function responseAt(body: BodyInit, url: string, init?: ResponseInit): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { configurable: true, value: url });
  return response;
}

interface StoredResponse {
  readonly body: ArrayBuffer;
  readonly headers: [string, string][];
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
}

class FakeCache {
  readonly entries = new Map<string, StoredResponse>();
  failNextPut: unknown;

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    const stored = this.entries.get(keyUrl(input));
    if (!stored) return undefined;
    return responseAt(stored.body.slice(0), stored.url, {
      headers: stored.headers,
      status: stored.status,
      statusText: stored.statusText,
    });
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    if (this.failNextPut) {
      const failure = this.failNextPut;
      this.failNextPut = undefined;
      throw failure;
    }
    const key = keyUrl(input);
    this.entries.set(key, {
      body: await response.arrayBuffer(),
      headers: [...response.headers.entries()],
      status: response.status,
      statusText: response.statusText,
      url: response.url || key,
    });
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(keyUrl(input));
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }

  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
}

type InstallListener = (event: { waitUntil(promise: Promise<unknown>): void }) => void;
type FetchListener = (event: {
  readonly request: { readonly method: string; readonly mode: string; readonly url: string };
  respondWith(response: Promise<Response>): void;
}) => void;

function workerHarness(
  network: (request: Request) => Promise<Response> = async (request) =>
    responseAt(`current:${new URL(request.url).pathname}`, request.url),
) {
  const listeners = new Map<string, InstallListener | FetchListener>();
  const caches = new FakeCacheStorage();
  const messages: unknown[] = [];
  const fetch = vi.fn(network);
  const matchAll = vi.fn(async () => [
    { postMessage: (message: unknown) => messages.push(message) },
  ]);
  const consoleError = vi.fn();
  const self = {
    location: new URL(`${APP_URL}sw.js`),
    navigator: {
      storage: {
        estimate: async () => ({ quota: 100_000_000, usage: 0 }),
      },
    },
    clients: {
      matchAll,
      claim: async () => undefined,
    },
    addEventListener(type: string, listener: InstallListener | FetchListener) {
      listeners.set(type, listener);
    },
  };
  const source = renderServiceWorkerSource({
    manifestDigest: 'manifest',
    shellDocumentDigest: 'shell',
    cacheVersion: CACHE_VERSION,
    base: '/pdf/app/',
    assets: ASSETS,
    precacheBytes: 10_000,
  });
  runInNewContext(source, {
    console: { error: consoleError },
    Request,
    Response,
    Set,
    URL,
    caches,
    fetch,
    self,
  });

  return {
    caches,
    consoleError,
    fetch,
    matchAll,
    messages,
    async install(): Promise<void> {
      const listener = listeners.get('install') as InstallListener | undefined;
      if (!listener) throw new Error('The service worker did not register install handling.');
      let pending: Promise<unknown> | undefined;
      listener({
        waitUntil(promise) {
          pending = promise;
        },
      });
      if (!pending) throw new Error('Install did not register lifetime work.');
      await pending;
    },
    async fetchRequest(url: string, mode = 'same-origin'): Promise<Response | undefined> {
      const listener = listeners.get('fetch') as FetchListener | undefined;
      if (!listener) throw new Error('The service worker did not register fetch handling.');
      let response: Promise<Response> | undefined;
      listener({
        request: { method: 'GET', mode, url },
        respondWith(value) {
          response = value;
        },
      });
      return response ? await response : undefined;
    },
  };
}

async function seedCompleteCache(
  harness: ReturnType<typeof workerHarness>,
): Promise<FakeCache> {
  await harness.install();
  const cache = await harness.caches.open(CACHE_NAME);
  expect([...cache.entries.keys()].sort()).toEqual([...PRECACHE_URLS].sort());
  return cache;
}

describe('emitted offline service worker', () => {
  it.each([
    ['enumerated asset', PRECACHE_URLS[1]!, 'same-origin'],
    ['app shell navigation', APP_URL, 'navigate'],
  ])('recovers an evicted %s from the current origin', async (_name, url, mode) => {
    const harness = workerHarness();
    const cache = await seedCompleteCache(harness);
    await cache.delete(url);
    harness.fetch.mockClear();

    const recovered = await harness.fetchRequest(url, mode);

    expect(recovered?.status).toBe(200);
    expect(await recovered?.text()).toBe(`current:${new URL(url).pathname}`);
    expect(await (await cache.match(url))?.text()).toBe(`current:${new URL(url).pathname}`);
    expect(harness.fetch).toHaveBeenCalledOnce();

    const cached = await harness.fetchRequest(url, mode);
    expect(cached?.status).toBe(200);
    expect(harness.fetch).toHaveBeenCalledOnce();
  });

  it('repairs a final cache left partial by an interrupted promotion', async () => {
    const harness = workerHarness();
    const partial = await harness.caches.open(CACHE_NAME);
    await partial.put(APP_URL, responseAt('partial shell', APP_URL));

    await harness.install();

    const repaired = await harness.caches.open(CACHE_NAME);
    expect([...repaired.entries.keys()].sort()).toEqual([...PRECACHE_URLS].sort());
    expect(await (await repaired.match(APP_URL))?.text()).toBe('current:/pdf/app/');
    expect(harness.fetch).toHaveBeenCalledTimes(PRECACHE_URLS.length);
  });

  it('skips network work only after every expected cache entry is present', async () => {
    const harness = workerHarness();
    await seedCompleteCache(harness);
    harness.fetch.mockClear();

    await harness.install();

    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('refuses redirected install responses and never caches their body', async () => {
    const foreignUrl = 'https://foreign.invalid/engine.wasm';
    const harness = workerHarness(async (request) => {
      expect(request.redirect).toBe('error');
      return responseAt('foreign body', foreignUrl);
    });

    await expect(harness.install()).rejects.toThrow(/non-local|origin/i);
    expect(await harness.caches.has(CACHE_NAME)).toBe(false);
    expect(await harness.caches.has(`${CACHE_NAME}-installing`)).toBe(false);
  });

  it('fails closed when a fetched response has no verifiable origin', async () => {
    const harness = workerHarness(async () => new Response('opaque body'));

    await expect(harness.install()).rejects.toThrow(/origin/i);
    expect(await harness.caches.has(CACHE_NAME)).toBe(false);
  });

  it('returns the preserved 503 only after same-origin network recovery fails', async () => {
    const harness = workerHarness();
    const cache = await seedCompleteCache(harness);
    const evicted = PRECACHE_URLS[1]!;
    await cache.delete(evicted);
    harness.fetch.mockRejectedValueOnce(new TypeError('offline'));

    const response = await harness.fetchRequest(evicted);
    const message = await response?.text();

    expect(response?.status).toBe(503);
    expect(message).toBe(
      'Papertrail stopped because its offline cache is incomplete. Reconnect and reload ' +
        'before opening a document; an older engine will not be used.',
    );
    expect(harness.messages).toContainEqual({
      type: 'papertrail-offline-error',
      message,
    });
  });

  it('returns the preserved 503 when failure notification also fails', async () => {
    const harness = workerHarness();
    const cache = await seedCompleteCache(harness);
    const evicted = PRECACHE_URLS[1]!;
    await cache.delete(evicted);
    harness.fetch.mockRejectedValueOnce(new TypeError('offline'));
    harness.matchAll.mockRejectedValueOnce(new Error('client enumeration failed'));

    const response = await harness.fetchRequest(evicted);

    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe(
      'Papertrail stopped because its offline cache is incomplete. Reconnect and reload ' +
        'before opening a document; an older engine will not be used.',
    );
    expect(harness.consoleError).toHaveBeenCalledWith(
      'Offline cache recovery could not notify the application.',
      expect.any(Error),
    );
  });

  it('serves a verified current response when storage pressure prevents re-caching it', async () => {
    const harness = workerHarness();
    const cache = await seedCompleteCache(harness);
    const evicted = PRECACHE_URLS[1]!;
    await cache.delete(evicted);
    cache.failNextPut = new DOMException('quota exhausted', 'QuotaExceededError');

    const response = await harness.fetchRequest(evicted);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('current:/pdf/app/assets/app.js');
    expect(await cache.match(evicted)).toBeUndefined();
    expect(harness.messages).toContainEqual({
      type: 'papertrail-offline-cache-error',
      message:
        'The current application asset loaded, but this browser could not restore it for repeat offline use. Free site storage and reload while online before relying on offline use.',
    });
  });

  it('serves a verified current response when cache-failure notification also fails', async () => {
    const harness = workerHarness();
    const cache = await seedCompleteCache(harness);
    const evicted = PRECACHE_URLS[1]!;
    await cache.delete(evicted);
    cache.failNextPut = new DOMException('quota exhausted', 'QuotaExceededError');
    harness.matchAll.mockRejectedValueOnce(new Error('client enumeration failed'));

    const response = await harness.fetchRequest(evicted);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('current:/pdf/app/assets/app.js');
    expect(harness.consoleError).toHaveBeenCalledWith(
      'Offline cache recovery could not notify the application.',
      expect.any(Error),
    );
  });

  it('refuses an unverifiable or foreign response during cache-miss recovery', async () => {
    const harness = workerHarness();
    const cache = await seedCompleteCache(harness);
    const evicted = PRECACHE_URLS[1]!;
    await cache.delete(evicted);
    harness.fetch.mockResolvedValueOnce(
      responseAt('foreign body', 'https://foreign.invalid/app.js'),
    );

    const response = await harness.fetchRequest(evicted);

    expect(response?.status).toBe(503);
    expect(await cache.match(evicted)).toBeUndefined();
    expect((harness.fetch.mock.calls.at(-1)?.[0] as Request).redirect).toBe('error');
  });
});
