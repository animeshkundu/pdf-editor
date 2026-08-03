// @vitest-environment jsdom

describe('offline service-worker client', () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    delete document.documentElement.dataset.offlineCache;
  });

  it('starts queued messages and keeps a cache-recovery error through registration', async () => {
    const events = new EventTarget();
    let finishRegistration: ((value: { active: object; installing: null }) => void) | undefined;
    const serviceWorker = {
      controller: {},
      ready: Promise.resolve(),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      register: vi.fn(
        () =>
          new Promise<{ active: object; installing: null }>((resolve) => {
            finishRegistration = resolve;
          }),
      ),
      startMessages: vi.fn(),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });
    const { registerOfflineApp, subscribeOfflineStatus } =
      await import('@/lib/persistence/service-worker');
    const statuses: Array<{ readonly state: string; readonly message: string }> = [];
    const unsubscribe = subscribeOfflineStatus((status) => statuses.push(status));
    const registration = registerOfflineApp();
    expect(serviceWorker.startMessages).toHaveBeenCalledOnce();

    const message =
      'The current application asset loaded, but this browser could not restore it for repeat offline use. Free site storage and reload while online before relying on offline use.';
    events.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'papertrail-offline-cache-error', message },
      }),
    );
    finishRegistration?.({ active: {}, installing: null });
    await registration;

    expect(statuses.at(-1)).toEqual({ state: 'error', message });
    expect(document.documentElement.dataset.offlineCache).toBe('error');
    unsubscribe();
  });
});
