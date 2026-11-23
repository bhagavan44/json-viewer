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
  /** The last saved session, or null when there is none. The caller validates its shape. */
  loadSession(): Promise<unknown>;
  /** Replaces the saved session. Rejects when the browser refuses (e.g. storage full). */
  saveSession(session: unknown): Promise<void>;
  /** Longest unsaved text, in characters, that the session may keep for one pane. */
  readonly maxSessionText: number;
}

export const LEGACY_FILES_KEY = 'json-viewer-files';
export const LEGACY_SESSION_KEY = 'json-viewer-session';
const DB_NAME = 'json-viewer';
const DB_VERSION = 2;
const STORE = 'files';
const SESSION_STORE = 'session';
/** The session is one record under this key. */
const SESSION_ID = 'current';
/** localStorage holds about 5 MB for the whole origin, shared with the saved-files fallback. */
const LOCAL_SESSION_LIMIT = 2_000_000;
const INDEXED_DB_SESSION_LIMIT = 20_000_000;
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

function readLegacySession(): unknown {
  try {
    const raw = localStorage.getItem(LEGACY_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
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
  readonly maxSessionText = INDEXED_DB_SESSION_LIMIT;

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'id' });
        if (e.oldVersion < 2) db.createObjectStore(SESSION_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let a newer version of the app upgrade the database while this tab is still open.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      // A tab running the previous version keeps the old schema open and blocks the upgrade.
      // Fail instead of waiting, so the app falls back to local storage until that tab closes.
      req.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
    }).then((db) => this.migrate(db)));
  }

  /** Moves files and the session saved by earlier versions (in localStorage) into the database, once. */
  private async migrate(db: IDBDatabase): Promise<IDBDatabase> {
    const legacy = readLegacy();
    const legacySession = readLegacySession();
    if (legacy.length || legacySession) {
      const tx = db.transaction([STORE, SESSION_STORE], 'readwrite');
      // `add` keeps any newer copy that is already in the database.
      const keepExisting = (e: Event) => {
        // A duplicate key is expected. Stop the event, or it aborts the whole transaction.
        e.preventDefault();
        e.stopPropagation();
      };
      for (const f of legacy) tx.objectStore(STORE).add(f).onerror = keepExisting;
      if (legacySession) tx.objectStore(SESSION_STORE).add(legacySession, SESSION_ID).onerror = keepExisting;
      await done(tx);
    }
    for (const key of [LEGACY_FILES_KEY, LEGACY_SESSION_KEY]) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
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

  async loadSession(): Promise<unknown> {
    const req = (await this.open()).transaction(SESSION_STORE).objectStore(SESSION_STORE).get(SESSION_ID);
    await done(req);
    return req.result ?? null;
  }

  async saveSession(session: unknown): Promise<void> {
    const tx = (await this.open()).transaction(SESSION_STORE, 'readwrite');
    tx.objectStore(SESSION_STORE).put(session, SESSION_ID);
    await done(tx);
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
  readonly maxSessionText = LOCAL_SESSION_LIMIT;

  async load(): Promise<SavedFile[]> {
    return newestFirst(readLegacy());
  }

  async put(file: SavedFile): Promise<void> {
    this.write([file, ...readLegacy().filter((f) => f.id !== file.id)]);
  }

  async delete(id: string): Promise<void> {
    this.write(readLegacy().filter((f) => f.id !== id));
  }

  async loadSession(): Promise<unknown> {
    return readLegacySession();
  }

  async saveSession(session: unknown): Promise<void> {
    localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(session));
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
