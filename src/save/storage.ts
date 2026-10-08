/** Slot metadata shown in the "worlds" menu. */
export interface SlotMeta {
  id: string;
  name: string;
  seed: number;
  mode: string;
  year: number;
  pop: number;
  kingdoms: number;
  size: number;
  savedAt: number;
  /** Small PNG data URL of the world map. */
  thumb?: string;
  /** Planet colonised from another world. */
  parent?: string;
  bytes?: number;
}

export interface SaveStore {
  list(): Promise<SlotMeta[]>;
  read(id: string): Promise<Uint8Array | null>;
  write(meta: SlotMeta, data: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
}

/** In-memory store (tests, or when browser storage is unavailable). */
export class MemoryStore implements SaveStore {
  private metas = new Map<string, SlotMeta>();
  private blobs = new Map<string, Uint8Array>();
  async list() { return [...this.metas.values()].sort((a, b) => b.savedAt - a.savedAt); }
  async read(id: string) { return this.blobs.get(id) ?? null; }
  async write(meta: SlotMeta, data: Uint8Array) { this.metas.set(meta.id, { ...meta, bytes: data.length }); this.blobs.set(meta.id, data); }
  async remove(id: string) { this.metas.delete(id); this.blobs.delete(id); }
}

/** IndexedDB store: works offline inside the Android WebView, no size issue for large worlds. */
export class IDBStore implements SaveStore {
  private db: Promise<IDBDatabase>;
  constructor(name = 'aeonis') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req ? req.result : (undefined as T));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  async list() {
    const all = await this.tx<SlotMeta[]>(['meta'], 'readonly', (t) => t.objectStore('meta').getAll());
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }
  async read(id: string) {
    const v = await this.tx<Uint8Array | ArrayBuffer | undefined>(['data'], 'readonly', (t) => t.objectStore('data').get(id));
    if (!v) return null;
    return v instanceof Uint8Array ? v : new Uint8Array(v);
  }
  async write(meta: SlotMeta, data: Uint8Array) {
    await this.tx(['meta', 'data'], 'readwrite', (t) => {
      t.objectStore('data').put(data, meta.id);
      t.objectStore('meta').put({ ...meta, bytes: data.length });
    });
  }
  async remove(id: string) {
    await this.tx(['meta', 'data'], 'readwrite', (t) => {
      t.objectStore('data').delete(id);
      t.objectStore('meta').delete(id);
    });
  }
}

export function createStore(): SaveStore {
  try {
    if (typeof indexedDB !== 'undefined') return new IDBStore();
  } catch {
    /* private mode or disabled storage */
  }
  return new MemoryStore();
}

/** Small persistent key/value profile (settings, achievements, last world). */
export const profile = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('aeonis:' + key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem('aeonis:' + key, JSON.stringify(value));
    } catch {
      /* storage full / unavailable */
    }
  },
};
