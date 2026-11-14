import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbFileStore, LEGACY_FILES_KEY, LocalStorageFileStore, SavedFile } from './file-store';

const file = (id: string, savedAt: number, content = '{}'): SavedFile => ({ id, name: id, content, savedAt });

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
    localStorage.setItem(LEGACY_FILES_KEY, JSON.stringify([file('legacy', 5, '{"x":1}'), { junk: true }]));
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
});
