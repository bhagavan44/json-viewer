import { expect, test } from '@playwright/test';
import { leftPanel, openShared, rightPanel } from './helpers';

test('loads the workspace and the Monaco editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-title')).toHaveText('JSON Viewer');
  // Monaco is served from /vs/; this fails if the assets or the SPA rewrite break.
  await expect(leftPanel(page).locator('.monaco-editor')).toBeVisible();
  await expect(rightPanel(page).locator('.monaco-editor')).toBeVisible();
  await expect(leftPanel(page).locator('.status-badge')).toContainText('Empty');
});

test('opens a share link and shows the document as a tree', async ({ page }) => {
  await openShared(page, '{"order":{"id":42,"items":[{"sku":"A1","qty":2}]}}', '[]');
  const left = leftPanel(page);
  await expect(left.locator('.status-badge')).toContainText('Valid');

  await left.getByRole('button', { name: 'Tree view' }).click();
  await expect(left.locator('.node-key', { hasText: 'order' })).toBeVisible();
});

test('keeps every digit of large numbers in the tree', async ({ page }) => {
  await openShared(page, '{"id":12345678901234567890,"price":0.10000000000000000001}', '{}');
  const left = leftPanel(page);
  await left.getByRole('button', { name: 'Tree view' }).click();
  await expect(left.locator('.node-value', { hasText: '12345678901234567890' })).toBeVisible();
  await expect(left.locator('.node-value', { hasText: '0.10000000000000000001' })).toBeVisible();
});

test('runs a JSONPath query in the tree search', async ({ page }) => {
  const doc = '{"items":[{"sku":"A1","qty":1},{"sku":"B2","qty":3},{"sku":"C3","qty":5}]}';
  await openShared(page, doc, '{}');
  const left = leftPanel(page);
  await left.getByRole('button', { name: 'Tree view' }).click();

  await left.locator('.tb-input').fill('$.items[?(@.qty > 1)].sku');
  await expect(left.locator('.tb-count')).toContainText('2');
});

test('repairs text that is not quite JSON', async ({ page }) => {
  await openShared(page, "{name: 'x', tags: ['a',],}", '{}');
  const left = leftPanel(page);
  await expect(left.locator('.status-badge')).toContainText('Invalid');

  await left.locator('.fix-btn').click();
  await expect(left.locator('.status-badge')).toContainText('Valid');
});

test('compares two documents', async ({ page }) => {
  await openShared(page, '{"a":1,"b":2,"c":3}', '{"a":1,"b":20,"d":4}', 'compare');
  const bar = page.locator('.compare-bar');
  await expect(bar.locator('.stat.add')).toContainText('+1 added');
  await expect(bar.locator('.stat.del')).toContainText('1 removed');
  await expect(bar.locator('.stat.chg')).toContainText('~1 changed');
  await expect(page.locator('.changes-header')).toContainText('3 differences');
});

test('compares large documents in a Web Worker', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  const items = (n: number, qty: (i: number) => number) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({ id: i, name: `Item number ${i}`, qty: qty(i) })),
      null,
      2,
    );
  // About 300 kB each: well above the size at which Compare moves to the worker.
  const before = items(4000, () => 1);
  const after = items(4001, (i) => (i % 1000 === 0 ? 2 : 1));
  await openShared(page, before, after, 'compare');

  const bar = page.locator('.compare-bar');
  await expect(bar.locator('.stat.add')).toContainText('+1 added');
  await expect(bar.locator('.stat.chg')).toContainText('~4 changed');
  await expect(page.locator('.changes-header')).toContainText('5 differences');
  await expect(page.locator('.change-item').first()).toContainText('1 → 2');
  expect(workers.some((url) => /\/worker-[A-Z0-9]+\.js(\?|$)/.test(url))).toBe(true);
});

test('opens the command palette with Ctrl+K', async ({ page }) => {
  await page.goto('/');
  await expect(leftPanel(page).locator('.monaco-editor')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('combobox', { name: 'Search actions' });
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();
});
