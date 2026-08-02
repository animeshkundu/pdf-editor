export type OfflineStatus =
  | { readonly state: 'installing'; readonly message: string }
  | { readonly state: 'ready'; readonly message: string }
  | { readonly state: 'error'; readonly message: string };

type OfflineListener = (status: OfflineStatus) => void;

const listeners = new Set<OfflineListener>();
let currentStatus: OfflineStatus | null = null;
let registration: Promise<void> | null = null;
let listening = false;

function publish(status: OfflineStatus): void {
  currentStatus = status;
  document.documentElement.dataset.offlineCache = status.state;
  for (const listener of listeners) listener(status);
}

function listenForWorkerMessages(): void {
  if (listening) return;
  listening = true;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!event.data || typeof event.data !== 'object') return;
    const value = event.data as { readonly type?: unknown; readonly message?: unknown };
    if (typeof value.message !== 'string') return;
    if (
      value.type === 'papertrail-offline-install-error' &&
      navigator.serviceWorker.controller
    ) {
      publish({
        state: 'ready',
        message: 'The current offline app remains available; a newer cache will retry later.',
      });
      return;
    }
    if (
      value.type !== 'papertrail-offline-error' &&
      value.type !== 'papertrail-offline-install-error'
    ) {
      return;
    }
    publish({ state: 'error', message: value.message });
  });
}

async function waitForController(): Promise<void> {
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
      reject(new Error('The installed worker did not take control of this page.'));
    }, 10_000);
    const onController = () => {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
      resolve();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
  });
}

async function waitForInstallation(
  worker: ServiceWorker | null,
  hadActiveWorker: boolean,
): Promise<void> {
  if (!worker || ['installed', 'activating', 'activated'].includes(worker.state)) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener('statechange', onStateChange);
      if (hadActiveWorker) resolve();
      else reject(new Error('The offline worker did not finish installing in time.'));
    }, 30_000);
    const onStateChange = () => {
      if (['installed', 'activating', 'activated'].includes(worker.state)) {
        window.clearTimeout(timeout);
        worker.removeEventListener('statechange', onStateChange);
        resolve();
      } else if (worker.state === 'redundant') {
        window.clearTimeout(timeout);
        worker.removeEventListener('statechange', onStateChange);
        if (hadActiveWorker) resolve();
        else reject(new Error('The offline worker became redundant before it installed.'));
      }
    };
    worker.addEventListener('statechange', onStateChange);
  });
}

export function subscribeOfflineStatus(listener: OfflineListener): () => void {
  listeners.add(listener);
  if (currentStatus) listener(currentStatus);
  return () => listeners.delete(listener);
}

export function registerOfflineApp(): Promise<void> {
  if (registration) return registration;
  if (!('serviceWorker' in navigator)) return Promise.resolve();

  listenForWorkerMessages();
  const hadActiveWorker = navigator.serviceWorker.controller !== null;
  publish({
    state: 'installing',
    message: 'Preparing this browser for repeat offline use.',
  });
  registration = navigator.serviceWorker
    .register(new URL('./sw.js', window.location.href), {
      scope: './',
      updateViaCache: 'none',
    })
    .then(async (workerRegistration) => {
      await waitForInstallation(workerRegistration.installing, hadActiveWorker);
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller && !workerRegistration.active) {
        await waitForController();
      }
      publish({
        state: 'ready',
        message: navigator.serviceWorker.controller
          ? 'The application shell and PDF engine are ready for repeat offline use.'
          : 'Offline support is installed and will control the next normal app load.',
      });
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Unknown service-worker error.';
      if (currentStatus?.state !== 'error') {
        publish({
          state: 'error',
          message: `Offline setup failed. The editor still works online. ${detail}`,
        });
      }
      throw error;
    });
  return registration;
}

export default { registerOfflineApp, subscribeOfflineStatus };
