// @vitest-environment jsdom

import { OpfsSnapshotStore } from '../lib/persistence/opfs';

describe('VIEW-036 OPFS snapshot writes', () => {
  it('retries short writes before atomically renaming a snapshot', async () => {
    const writes: { readonly at: number; readonly size: number }[] = [];
    const access = {
      truncate: vi.fn(),
      write: vi.fn((buffer: ArrayBufferView, options?: { readonly at?: number }) => {
        const size = Math.min(2, buffer.byteLength);
        writes.push({ at: options?.at ?? 0, size });
        return size;
      }),
      flush: vi.fn(),
      close: vi.fn(),
    };
    const handle = {
      kind: 'file' as const,
      name: 'snapshot',
      createSyncAccessHandle: vi.fn(async () => access),
      move: vi.fn(async () => undefined),
      getFile: vi.fn(),
      isSameEntry: vi.fn(),
      createWritable: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn(),
    };
    const root = {
      kind: 'directory' as const,
      name: 'root',
      getFileHandle: vi.fn(async () => handle),
      removeEntry: vi.fn(async () => undefined),
      entries: async function* () {
        // The newly renamed generation is the only entry.
      },
    };
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => root },
    });

    const opened = await OpfsSnapshotStore.open('document-key');
    if (!('store' in opened)) throw new Error(opened.availability.reason);
    await opened.store.write(new Uint8Array([1, 2, 3, 4, 5, 6]));

    expect(writes).toEqual([
      { at: 0, size: 2 },
      { at: 2, size: 2 },
      { at: 4, size: 2 },
    ]);
    expect(access.flush).toHaveBeenCalledOnce();
    expect(handle.move).toHaveBeenCalledOnce();
  });
});
