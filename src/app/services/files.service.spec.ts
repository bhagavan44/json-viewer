import { FileStore, LEGACY_FILES_KEY, LocalStorageFileStore, SavedFile } from '../utils/file-store';
import { FilesService } from './files.service';

const file = (id: string, name: string, content: string, savedAt = 0): SavedFile => ({
  id,
  name,
  content,
  savedAt,
});

/** A store kept in memory. `refuse` makes every write fail, as a full browser storage does. */
function memoryStore(files: SavedFile[] = []): FileStore & {
  files: SavedFile[];
  refuse: boolean;
  notify: () => void;
} {
  let listener = () => undefined as void;
  const store = {
    files: [...files],
    refuse: false,
    notify: () => listener(),
    maxSessionText: 1000,
    load: async () => [...store.files].sort((a, b) => b.savedAt - a.savedAt),
    put: async (f: SavedFile) => {
      if (store.refuse) throw new DOMException('full', 'QuotaExceededError');
      store.files = [f, ...store.files.filter((x) => x.id !== f.id)];
    },
    delete: async (id: string) => {
      if (store.refuse) throw new DOMException('full', 'QuotaExceededError');
      store.files = store.files.filter((x) => x.id !== id);
    },
    watch: (l: () => void) => {
      listener = l;
      return () => (listener = () => undefined);
    },
    loadSession: async () => null,
    saveSession: async () => undefined,
  };
  return store;
}

describe('FilesService', () => {
  let service: FilesService;
  beforeEach(() => {
    localStorage.clear();
    service = new FilesService();
  });
  afterEach(() => service.ngOnDestroy());

  it('loads the files, most recently saved first', async () => {
    const store = memoryStore([file('a', 'old', '1', 1), file('b', 'new', '2', 2)]);
    expect((await service.load(store)).map((f) => f.id)).toEqual(['b', 'a']);
    expect(service.list.map((f) => f.id)).toEqual(['b', 'a']);
    expect(service.store).toBe(store);
  });

  it('falls back to localStorage when the store cannot be opened', async () => {
    localStorage.setItem(LEGACY_FILES_KEY, JSON.stringify([file('a', 'kept', '{}')]));
    const blocked = memoryStore();
    blocked.load = () => Promise.reject(new Error('blocked'));

    expect((await service.load(blocked)).map((f) => f.name)).toEqual(['kept']);
    expect(service.store).toBeInstanceOf(LocalStorageFileStore);
  });

  it('saves a new file at the top, and saves over an existing one in place', async () => {
    const store = memoryStore([file('a', 'first', '1', 1)]);
    await service.load(store);

    const created = await service.save('second', '2');
    expect(service.list.map((f) => f.name)).toEqual(['second', 'first']);
    expect(store.files).toContainEqual(created);

    const updated = await service.save('first', '3', 'a');
    expect(updated.id).toBe('a');
    expect(service.list.map((f) => [f.id, f.content])).toEqual([
      ['a', '3'],
      [created.id, '2'],
    ]);
  });

  it('renames, deletes and restores a file in its place', async () => {
    const store = memoryStore([file('a', 'one', '1', 1), file('b', 'two', '2', 2)]);
    await service.load(store);

    await service.rename(service.find('a')!, 'renamed');
    expect(service.find('a')?.name).toBe('renamed');
    expect(store.files.find((f) => f.id === 'a')?.name).toBe('renamed');

    const deleted = service.find('b')!;
    await service.delete('b');
    expect(service.find('b')).toBeUndefined();
    expect(store.files.map((f) => f.id)).toEqual(['a']);

    await service.restore(deleted);
    expect(service.list.map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('leaves the list unchanged when the browser refuses a write', async () => {
    const store = memoryStore([file('a', 'one', '1')]);
    await service.load(store);
    const before = service.list;
    store.refuse = true;

    await expect(service.save('two', '2')).rejects.toThrow();
    await expect(service.rename(before[0], 'renamed')).rejects.toThrow();
    await expect(service.delete('a')).rejects.toThrow();
    expect(service.list).toBe(before);
  });

  it('finds files by id, and nothing for no id', async () => {
    await service.load(memoryStore([file('a', 'one', '1')]));
    expect(service.find('a')?.name).toBe('one');
    expect(service.find('missing')).toBeUndefined();
    expect(service.find(null)).toBeUndefined();
  });

  it('filters by name and by content, ignoring case, and reuses the result', async () => {
    await service.load(
      memoryStore([
        file('1', 'orders', '{"sku":"KB-114"}'),
        file('2', 'users', '{"name":"Priya"}'),
      ]),
    );

    expect(service.filter('  ')).toBe(service.list);
    expect(service.filter('ORDER').map((f) => f.id)).toEqual(['1']);
    expect(service.filter('priya').map((f) => f.id)).toEqual(['2']);
    expect(service.filter('priya')).toBe(service.filter('Priya'));
  });

  it('reloads the list when another tab changes the files, until it is destroyed', async () => {
    const store = memoryStore([file('a', 'one', '1')]);
    await service.load(store);
    let changes = 0;
    service.watch(() => changes++);

    store.files = [...store.files, file('b', 'from another tab', '2')];
    store.notify();
    await vi.waitFor(() => expect(changes).toBe(1));
    expect(service.list.map((f) => f.id).sort()).toEqual(['a', 'b']);

    service.ngOnDestroy();
    store.notify();
    await Promise.resolve();
    expect(changes).toBe(1);
  });
});
