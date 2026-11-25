import { expect, Page, test } from '@playwright/test';
import { leftPanel, openShared, readClipboard, snackAction } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

// Four-space indents and inline arrays and objects, so a re-serialised document would show.
const doc = `{
    "name": "Widget",
    "qty": 2,
    "tags": ["a", "b"],
    "meta": {"color": "red"}
}`;

const row = (page: Page, path: string) => leftPanel(page).locator(`.node-row[data-path="${path}"]`);
const inspector = (page: Page) => leftPanel(page).locator('.inspector');

/** The left pane's text, through its Copy button. */
async function leftText(page: Page): Promise<string> {
  await leftPanel(page).getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByText('Copied to clipboard!')).toBeVisible();
  return readClipboard(page);
}

test.beforeEach(async ({ page }) => {
  await openShared(page, doc, '{}');
  await leftPanel(page).getByRole('button', { name: 'Tree view' }).click();
  await expect(row(page, '$.qty')).toBeVisible();
});

test('edits a value, changing its type, and keeps the formatting', async ({ page }) => {
  await row(page, '$.qty').click();
  await inspector(page).getByRole('button', { name: 'Edit value' }).click();
  await inspector(page).getByLabel('Type', { exact: true }).selectOption('string');
  await inspector(page).getByLabel('Value', { exact: true }).fill('2 boxes');
  await inspector(page).getByRole('button', { name: 'Apply' }).click();

  await expect(row(page, '$.qty').locator('.node-value')).toContainText('2 boxes');
  await expect(row(page, '$.qty').locator('.node-value')).toHaveClass(/type-string/);
  expect(await leftText(page)).toBe(doc.replace('"qty": 2', '"qty": "2 boxes"'));
});

test('renames a key, and refuses a name already in use', async ({ page }) => {
  await row(page, '$.name').click();
  await inspector(page).getByRole('button', { name: 'Rename key' }).click();
  await inspector(page).getByLabel('Key', { exact: true }).fill('qty');
  await inspector(page).getByRole('button', { name: 'Apply' }).click();
  await expect(inspector(page).getByRole('alert')).toHaveText('"qty" already exists here');

  await inspector(page).getByLabel('Key', { exact: true }).fill('title');
  await inspector(page).getByRole('button', { name: 'Apply' }).click();
  await expect(row(page, '$.title')).toBeVisible();
  await expect(row(page, '$.name')).toHaveCount(0);
  expect(await leftText(page)).toBe(doc.replace('"name"', '"title"'));
});

test('adds a member to an object', async ({ page }) => {
  await row(page, '$.meta').click();
  await inspector(page).getByRole('button', { name: 'Add a member' }).click();
  await inspector(page).getByLabel('Key', { exact: true }).fill('size');
  await inspector(page).getByLabel('Type', { exact: true }).selectOption('number');
  await inspector(page).getByLabel('Value', { exact: true }).fill('3');
  await inspector(page).getByRole('button', { name: 'Apply' }).click();

  await expect(row(page, '$.meta.size').locator('.node-value')).toHaveText('3');
  const text = await leftText(page);
  expect(JSON.parse(text)).toEqual({ ...JSON.parse(doc), meta: { color: 'red', size: 3 } });
  // Only the edited object changes.
  expect(text).toContain('    "tags": ["a", "b"],\n');
});

test('adds an item to an array', async ({ page }) => {
  await row(page, '$.tags').click();
  await inspector(page).getByRole('button', { name: 'Add an item' }).click();
  await inspector(page).getByLabel('Value', { exact: true }).fill('c');
  await inspector(page).getByRole('button', { name: 'Apply' }).click();

  await expect(row(page, '$.tags[2]').locator('.node-value')).toContainText('c');
  expect(JSON.parse(await leftText(page)).tags).toEqual(['a', 'b', 'c']);
});

test('deletes a node with the Delete key and undoes it', async ({ page }) => {
  await row(page, '$.tags').click();
  await page.keyboard.press('Delete');
  await expect(row(page, '$.tags')).toHaveCount(0);

  await snackAction(page, 'Undo').click();
  await expect(row(page, '$.tags')).toBeVisible();
  expect(await leftText(page)).toBe(doc);
});

test('edits the selected value with F2 and cancels with Escape', async ({ page }) => {
  await row(page, '$.name').click();
  await page.keyboard.press('F2');
  const value = inspector(page).getByLabel('Value', { exact: true });
  await expect(value).toBeFocused();
  await expect(value).toHaveValue('Widget');

  await page.keyboard.press('Escape');
  await expect(value).toHaveCount(0);
  await expect(inspector(page).locator('.insp-path')).toHaveText('$.name');
});
