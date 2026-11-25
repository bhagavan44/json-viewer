import { Page } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';

/**
 * Builds a `#s=` share link, the same format `encodeShare()` writes: uncompressed, or
 * compressed for large documents (an uncompressed link is limited in length).
 */
export function shareHash(left: string, right: string, view: 'edit' | 'compare' = 'edit'): string {
  const json = Buffer.from(JSON.stringify({ v: 1, l: left, r: right, m: view }), 'utf8');
  return json.length > 50_000
    ? '#s=z.' + deflateRawSync(json).toString('base64url')
    : '#s=r.' + json.toString('base64url');
}

/** Opens the app with both panes filled from a share link. */
export async function openShared(
  page: Page,
  left: string,
  right: string,
  view: 'edit' | 'compare' = 'edit',
): Promise<void> {
  await page.goto('/' + shareHash(left, right, view));
  await page.getByText('Opened the shared documents').waitFor();
}

export const leftPanel = (page: Page) => page.locator('.left-panel');
export const rightPanel = (page: Page) => page.locator('.right-panel');

/** A pane as the stored session has it (see `paneSession()` in app.ts). */
export interface StoredPane {
  text?: string | null;
  fileId?: string | null;
}

/**
 * The session the app stored in IndexedDB, or null before the first save. Autosave runs
 * 500 ms after a change, so poll it: `await expect.poll(() => storedSession(page)…)`.
 */
export const storedSession = (
  page: Page,
): Promise<{ left?: StoredPane; right?: StoredPane } | null> =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('json-viewer');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('session')) return (resolve(null), db.close());
          const get = db.transaction('session').objectStore('session').get('current');
          get.onsuccess = () => (resolve(get.result ?? null), db.close());
          get.onerror = () => (resolve(null), db.close());
        };
      }),
  );

/** The snackbar's action button, such as Undo. */
export const snackAction = (page: Page, name: string) =>
  page.locator('.mat-mdc-snack-bar-container').getByRole('button', { name });

/**
 * The clipboard's text, with `\n` line endings (the Windows clipboard turns them into `\r\n`).
 * Needs `test.use({ permissions: ['clipboard-read', 'clipboard-write'] })`.
 */
export const readClipboard = async (page: Page): Promise<string> =>
  (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
