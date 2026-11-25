import { Injectable, OnDestroy } from '@angular/core';
import { FileStore, LocalStorageFileStore, SavedFile, createFileStore } from '../utils/file-store';

/**
 * The saved files. Loads them, keeps the list in step with other tabs, and saves, renames and
 * deletes them. The list only changes once the browser has actually stored the change; a refused
 * write rejects and leaves the list as it was.
 */
@Injectable()
export class FilesService implements OnDestroy {
  /** Most recently saved first. Replaced, never mutated, whenever the files change. */
  list: SavedFile[] = [];
  private current: FileStore = createFileStore();
  private unwatch?: () => void;
  /** The file list is filtered on every render; this keeps it from being re-scanned each time. */
  private filtered: { files: SavedFile[]; query: string; result: SavedFile[] } | null = null;

  /** Where the files and the session are kept. Can change during `load()`. */
  get store(): FileStore {
    return this.current;
  }

  /** Loads the files from `store` (by default the browser's IndexedDB) into `list`. */
  async load(store: FileStore = this.current): Promise<SavedFile[]> {
    this.current = store;
    try {
      this.list = await store.load();
    } catch {
      // IndexedDB can be blocked (e.g. some private modes): fall back to localStorage.
      this.current = new LocalStorageFileStore();
      this.list = await this.current.load().catch(() => []);
    }
    return this.list;
  }

  /** Reloads the list whenever another tab saves, renames or deletes a file, then calls `changed`. */
  watch(changed: () => void): void {
    this.unwatch?.();
    this.unwatch = this.current.watch(() => void this.reload(changed));
  }

  find(id: string | null): SavedFile | undefined {
    return id === null ? undefined : this.list.find((f) => f.id === id);
  }

  /** The files whose name or content contains `query`, ignoring case. All of them for no query. */
  filter(query: string): SavedFile[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list;
    const memo = this.filtered;
    if (memo && memo.files === this.list && memo.query === q) return memo.result;
    const result = this.list.filter(
      (f) => f.name.toLowerCase().includes(q) || f.content.toLowerCase().includes(q),
    );
    this.filtered = { files: this.list, query: q, result };
    return result;
  }

  /** Stores `content` as a new file, or over the file with `id`, and moves it to the top. */
  async save(name: string, content: string, id?: string): Promise<SavedFile> {
    const file: SavedFile = {
      id: id ?? Date.now().toString(36) + Math.random().toString(36).slice(2),
      name,
      content,
      savedAt: Date.now(),
    };
    await this.current.put(file);
    this.list = [file, ...this.list.filter((f) => f.id !== file.id)];
    return file;
  }

  async rename(file: SavedFile, name: string): Promise<SavedFile> {
    const renamed = { ...file, name };
    await this.current.put(renamed);
    this.list = this.list.map((f) => (f.id === file.id ? renamed : f));
    return renamed;
  }

  async delete(id: string): Promise<void> {
    await this.current.delete(id);
    this.list = this.list.filter((f) => f.id !== id);
  }

  /** Undo for a delete: stores the file again, back in its place in the list. */
  async restore(file: SavedFile): Promise<void> {
    await this.current.put(file);
    this.list = [...this.list.filter((f) => f.id !== file.id), file].sort(
      (a, b) => b.savedAt - a.savedAt,
    );
  }

  ngOnDestroy(): void {
    this.unwatch?.();
  }

  private async reload(changed: () => void): Promise<void> {
    try {
      this.list = await this.current.load();
      changed();
    } catch {
      /* keep the current list */
    }
  }
}
