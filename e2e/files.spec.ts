import { expect, Locator, Page, test } from '@playwright/test';
import { leftPanel, openShared, rightPanel, snackAction, storedSession } from './helpers';

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Saved files' });
const fileItem = (page: Page, name: string) =>
  sidebar(page).locator('.file-item').filter({ hasText: name });
const paneName = (pane: Locator) => pane.locator('.panel-name');

/** Saves a pane under `name` through the save dialog. */
async function save(page: Page, pane: Locator, name: string): Promise<void> {
  await pane.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('File name').fill(name);
  await page.locator('.save-dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(`Saved as "${name}"`)).toBeVisible();
}

/** Clicks one of a file's actions, which show when the pointer is over the file. */
async function fileAction(page: Page, name: string, action: string): Promise<void> {
  await fileItem(page, name).hover();
  await fileItem(page, name).getByRole('button', { name: action }).click();
}

test('saves a pane, renames the file and opens it in the other pane', async ({ page }) => {
  await openShared(page, '{"order":42}', '[]');
  await expect(sidebar(page)).toContainText('No saved files yet');

  await save(page, leftPanel(page), 'order.json');
  await expect(fileItem(page, 'order.json')).toBeVisible();
  await expect(paneName(leftPanel(page))).toHaveText('order.json');
  await expect(leftPanel(page).locator('.dirty-dot')).toHaveCount(0);

  await fileAction(page, 'order.json', 'Rename file');
  const rename = sidebar(page).locator('.rename-input');
  await rename.fill('order-42.json');
  await rename.press('Enter');
  await expect(fileItem(page, 'order-42.json')).toBeVisible();
  await expect(paneName(leftPanel(page))).toHaveText('order-42.json');

  await fileAction(page, 'order-42.json', 'Open in right pane');
  await expect(paneName(rightPanel(page))).toHaveText('order-42.json');
  await expect(rightPanel(page).locator('.status-badge')).toContainText('Valid');
  await expect(fileItem(page, 'order-42.json').locator('.pane-badge')).toHaveText(['L', 'R']);
});

test('deletes a file and undoes it', async ({ page }) => {
  await openShared(page, '{"order":42}', '[]');
  await save(page, leftPanel(page), 'order.json');

  await fileAction(page, 'order.json', 'Delete file');
  await expect(sidebar(page).locator('.file-item')).toHaveCount(0);
  await expect(paneName(leftPanel(page))).toHaveText('Untitled');

  await snackAction(page, 'Undo').click();
  await expect(fileItem(page, 'order.json')).toBeVisible();
  await expect(paneName(leftPanel(page))).toHaveText('order.json');
});

test('marks unsaved changes and saves them to the same file', async ({ page }) => {
  await openShared(page, '{"order":42}', '[]');
  await save(page, leftPanel(page), 'order.json');

  await leftPanel(page).getByRole('button', { name: 'Format' }).click();
  await expect(leftPanel(page).locator('.dirty-dot')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saved "order.json"')).toBeVisible();
  await expect(leftPanel(page).locator('.dirty-dot')).toHaveCount(0);
  await expect(sidebar(page).locator('.file-item')).toHaveCount(1);
});

test('searches saved files by name and content', async ({ page }) => {
  await openShared(page, '{"customer":"Ada"}', '{"invoice":7}');
  await save(page, leftPanel(page), 'customer.json');
  await save(page, rightPanel(page), 'billing.json');
  await expect(sidebar(page).locator('.file-item')).toHaveCount(2);

  const search = sidebar(page).getByLabel('Search saved files');
  await search.fill('billing');
  await expect(sidebar(page).locator('.file-name')).toHaveText(['billing.json']);
  await search.fill('Ada');
  await expect(sidebar(page).locator('.file-name')).toHaveText(['customer.json']);
  await search.fill('nothing like this');
  await expect(sidebar(page)).toContainText('No files match');
});

test('keeps saved files and the open file after a reload', async ({ page }) => {
  await openShared(page, '{"order":42}', '[]');
  await save(page, leftPanel(page), 'order.json');
  await expect.poll(async () => (await storedSession(page))?.left?.fileId).toBeTruthy();

  await page.reload();
  await expect(fileItem(page, 'order.json')).toBeVisible();
  await expect(paneName(leftPanel(page))).toHaveText('order.json');
  await expect(leftPanel(page).locator('.status-badge')).toContainText('Valid');
});
