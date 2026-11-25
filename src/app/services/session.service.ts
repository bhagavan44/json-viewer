import { Injectable, OnDestroy } from '@angular/core';
import { FileStore, SavedFile } from '../utils/file-store';
import {
  RestoredSession,
  SessionState,
  readSession,
  sameValues,
  sessionValues,
  toSession,
} from '../utils/session';

/** How long the app must be still before the session is saved. */
export const SESSION_SAVE_DELAY_MS = 500;

/**
 * Restores the previous session and saves the current one shortly after it changes, so a reload
 * brings back the panes, their unsaved text and the view.
 */
@Injectable()
export class SessionService implements OnDestroy {
  private store?: FileStore;
  /** Reads the current state. Set once the session is restored; nothing is saved before that. */
  private read?: () => SessionState;
  private timer?: ReturnType<typeof setTimeout>;
  private seen: unknown[] = [];

  /** The stored session, or null when there is none or it cannot be used. */
  async restore(store: FileStore, savedFiles: SavedFile[]): Promise<RestoredSession | null> {
    try {
      return readSession(await store.loadSession(), savedFiles);
    } catch {
      return null;
    }
  }

  /** Starts saving. Call it once the restored session is applied, so it is not overwritten. */
  start(store: FileStore, read: () => SessionState): void {
    this.store = store;
    this.read = read;
  }

  /** Schedules a save when anything the session remembers has changed. Cheap enough for every render. */
  check(): void {
    if (!this.read) return;
    const values = sessionValues(this.read());
    if (sameValues(values, this.seen)) return;
    this.seen = values;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.persist(), SESSION_SAVE_DELAY_MS);
  }

  /** Saves at once, e.g. when the tab is hidden or closed, so a change made just before is not lost. */
  flush(): void {
    if (!this.read) return;
    clearTimeout(this.timer);
    void this.persist();
  }

  /** Writes the session without blocking typing. Resolves once it is stored (or the browser refused). */
  async persist(): Promise<void> {
    if (!this.store || !this.read) return;
    try {
      await this.store.saveSession(toSession(this.read(), this.store.maxSessionText));
    } catch {
      /* storage full or unavailable: the session just will not be restored */
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
