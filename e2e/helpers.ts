import { Page } from '@playwright/test';

/** Builds an uncompressed `#s=` share link, the same format `encodeShare()` writes. */
export function shareHash(left: string, right: string, view: 'edit' | 'compare' = 'edit'): string {
  const json = JSON.stringify({ v: 1, l: left, r: right, m: view });
  return '#s=r.' + Buffer.from(json, 'utf8').toString('base64url');
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
