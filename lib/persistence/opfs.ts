import { LimitError } from '../core/limits';

interface SyncFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
  move?: (name: string) => Promise<void>;
}

interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: ArrayBufferView, options?: { readonly at?: number }): number;
  flush(): void;
  close(): void;
}

export interface RecoveryEntry {
  readonly key: string;
  readonly name: string;
  readonly modified: number;
  readonly size: number;
}

export interface PersistenceAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

const SNAPSHOT_SUFFIX = '.pdf';
const TEMP_SUFFIX = '.tmp';

function detail(error: unknown): string {
  return error instanceof Error ? error.message : 'The browser did not expose local storage.';
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

function randomId(): string {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return [...values].map((value) => value.toString(16).padStart(8, '0')).join('');
}

async function rootDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error('Origin-private file storage is unavailable in this browser.');
  }
  return navigator.storage.getDirectory();
}

async function writeFile(handle: SyncFileHandle, bytes: Uint8Array): Promise<void> {
  if (!handle.createSyncAccessHandle) {
    throw new Error('Synchronous origin-private file access is unavailable in this browser.');
  }
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = access.write(bytes.subarray(offset), { at: offset });
      if (!Number.isInteger(written) || written <= 0) {
        throw new Error(
          `Crash recovery stopped after ${offset.toLocaleString()} of ${bytes.byteLength.toLocaleString()} bytes.`,
        );
      }
      offset += written;
    }
    access.flush();
  } finally {
    access.close();
  }
}

export class OpfsSnapshotStore {
  private constructor(
    private readonly root: FileSystemDirectoryHandle,
    readonly key: string,
  ) {}

  static async open(
    key: string,
  ): Promise<
    | { readonly availability: { readonly available: true }; readonly store: OpfsSnapshotStore }
    | { readonly availability: { readonly available: false; readonly reason: string } }
  > {
    try {
      const root = await rootDirectory();
      const probeName = `${key}.probe`;
      const probe = (await root.getFileHandle(probeName, {
        create: true,
      })) as SyncFileHandle;
      const available = Boolean(probe.createSyncAccessHandle && probe.move);
      await root.removeEntry(probeName);
      if (!available) {
        return {
          availability: {
            available: false,
            reason:
              'Crash recovery needs synchronous OPFS access and atomic rename, which this browser does not provide.',
          },
        };
      }
      return {
        availability: { available: true },
        store: new OpfsSnapshotStore(root, key),
      };
    } catch (error) {
      return {
        availability: {
          available: false,
          reason: `Crash recovery is unavailable. ${detail(error)}`,
        },
      };
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    const generation = `${this.key}.${Date.now()}.${randomId()}${SNAPSHOT_SUFFIX}`;
    const tempName = `${generation}${TEMP_SUFFIX}`;
    const handle = (await this.root.getFileHandle(tempName, {
      create: true,
    })) as SyncFileHandle;
    try {
      await writeFile(handle, bytes);
      if (!handle.move) {
        throw new Error('Atomic origin-private file rename became unavailable.');
      }
      await handle.move(generation);
      await this.removeOlderThan(generation);
    } catch (error) {
      await this.root.removeEntry(tempName).catch((cleanupError: unknown) => {
        throw new AggregateError(
          [error, cleanupError],
          'The recovery snapshot and its temporary entry could not be completed.',
        );
      });
      if (isQuotaError(error)) {
        throw new LimitError(
          'storage_quota',
          'Local crash-recovery storage is full. Save a copy, close another document, or clear site storage.',
        );
      }
      throw error;
    }
  }

  async readLatest(): Promise<ArrayBuffer | null> {
    const entries = (await OpfsSnapshotStore.list()).filter((entry) => entry.key === this.key);
    const latest = entries.sort((left, right) => right.modified - left.modified)[0];
    if (!latest) return null;
    return (await this.root.getFileHandle(latest.name))
      .getFile()
      .then((file) => file.arrayBuffer());
  }

  async remove(): Promise<void> {
    for await (const [name] of this.root.entries()) {
      if (name.startsWith(`${this.key}.`)) await this.root.removeEntry(name);
    }
  }

  private async removeOlderThan(currentName: string): Promise<void> {
    for await (const [name] of this.root.entries()) {
      if (
        name !== currentName &&
        name.startsWith(`${this.key}.`) &&
        name.endsWith(SNAPSHOT_SUFFIX)
      ) {
        await this.root.removeEntry(name);
      }
    }
  }

  static async list(): Promise<RecoveryEntry[]> {
    const root = await rootDirectory();
    const entries: RecoveryEntry[] = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'file' || !name.endsWith(SNAPSHOT_SUFFIX)) continue;
      const file = await handle.getFile();
      const separator = name.indexOf('.');
      entries.push({
        key: separator < 0 ? name : name.slice(0, separator),
        name,
        modified: file.lastModified,
        size: file.size,
      });
    }
    return entries;
  }

  static async read(entry: RecoveryEntry): Promise<ArrayBuffer> {
    const root = await rootDirectory();
    const handle = await root.getFileHandle(entry.name);
    return (await handle.getFile()).arrayBuffer();
  }

  static async remove(entry: RecoveryEntry): Promise<void> {
    const root = await rootDirectory();
    await root.removeEntry(entry.name);
  }

  static async sweep(maxAgeMs: number, now = Date.now()): Promise<void> {
    const root = await rootDirectory();
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'file') continue;
      if (name.endsWith(TEMP_SUFFIX)) {
        await root.removeEntry(name);
        continue;
      }
      if (!name.endsWith(SNAPSHOT_SUFFIX)) continue;
      const file = await handle.getFile();
      if (now - file.lastModified > maxAgeMs) await root.removeEntry(name);
    }
  }
}

export class DebouncedPersistence {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pending: (() => Promise<Uint8Array>) | null = null;
  #writing: Promise<void> | null = null;

  constructor(
    private readonly store: OpfsSnapshotStore,
    private readonly onError: (error: unknown) => void,
    private readonly delayMs = 500,
  ) {}

  schedule(produce: () => Promise<Uint8Array>): void {
    this.#pending = produce;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush().catch(this.onError);
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.#writing) await this.#writing;
    const produce = this.#pending;
    this.#pending = null;
    if (!produce) return;
    const writing = produce().then((bytes) => this.store.write(bytes));
    this.#writing = writing;
    try {
      await writing;
    } finally {
      if (this.#writing === writing) this.#writing = null;
    }
    if (this.#pending) await this.flush();
  }

  async discard(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending = null;
    if (this.#writing) await this.#writing;
    await this.store.remove();
  }
}

export default { DebouncedPersistence, OpfsSnapshotStore };
