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
