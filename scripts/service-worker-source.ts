export interface ServiceWorkerSourceOptions {
  readonly manifestDigest: string;
  readonly shellDocumentDigest: string;
  readonly cacheVersion: string;
  readonly base: string;
  readonly assets: readonly string[];
  readonly precacheBytes: number;
}

export function renderServiceWorkerSource({
  manifestDigest,
  shellDocumentDigest,
  cacheVersion,
  base,
  assets,
  precacheBytes,
}: ServiceWorkerSourceOptions): string {
  return `
const CACHE_PREFIX = 'papertrail-app-';
const WASM_MANIFEST_DIGEST = ${JSON.stringify(manifestDigest)};
const SHELL_DOCUMENT_DIGEST = ${JSON.stringify(shellDocumentDigest)};
const CACHE_VERSION = ${JSON.stringify(cacheVersion)};
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const STAGING_CACHE_NAME = CACHE_NAME + '-installing';
const ASSET_BASE = ${JSON.stringify(base)};
const ASSET_PATHS = ${JSON.stringify(assets)};
const PRECACHE_BYTES = ${precacheBytes};
const REQUIRED_AVAILABLE_BYTES = PRECACHE_BYTES * 2;
const PUBLIC_APP_URL = new URL('./', self.location.href).href;
const ASSET_URLS = ASSET_PATHS.map((path) =>
  new URL(path, new URL(ASSET_BASE, self.location.origin)).href,
);
const PRECACHE_URLS = [PUBLIC_APP_URL, ...ASSET_URLS];
const PRECACHE_SET = new Set(PRECACHE_URLS);

async function notifyFailure(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    client.postMessage({ type: 'papertrail-offline-error', message });
  }
}

async function notifyInstallFailure(message) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    client.postMessage({ type: 'papertrail-offline-install-error', message });
  }
}

async function cacheIsComplete() {
  if (!(await caches.has(CACHE_NAME))) return false;
  const cache = await caches.open(CACHE_NAME);
  for (const url of PRECACHE_URLS) {
    if (!(await cache.match(url))) return false;
  }
  return true;
}

async function fetchCurrentAsset(url, action) {
  const parsed = new URL(url);
  if (parsed.origin !== self.location.origin) {
    throw new Error(action + ' refused a non-local asset: ' + parsed.origin + '.');
  }
  const request = new Request(parsed.href, {
    cache: 'reload',
    credentials: 'same-origin',
    redirect: 'error',
  });
  const response = await fetch(request);
  if (!response.ok) {
    throw new Error(action + ' could not fetch ' + parsed.pathname + '.');
  }
  let responseUrl;
  try {
    responseUrl = new URL(response.url);
  } catch {
    throw new Error(action + ' received a response without a verifiable origin.');
  }
  if (responseUrl.origin !== self.location.origin) {
    throw new Error(action + ' refused a non-local response: ' + responseUrl.origin + '.');
  }
  return { request, response };
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    let finalCacheCreated = false;
    try {
      if (await cacheIsComplete()) return;
      const estimate = await self.navigator.storage?.estimate?.().catch(() => null);
      const remaining = estimate ? (estimate.quota ?? 0) - (estimate.usage ?? 0) : null;
      if (
        estimate?.quota &&
        remaining !== null &&
        remaining < REQUIRED_AVAILABLE_BYTES
      ) {
        throw new Error(
          'Offline setup needs ' + REQUIRED_AVAILABLE_BYTES.toLocaleString() +
          ' available bytes, but this origin has only ' + remaining.toLocaleString() + '.',
        );
      }
      await caches.delete(STAGING_CACHE_NAME);
      const staging = await caches.open(STAGING_CACHE_NAME);
      for (const url of PRECACHE_URLS) {
        const { request, response } = await fetchCurrentAsset(url, 'Offline setup');
        await staging.put(request, response);
      }
      await caches.delete(CACHE_NAME);
      const cache = await caches.open(CACHE_NAME);
      finalCacheCreated = true;
      for (const url of PRECACHE_URLS) {
        const response = await staging.match(url);
        if (!response) throw new Error('Offline staging lost ' + new URL(url).pathname + '.');
        await cache.put(url, response);
      }
      await caches.delete(STAGING_CACHE_NAME);
    } catch (error) {
      await caches.delete(STAGING_CACHE_NAME);
      if (finalCacheCreated) await caches.delete(CACHE_NAME);
      const detail = error instanceof Error ? error.message : 'Unknown cache error.';
      await notifyInstallFailure(
        'Offline setup failed. The editor still works online, but repeat offline loads are not ready. ' +
          detail,
      );
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const publicApp = new URL(PUBLIC_APP_URL);
  const indexUrl = new URL('index.html', PUBLIC_APP_URL);
  const isAppNavigation =
    request.mode === 'navigate' &&
    (url.pathname === publicApp.pathname || url.pathname === indexUrl.pathname);
  const cacheKey =
    isAppNavigation || url.href === indexUrl.href ? PUBLIC_APP_URL : url.href;
  if (!PRECACHE_SET.has(cacheKey)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const message =
      'Papertrail stopped because its offline cache is incomplete. Reconnect and reload ' +
      'before opening a document; an older engine will not be used.';
    try {
      const { response } = await fetchCurrentAsset(cacheKey, 'Offline cache recovery');
      try {
        await cache.put(cacheKey, response.clone());
      } catch {
        await notifyInstallFailure(
          'The current application asset loaded, but this browser could not restore it for repeat offline use.',
        );
      }
      return response;
    } catch {
      await notifyFailure(message);
      return new Response(message, {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
`;
}
