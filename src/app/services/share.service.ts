import { Injectable, OnDestroy } from '@angular/core';
import {
  SHARE_HASH_PREFIX,
  SHARE_MAX_CHARS,
  SHARE_WARN_CHARS,
  SharedState,
  decodeShare,
  encodeShare,
} from '../utils/share-link';

/** What happened when a share link was copied. */
export type ShareOutcome =
  /** Copied. A `long` link may be cut off by some chat apps. */
  | { status: 'copied'; long: boolean }
  /** Nothing was copied: the documents are too large for a link. */
  | { status: 'too-large' }
  /** Nothing was copied: the clipboard refused it. */
  | { status: 'denied' };

/**
 * Share links keep both panes in the URL hash. Copies a link for the current documents, and reads
 * the documents back from a `#s=` hash, at startup or whenever the address bar's hash changes.
 */
@Injectable()
export class ShareService implements OnDestroy {
  private onHashChange?: () => void;

  /** Copies a link that reopens `state` for whoever opens it. */
  async copyLink(state: SharedState): Promise<ShareOutcome> {
    try {
      const payload = await encodeShare(state);
      if (payload.length > SHARE_MAX_CHARS) return { status: 'too-large' };
      const url = `${location.origin}${location.pathname}${SHARE_HASH_PREFIX}${payload}`;
      await navigator.clipboard.writeText(url);
      return { status: 'copied', long: payload.length > SHARE_WARN_CHARS };
    } catch {
      return { status: 'denied' };
    }
  }

  /** Whether `hash` (as in `location.hash`) is a share link. */
  isShareLink(hash: string): boolean {
    return hash.startsWith(SHARE_HASH_PREFIX);
  }

  /** The documents in a share link. Rejects with a `ShareLinkError` when it cannot be opened. */
  read(hash: string): Promise<SharedState> {
    return decodeShare(hash.slice(SHARE_HASH_PREFIX.length));
  }

  /** Drops the hash, so a reload shows the session instead of opening the link again. */
  clearHash(): void {
    history.replaceState(null, '', location.pathname + location.search);
  }

  /** Calls `open` with the new hash whenever the address bar's hash changes. */
  watch(open: (hash: string) => void): void {
    this.unwatch();
    this.onHashChange = () => open(location.hash);
    window.addEventListener('hashchange', this.onHashChange);
  }

  ngOnDestroy(): void {
    this.unwatch();
  }

  private unwatch(): void {
    if (this.onHashChange) window.removeEventListener('hashchange', this.onHashChange);
    this.onHashChange = undefined;
  }
}
