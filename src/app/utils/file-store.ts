export interface SavedFile {
  id: string;
  name: string;
  content: string;
  savedAt: number;
}

/**
 * Persistent store for saved files. Every write touches one file only, so two tabs
 * saving different files never overwrite each other. Other tabs are told about a
 * write so they can reload their list.
 */
export interface FileStore {
  /** All files, most recently saved first. */
  load(): Promise<SavedFile[]>;
  /** Adds or replaces a file. Rejects when the browser refuses (e.g. storage full). */
  put(file: SavedFile): Promise<void>;
  delete(id: string): Promise<void>;
  /** Calls `listener` when another tab changes the files. */
  watch(listener: () => void): () => void;
}

export const LEGACY_FILES_KEY = 'json-viewer-files';
const DB_NAME = 'json-viewer';
const STORE = 'files';
const CHANNEL = 'json-viewer-files';

const newestFirst = (files: SavedFile[]) => files.sort((a, b) => b.savedAt - a.savedAt);

function isSavedFile(f: any): f is SavedFile {
  return !!f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.content === 'string';
}

function readLegacy(): SavedFile[] {
  try {
    const raw = localStorage.getItem(LEGACY_FILES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(isSavedFile) : [];
  } catch {
    return [];
  }
}

const done = (req: IDBRequest | IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    if (req instanceof IDBTransaction) {
      req.oncomplete = () => resolve();
      req.onerror = req.onabort = () => reject(req.error ?? new Error('Transaction failed'));
    } else {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }
  });

/** IndexedDB store: no 5 MB limit, one record per file. */
export class IndexedDbFileStore implements FileStore {
  private db?: Promise<IDBDatabase>;
  private channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).then((db) => this.migrate(db)));
  }

  /** Moves files saved by earlier versions (in localStorage) into the database, once. */
  private async migrate(db: IDBDatabase): Promise<IDBDatabase> {
    const legacy = readLegacy();
    if (legacy.length) {
      const tx = db.transaction(STORE, 'readwrite');
      // `add` keeps any newer copy that is already in the database.
      for (const f of legacy) tx.objectStore(STORE).add(f).onerror = (e) => e.preventDefault();
      await done(tx);
    }
    try {
      localStorage.removeItem(LEGACY_FILES_KEY);
    } catch {
      /* ignore */
    }
    return db;
  }

  async load(): Promise<SavedFile[]> {
    const db = await this.open();
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    await done(req);
    return newestFirst((req.result as any[]).filter(isSavedFile));
  }

  async put(file: SavedFile): Promise<void> {
    const tx = (await this.open()).transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(file);
    await done(tx);
    this.channel?.postMessage('changed');
  }

  async delete(id: string): Promise<void> {
    const tx = (await this.open()).transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await done(tx);
    this.channel?.postMessage('changed');
  }

  watch(listener: () => void): () => void {
    const ch = this.channel;
    if (!ch) return () => {};
    const handler = () => listener();
    ch.addEventListener('message', handler);
    return () => ch.removeEventListener('message', handler);
  }
}

/**
 * Fallback when IndexedDB is unavailable. Each write re-reads the stored list and
 * changes only its own file, so concurrent tabs do not lose each other's saves.
 */
export class LocalStorageFileStore implements FileStore {
  async load(): Promise<SavedFile[]> {
    return newestFirst(readLegacy());
  }

  async put(file: SavedFile): Promise<void> {
    this.write([file, ...readLegacy().filter((f) => f.id !== file.id)]);
  }

  async delete(id: string): Promise<void> {
    this.write(readLegacy().filter((f) => f.id !== id));
  }

  /** Throws (so the caller's save is reported as failed) when storage is full. */
  private write(files: SavedFile[]): void {
    localStorage.setItem(LEGACY_FILES_KEY, JSON.stringify(newestFirst(files)));
  }

  watch(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = (e: StorageEvent) => e.key === LEGACY_FILES_KEY && listener();
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}

export function createFileStore(): FileStore {
  return typeof indexedDB !== 'undefined' ? new IndexedDbFileStore() : new LocalStorageFileStore();
}
