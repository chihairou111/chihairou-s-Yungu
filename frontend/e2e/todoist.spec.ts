import { expect, test, type Page } from '@playwright/test';

// The app bar's Todoist icon and menu against the mock, whose Todoist connection is shared by the whole
// run: only this file connects, and it disconnects again before it ends. The connect flow runs through
// the real routes: /api/todoist/connect → (the mock's stand-in for Todoist) → /api/todoist/callback.

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Student ID').fill('170104022');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/assignments$/);
}

const icon = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Todoist/ });
const menu = (page: Page) => page.getByRole('dialog', { name: 'Todoist' });

test.describe.configure({ mode: 'serial' });

test('connect, see it sync, nothing about it in the task views, disconnect', async ({ page }) => {
  await signIn(page);
  // First in the icon row, left of Notifications; no badge while all is well.
  const bar = page.getByRole('banner');
  const [t, n] = [await icon(page).boundingBox(), await bar.getByRole('button', { name: /^Notifications/ }).boundingBox()];
  expect(t!.x + t!.width).toBeLessThanOrEqual(n!.x);
  expect(t!.height).toBe(n!.height);
  await expect(icon(page)).toHaveAccessibleName('Todoist');
  await expect(icon(page).locator('.MuiBadge-badge')).toHaveClass(/MuiBadge-invisible/);

  await icon(page).click();
  await menu(page).getByRole('link', { name: 'Connect Todoist' }).click();
  // Back on Assignments with the menu open on the result, and the URL clean again.
  await expect(menu(page)).toBeVisible();
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(menu(page)).toContainText('Connected to Todoist · Bruce Zheng');
  await expect(menu(page).getByRole('status')).toHaveText('Synced just now', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(icon(page)).toHaveAccessibleName('Todoist');
  await expect(icon(page).locator('.MuiBadge-badge')).toHaveClass(/MuiBadge-invisible/);

  // Reloading the callback page after connecting (its link used up) still lands as connected.
  await page.goto('/api/todoist/callback?code=mock-code&state=already-used');
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(menu(page)).toContainText('Connected to Todoist');
  await expect(menu(page).getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();

  // No indication anywhere in the task views: the cards, the lists, the pop-up.
  await expect(page.getByRole('main')).not.toContainText(/todoist/i);
  await page.getByRole('main').getByRole('button').filter({ hasText: /\S/ }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasNot: page.getByRole('heading', { name: 'Todoist' }) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading').first()).toBeVisible();
  await expect(dialog).not.toContainText(/todoist/i);
  await dialog.getByRole('button', { name: 'Close' }).click();

  await icon(page).click();
  await menu(page).getByRole('button', { name: 'Disconnect' }).click();
  await expect(menu(page).getByRole('link', { name: 'Connect Todoist' })).toBeVisible();
});

test('a sync problem pins the red × to the icon; the menu says what to do', async ({ page }) => {
  await page.route('**/api/todoist', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: { connected: true, account: 'Bruce Zheng', state: 'error', lastSyncAt: Date.now() - 3_600_000, error: { code: 'reauth', message: 'Todoist needs you to connect again.' } },
        })
      : route.continue(),
  );
  await signIn(page);
  await expect(icon(page)).toHaveAccessibleName('Todoist, sync problem');
  const badge = icon(page).locator('.MuiBadge-badge');
  await expect(badge).not.toHaveClass(/MuiBadge-invisible/);
  // A red circle, ringed in the app bar's surface, pinned to the icon's top-right corner.
  const [box, glyph] = [await badge.boundingBox(), await icon(page).locator('svg').first().boundingBox()];
  expect(Math.round(box!.width)).toBe(Math.round(box!.height));
  expect(box!.x + box!.width).toBeGreaterThan(glyph!.x + glyph!.width);
  expect(box!.y).toBeLessThan(glyph!.y);
  expect(await badge.evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe('0px');

  await icon(page).click();
  await expect(menu(page)).toContainText('Todoist needs you to connect again.');
  await expect(menu(page).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/todoist/connect');
});
