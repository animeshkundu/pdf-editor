import { deriveOfflineCacheVersion } from '../scripts/offline-cache-version';

const base = {
  manifestDigest: 'manifest-digest',
  configDigest: 'worker-logic-digest',
  base: '/pdf/app/',
} as const;

describe('offline cache versioning', () => {
  it('changes for app-only bundle changes even when the WASM manifest is unchanged', () => {
    const first = deriveOfflineCacheVersion({
      ...base,
      assets: [{ path: 'assets/index-first.js', bytes: 'first app bundle' }],
    });
    const second = deriveOfflineCacheVersion({
      ...base,
      assets: [{ path: 'assets/index-second.js', bytes: 'second app bundle' }],
    });

    expect(first).not.toBe(second);
  });

  it('changes for HTML-only shell changes', () => {
    const first = deriveOfflineCacheVersion({
      ...base,
      assets: [{ path: 'index.html', bytes: '<title>First</title>' }],
    });
    const second = deriveOfflineCacheVersion({
      ...base,
      assets: [{ path: 'index.html', bytes: '<title>Other</title>' }],
    });

    expect(first).not.toBe(second);
  });

  it('changes for worker-logic and public-base changes', () => {
    const assets = [{ path: 'assets/index.js', bytes: 'same bundle' }] as const;
    const first = deriveOfflineCacheVersion({ ...base, assets });
    const changedLogic = deriveOfflineCacheVersion({
      ...base,
      configDigest: 'changed-worker-logic',
      assets,
    });
    const changedBase = deriveOfflineCacheVersion({
      ...base,
      base: '/another/app/',
      assets,
    });

    expect(new Set([first, changedLogic, changedBase])).toHaveLength(3);
  });
});
