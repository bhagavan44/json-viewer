import { expect, test } from '@playwright/test';
import { leftPanel, openShared, readClipboard, rightPanel } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const before = '{"a":1,"b":2,"c":3}';
const after = '{"a":1,"b":20,"d":4,"e":5}';

test('shows the counts and lists each difference', async ({ page }) => {
  await openShared(page, before, after, 'compare');
  const bar = page.locator('.compare-bar');
  await expect(bar.locator('.stat.add')).toContainText('+2 added');
  await expect(bar.locator('.stat.del')).toContainText('1 removed');
  await expect(bar.locator('.stat.chg')).toContainText('~1 changed');

  const changes = page.locator('.change-item');
  await expect(changes).toHaveCount(4);
  await expect(changes.filter({ hasText: '$.b' })).toContainText('2 → 20');
  await expect(changes.filter({ hasText: '$.c' })).toContainText('3');
  await expect(leftPanel(page).locator('.node-row.mark-chg[data-path="$.b"]')).toBeVisible();
  await expect(rightPanel(page).locator('.node-row.mark-add[data-path="$.d"]')).toBeVisible();
});

test('says when the documents are identical', async ({ page }) => {
  await openShared(page, '{"a":1,"b":[1,2]}', '{"b":[1,2],"a":1}', 'compare');
  await expect(page.locator('.compare-bar .identical')).toBeVisible();
  await expect(page.locator('.changes-header')).toContainText('0 differences');
});

test('hides unchanged nodes with Changes only', async ({ page }) => {
  await openShared(page, before, after, 'compare');
  const left = leftPanel(page);
  await expect(left.locator('.node-row[data-path="$.a"]')).toBeVisible();

  await page.locator('.compare-bar').getByLabel('Changes only').check();
  await expect(left.locator('.node-row[data-path="$.a"]')).toHaveCount(0);
  await expect(left.locator('.node-row[data-path="$.b"]')).toBeVisible();

  await page.locator('.compare-bar').getByLabel('Changes only').uncheck();
  await expect(left.locator('.node-row[data-path="$.a"]')).toBeVisible();
});

test('swaps the two sides', async ({ page }) => {
  await openShared(page, before, after, 'compare');
  const bar = page.locator('.compare-bar');
  await expect(bar.locator('.stat.add')).toContainText('+2 added');

  await bar.getByRole('button', { name: 'Swap sides' }).click();
  await expect(bar.locator('.stat.add')).toContainText('+1 added');
  await expect(bar.locator('.stat.del')).toContainText('2 removed');
  await expect(page.locator('.change-item').filter({ hasText: '$.b' })).toContainText('20 → 2');
  await expect(leftPanel(page).locator('.node-row[data-path="$.e"]')).toBeVisible();
});

test('leaves ignored paths out of the comparison', async ({ page }) => {
  await openShared(page, before, after, 'compare');
  const bar = page.locator('.compare-bar');
  const ignore = bar.getByLabel('Paths to ignore (JSONPath, comma-separated)');

  await ignore.fill('$.b, $.e');
  await expect(bar.locator('.stat.chg')).toContainText('~0 changed');
  await expect(bar.locator('.stat.add')).toContainText('+1 added');
  await expect(page.locator('.changes-header')).toContainText('2 differences');

  await ignore.fill('$.[');
  await expect(bar.locator('.ignore-error')).toBeVisible();

  await ignore.fill('');
  await expect(bar.locator('.ignore-error')).toHaveCount(0);
  await expect(page.locator('.changes-header')).toContainText('4 differences');
});

test('matches array items by key, or by position when turned off', async ({ page }) => {
  const items = (ids: number[]) =>
    JSON.stringify({ items: ids.map((id) => ({ id, name: `Item ${id}` })) });
  await openShared(page, items([1, 2, 3]), items([0, 1, 2, 3]), 'compare');
  const bar = page.locator('.compare-bar');
  await expect(bar.locator('.matched-by')).toContainText('Arrays matched by id');
  await expect(bar.locator('.stat.add')).toContainText('+1 added');
  await expect(bar.locator('.stat.chg')).toContainText('~0 changed');

  await bar.getByLabel('Match array items by key').uncheck();
  await expect(bar.locator('.matched-by')).toHaveCount(0);
  await expect(bar.locator('.stat.add')).toContainText('+1 added');
  await expect(bar.locator('.stat.chg')).toContainText('~6 changed');
});

test('copies a JSON Patch from the left document to the right one', async ({ page }) => {
  await openShared(page, before, after, 'compare');
  await page.locator('.compare-bar').getByRole('button', { name: 'JSON Patch' }).click();
  await expect(page.getByText('Copied JSON Patch: 4 operations')).toBeVisible();

  const patch = JSON.parse(await readClipboard(page)) as { op: string; path: string }[];
  expect(patch).toEqual(
    expect.arrayContaining([
      { op: 'replace', path: '/b', value: 20 },
      { op: 'remove', path: '/c' },
      { op: 'add', path: '/d', value: 4 },
      { op: 'add', path: '/e', value: 5 },
    ]),
  );
  expect(patch).toHaveLength(4);
});
