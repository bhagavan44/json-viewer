import {
  EffectRef,
  EnvironmentInjector,
  Injectable,
  OnDestroy,
  effect,
  inject,
} from '@angular/core';
import { FileStore, SavedFile } from '../utils/file-store';
import { RestoredSession, SessionState, readSession, toSession } from '../utils/session';

/** How long the app must be still before the session is saved. */
export const SESSION_SAVE_DELAY_MS = 500;

/**
 * Restores the previous session and saves the current one shortly after it changes, so a reload
 * brings back the panes, their unsaved text and the view.
 */
@Injectable()
export class SessionService implements OnDestroy {
  /**
   * Saving is not part of rendering, so the effect is created in the app's injector rather than
   * the component's: it then runs whenever the app is checked, without waiting for the view.
   */
  private readonly injector = inject(EnvironmentInjector);
  private store?: FileStore;
  /** Reads the current state. Set once the session is restored; nothing is saved before that. */
  private read?: () => SessionState;
  private watcher?: EffectRef;
  private timer?: ReturnType<typeof setTimeout>;

  /** The stored session, or null when there is none or it cannot be used. */
  async restore(store: FileStore, savedFiles: SavedFile[]): Promise<RestoredSession | null> {
    try {
      return readSession(await store.loadSession(), savedFiles);
    } catch {
      return null;
    }
  }

  /**
   * Starts saving. Call it once the restored session is applied, so it is not overwritten.
   *
   * `read` must get everything it returns from signals: the session is saved again whenever one
   * of the signals it read changes, so a value that is not a signal is stored but never noticed.
   */
  start(store: FileStore, read: () => SessionState): void {
    this.store = store;
    this.read = read;
    this.watcher?.destroy();
    this.watcher = effect(
      () => {
        read();
        this.schedule();
      },
      { injector: this.injector, manualCleanup: true },
    );
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
    this.watcher?.destroy();
    clearTimeout(this.timer);
  }

  /** Saves once nothing has changed for a moment. Each change restarts the delay. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.persist(), SESSION_SAVE_DELAY_MS);
  }
}
