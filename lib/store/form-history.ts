export interface FormHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface FormHistoryOptions {
  readonly documentId: string;
  readonly storage: FormHistoryStorage;
  readonly enabled?: boolean;
  readonly maximumEntries?: number;
}

const PREFIX = 'pdf-editor.form-history.v1';

/**
 * Opt-in history whose key always includes the caller-provided, opaque document identity.
 * It cannot be enabled accidentally: no instance writes until setEnabled(true) is called.
 */
export class FormHistory {
  readonly #key: string;
  readonly #storage: FormHistoryStorage;
  readonly #maximumEntries: number;
  #enabled: boolean;

  constructor(options: FormHistoryOptions) {
    if (!options.documentId.trim())
      throw new Error('Form history requires a document-scoped identity.');
    this.#key = `${PREFIX}:${options.documentId}`;
    this.#storage = options.storage;
    this.#enabled = options.enabled ?? false;
    this.#maximumEntries = Math.max(1, options.maximumEntries ?? 10);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }

  suggestions(fieldName: string): string[] {
    if (!this.#enabled || !fieldName.trim()) return [];
    return this.#read()[fieldName] ?? [];
  }

  remember(fieldName: string, value: string | boolean): void {
    if (!this.#enabled || !fieldName.trim() || typeof value !== 'string' || !value.trim())
      return;
    const values = this.#read();
    const prior = values[fieldName] ?? [];
    values[fieldName] = [value, ...prior.filter((entry) => entry !== value)].slice(
      0,
      this.#maximumEntries,
    );
    this.#storage.setItem(this.#key, JSON.stringify(values));
  }

  clear(): void {
    this.#storage.removeItem(this.#key);
  }

  #read(): Record<string, string[]> {
    const raw = this.#storage.getItem(this.#key);
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([fieldName, entries]) =>
          Array.isArray(entries) && entries.every((entry) => typeof entry === 'string')
            ? [[fieldName, entries] as const]
            : [],
        ),
      );
    } catch {
      return {};
    }
  }
}

export default FormHistory;
