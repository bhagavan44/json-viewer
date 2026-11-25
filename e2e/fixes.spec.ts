import { expect, Page, test } from '@playwright/test';
import { leftPanel, openShared, snackAction } from './helpers';

const base64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

/** Opens `text` in the left pane, checks the fix it offers and applies it. */
async function applyFix(page: Page, text: string, button: string) {
  await openShared(page, text, '{}');
  const left = leftPanel(page);
  await expect(left.locator('.status-badge')).toContainText('Invalid');
  await expect(left.locator('.fix-btn')).toHaveText(button);
  await left.locator('.fix-btn').click();
  await expect(left.locator('.status-badge')).toContainText('Valid');
  await expect(left.locator('.fix-btn')).toHaveCount(0);
  await left.getByRole('button', { name: 'Tree view' }).click();
  await left.getByRole('button', { name: 'Expand all' }).click();
}

const value = (page: Page, path: string) =>
  leftPanel(page).locator(`.node-row[data-path="${path}"] .node-value`);

test('repairs almost-JSON and undoes it', async ({ page }) => {
  await applyFix(page, "{name: 'x', /* note */ tags: ['a',], ok: True}", 'Repair');
  await expect(value(page, '$.name')).toContainText('x');
  await expect(value(page, '$.tags[0]')).toContainText('a');
  await expect(value(page, '$.ok')).toHaveText('true');

  await snackAction(page, 'Undo').click();
  await expect(leftPanel(page).locator('.status-badge')).toContainText('Invalid');
  await expect(leftPanel(page).locator('.fix-btn')).toHaveText('Repair');
});

test('unescapes JSON copied from a log', async ({ page }) => {
  await applyFix(page, String.raw`{\"id\":1,\"name\":\"Ada\"}`, 'Unescape');
  await expect(value(page, '$.id')).toHaveText('1');
  await expect(value(page, '$.name')).toContainText('Ada');
});

test('decodes a JWT, showing its time claims as dates', async ({ page }) => {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: 'ada', exp: 1_700_000_000 }));
  await applyFix(page, `Bearer ${header}.${payload}.c2lnbmF0dXJl`, 'Decode JWT');
  await expect(value(page, '$.header.alg')).toContainText('HS256');
  await expect(value(page, '$.payload.sub')).toContainText('ada');
  await expect(value(page, '$.times.exp')).toContainText('2023-11-14T22:13:20.000Z');
  await expect(value(page, '$.signature')).toContainText('c2lnbmF0dXJl');
});

test('decodes Base64 that holds JSON', async ({ page }) => {
  const text = Buffer.from('{"city":"Zürich","zip":8001}', 'utf8').toString('base64');
  await applyFix(page, text, 'Decode Base64');
  await expect(value(page, '$.city')).toContainText('Zürich');
  await expect(value(page, '$.zip')).toHaveText('8001');
});

test('turns JSON Lines into an array', async ({ page }) => {
  await applyFix(page, '{"n":1}\n{"n":2}\n{"n":3}\n', 'To array');
  await expect(value(page, '$[2].n')).toHaveText('3');
  await expect(leftPanel(page).locator('.node-row[data-path="$"] .bracket')).toHaveText('[');
});
