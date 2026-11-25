import { expect, test } from '@playwright/test';
import { leftPanel } from './helpers';

/** About 5 MB: 25,000 records, so the tree has to stay virtual and search has to be quick. */
function largeDocument(): string {
  const records = Array.from({ length: 25_000 }, (_, i) => ({
    id: i,
    sku: `SKU-${String(i).padStart(6, '0')}`,
    name: `Product number ${i}`,
    price: Math.round(i * 137) / 100,
    tags: ['catalogue', i % 2 ? 'odd' : 'even', `group-${i % 50}`],
    stock: { warehouse: `WH-${i % 7}`, qty: i % 13, reserved: i % 3 === 0 },
  }));
  return JSON.stringify({ generatedAt: '2026-01-01T00:00:00Z', records }, null, 2);
}

test('opens a large file and searches it in the tree', async ({ page }) => {
  test.slow();
  const text = largeDocument();
  expect(text.length).toBeGreaterThan(5_000_000);

  await page.goto('/');
  const left = leftPanel(page);
  await expect(left.locator('.monaco-editor')).toBeVisible();

  const started = Date.now();
  const chooser = page.waitForEvent('filechooser');
  await left.getByRole('button', { name: 'Open file' }).click();
  await (
    await chooser
  ).setFiles({ name: 'catalogue.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(left.locator('.status-badge')).toContainText('Valid', { timeout: 20_000 });
  await expect(left.locator('.panel-name')).toHaveText('catalogue.json');

  await left.getByRole('button', { name: 'Tree view' }).click();
  await expect(left.locator('.node-row[data-path="$.records"]')).toBeVisible();
  // Only the rows in view are rendered.
  expect(await left.locator('.node-row').count()).toBeLessThan(200);

  await left.locator('.tb-input').fill('SKU-024999');
  await expect(left.locator('.tb-count')).toHaveText('1 / 1');
  await expect(left.locator('.node-row.active-match')).toHaveAttribute(
    'data-path',
    '$.records[24999].sku',
  );

  await left.locator('.tb-input').fill('$.records[?(@.stock.qty == 12)].id');
  await expect(left.locator('.tb-count')).toHaveText('1 / 1923');
  // Generous, so a slow CI runner does not fail it; it catches a tree or search that hangs.
  expect(Date.now() - started).toBeLessThan(30_000);
});
