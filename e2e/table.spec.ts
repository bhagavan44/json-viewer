import { expect, Page, test } from '@playwright/test';
import { leftPanel, openShared, readClipboard } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const doc = JSON.stringify({
  customers: [
    { name: 'Ada', city: 'London', orders: 12 },
    { name: 'Grace', city: 'New York', orders: 3 },
    { name: 'Linus', city: 'Helsinki', orders: 25 },
    { name: 'Edsger', orders: 7 },
  ],
  orders: [
    { id: 1, lines: [{ sku: 'A1', qty: 2 }] },
    {
      id: 2,
      lines: [
        { sku: 'B2', qty: 1 },
        { sku: 'C3', qty: 4 },
      ],
    },
  ],
});

const table = (page: Page) => leftPanel(page).locator('app-json-table');
/** The cells of one column, top to bottom. */
const column = (page: Page, index: number) =>
  table(page).locator(`tbody tr td:nth-child(${index + 2})`);

test.beforeEach(async ({ page }) => {
  await openShared(page, doc, '{}');
  await leftPanel(page).getByRole('button', { name: 'Table view' }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(4);
});

test('lists the records of the first array, one column per key', async ({ page }) => {
  await expect(table(page).getByLabel('Array to show')).toHaveValue('$.customers');
  await expect(table(page).locator('thead th')).toHaveText(['#', 'name', 'city', 'orders']);
  await expect(column(page, 0)).toHaveText(['Ada', 'Grace', 'Linus', 'Edsger']);
  await expect(table(page).locator('td.missing')).toHaveCount(1);
});

test('picks another array, combining nested arrays', async ({ page }) => {
  const picker = table(page).getByLabel('Array to show');
  const options = await picker.locator('option').allInnerTexts();
  expect(options).toEqual(expect.arrayContaining(['$.orders[*].lines · 3 rows']));

  await picker.selectOption('$.orders[*].lines');
  await expect(table(page).locator('tbody tr')).toHaveCount(3);
  await expect(column(page, 0)).toHaveText(['A1', 'B2', 'C3']);
});

test('sorts by a column, numbers numerically and missing values last', async ({ page }) => {
  const header = (name: string) => table(page).getByTitle(`Sort by ${name}`, { exact: true });

  await header('orders').click();
  await expect(table(page).locator('th[aria-sort="ascending"]')).toContainText('orders');
  await expect(column(page, 2)).toHaveText(['3', '7', '12', '25']);

  await header('orders').click();
  await expect(table(page).locator('th[aria-sort="descending"]')).toContainText('orders');
  await expect(column(page, 2)).toHaveText(['25', '12', '7', '3']);

  await header('city').click();
  await expect(column(page, 1)).toHaveText(['Helsinki', 'London', 'New York', '']);
});

test('filters rows on any column', async ({ page }) => {
  const filter = table(page).getByLabel('Filter rows');
  await filter.fill('york');
  await expect(table(page).locator('tbody tr')).toHaveCount(1);
  await expect(table(page).locator('.tb-count')).toHaveText('1 / 4 rows');

  await filter.fill('nothing like this');
  await expect(table(page).locator('.no-rows')).toBeVisible();

  await filter.press('Escape');
  await expect(table(page).locator('tbody tr')).toHaveCount(4);
});

test('copies the rows shown as CSV', async ({ page }) => {
  await table(page).getByLabel('Filter rows').fill('o'); // Grace (New York) and Ada (London)
  await table(page).getByTitle('Sort by orders', { exact: true }).click();
  await table(page).getByRole('button', { name: 'Copy as CSV' }).click();
  await expect(page.getByText(/Copied \d+ rows as CSV/)).toBeVisible();

  expect(await readClipboard(page)).toBe(
    ['name,city,orders', 'Grace,New York,3', 'Ada,London,12', ''].join('\n'),
  );
});
