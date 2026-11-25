import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  IndexedDbFileStore,
  LEGACY_FILES_KEY,
  LEGACY_SESSION_KEY,
  LocalStorageFileStore,
  SavedFile,
} from './file-store';

const file = (id: string, savedAt: number, content = '{}'): SavedFile => ({
  id,
  name: id,
  content,
  savedAt,
});

describe('IndexedDbFileStore', () => {
  beforeEach(() => {
    (globalThis as any).indexedDB = new IDBFactory(); // a fresh, empty database per test
    localStorage.clear();
  });

  it('stores, lists newest first and deletes files', async () => {
    const store = new IndexedDbFileStore();
    await store.put(file('old', 1));
    await store.put(file('new', 2));
    expect((await store.load()).map((f) => f.id)).toEqual(['new', 'old']);

    await store.delete('old');
    expect((await store.load()).map((f) => f.id)).toEqual(['new']);
  });

  it('keeps writes from two tabs (two store instances)', async () => {
    const a = new IndexedDbFileStore();
    const b = new IndexedDbFileStore();
    await a.load();
    await b.load();
    await a.put(file('a', 1));
    await b.put(file('b', 2));
    expect((await a.load()).map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('moves files saved by earlier versions out of localStorage, once', async () => {
    localStorage.setItem(
      LEGACY_FILES_KEY,
      JSON.stringify([file('legacy', 5, '{"x":1}'), { junk: true }]),
    );
    const store = new IndexedDbFileStore();
    expect(await store.load()).toEqual([file('legacy', 5, '{"x":1}')]);
    expect(localStorage.getItem(LEGACY_FILES_KEY)).toBeNull();
  });

  it('holds files larger than localStorage allows', async () => {
    const store = new IndexedDbFileStore();
    const big = file('big', 1, JSON.stringify({ s: 'x'.repeat(8 * 1024 * 1024) }));
    await store.put(big);
    expect((await store.load())[0].content.length).toBe(big.content.length);
  });

  describe('session', () => {
    const session = { version: 1, left: { text: '{"a":1}' } };

    it('is null until one is saved, then returns the latest', async () => {
      const store = new IndexedDbFileStore();
      expect(await store.loadSession()).toBeNull();
      await store.saveSession(session);
      await store.saveSession({ ...session, version: 2 });
      expect(await store.loadSession()).toEqual({ ...session, version: 2 });
    });

    it('is shared with a second store instance (a reload)', async () => {
      await new IndexedDbFileStore().saveSession(session);
      expect(await new IndexedDbFileStore().loadSession()).toEqual(session);
    });

    it('does not touch the saved files', async () => {
      const store = new IndexedDbFileStore();
      await store.put(file('a', 1));
      await store.saveSession(session);
      expect((await store.load()).map((f) => f.id)).toEqual(['a']);
    });

    it('moves a session saved by earlier versions out of localStorage, once', async () => {
      localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(session));
      const store = new IndexedDbFileStore();
      expect(await store.loadSession()).toEqual(session);
      expect(localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    });

    it('keeps a newer session already in the database over the legacy one', async () => {
      await new IndexedDbFileStore().saveSession({ version: 1, newer: true });
      localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(session));
      expect(await new IndexedDbFileStore().loadSession()).toEqual({ version: 1, newer: true });
      expect(localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    });

    it('drops a corrupt legacy session', async () => {
      localStorage.setItem(LEGACY_SESSION_KEY, '{not json');
      const store = new IndexedDbFileStore();
      expect(await store.loadSession()).toBeNull();
      expect(localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    });

    it('upgrades a version 1 database without losing its files', async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('json-viewer', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
        req.onsuccess = () => {
          const tx = req.result.transaction('files', 'readwrite');
          tx.objectStore('files').put(file('old', 1));
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
        };
        req.onerror = () => reject(req.error);
      });
      const store = new IndexedDbFileStore();
      expect((await store.load()).map((f) => f.id)).toEqual(['old']);
      await store.saveSession(session);
      expect(await store.loadSession()).toEqual(session);
    });

    it('keeps larger unsaved text than localStorage does', () => {
      expect(new IndexedDbFileStore().maxSessionText).toBeGreaterThan(
        new LocalStorageFileStore().maxSessionText,
      );
    });
  });
});

describe('LocalStorageFileStore', () => {
  beforeEach(() => localStorage.clear());

  it('re-reads storage on each write, so another tab’s file survives', async () => {
    const a = new LocalStorageFileStore();
    const b = new LocalStorageFileStore();
    await a.put(file('a', 1));
    await b.put(file('b', 2));
    expect((await a.load()).map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('rejects when storage is full', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await expect(new LocalStorageFileStore().put(file('a', 1))).rejects.toThrow();
    spy.mockRestore();
  });

  it('saves and loads the session', async () => {
    const store = new LocalStorageFileStore();
    expect(await store.loadSession()).toBeNull();
    await store.saveSession({ version: 1 });
    expect(await new LocalStorageFileStore().loadSession()).toEqual({ version: 1 });
  });

  it('rejects a session save when storage is full', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await expect(new LocalStorageFileStore().saveSession({ version: 1 })).rejects.toThrow();
    spy.mockRestore();
  });
});
