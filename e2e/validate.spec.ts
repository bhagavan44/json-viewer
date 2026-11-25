import { expect, Page, test } from '@playwright/test';
import { leftPanel, openShared, rightPanel } from './helpers';

const schema = JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id', 'email'],
  properties: {
    id: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    tags: { type: 'array', items: { type: 'string' } },
  },
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Schema validation' });

test('lists the problems and reveals one in the tree', async ({ page }) => {
  await openShared(page, '{"id":"7","email":"not an email","tags":["a",2]}', schema);
  const left = leftPanel(page);
  await expect(
    rightPanel(page).getByRole('button', { name: 'Validate against schema' }),
  ).toHaveCount(0);

  await left.getByRole('button', { name: 'Validate against schema' }).click();
  await expect(panel(page).locator('.changes-header')).toContainText('3 problems');
  await expect(panel(page).locator('.schema-sub').first()).toContainText(
    'The left pane, checked against the schema in the right pane',
  );
  const errors = panel(page).locator('.change-item');
  await expect(errors.locator('.change-path')).toHaveText(['$.id', '$.email', '$.tags[1]']);

  await left.getByRole('button', { name: 'Tree view' }).click();
  await expect(left.locator('.node-row.mark-del')).toHaveCount(3);
  await errors.filter({ hasText: '$.tags[1]' }).click();
  await expect(left.locator('.node-row.selected')).toHaveAttribute('data-path', '$.tags[1]');
  await expect(left.locator('.inspector .insp-path')).toHaveText('$.tags[1]');
});

test('says when the document matches, and closes', async ({ page }) => {
  await openShared(page, '{"id":7,"email":"ada@example.com","tags":["a"]}', schema);
  await leftPanel(page).getByRole('button', { name: 'Validate against schema' }).click();
  await expect(panel(page)).toContainText('The document matches the schema.');
  await expect(panel(page).locator('.changes-header')).toContainText('Valid');

  await panel(page).getByRole('button', { name: 'Close schema validation' }).click();
  await expect(panel(page)).toHaveCount(0);
});

test('validates the right pane against a schema in the left pane', async ({ page }) => {
  await openShared(page, schema, '{"email":"ada@example.com"}');
  await expect(
    leftPanel(page).getByRole('button', { name: 'Validate against schema' }),
  ).toHaveCount(0);
  await rightPanel(page).getByRole('button', { name: 'Validate against schema' }).click();
  await expect(panel(page).locator('.changes-header')).toContainText('1 problem');
  await expect(panel(page).locator('.change-item .change-path')).toHaveText(['$']);
  await expect(panel(page).locator('.change-item')).toContainText('id');
});
