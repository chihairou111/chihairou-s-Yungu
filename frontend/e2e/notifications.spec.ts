import { expect, test, type Page } from '@playwright/test';

// The app bar's notifications and the graded assignment's Feedback panel, against the mock (its
// notification store is shared by the whole run; only this test marks anything read).

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Student ID').fill('170104022');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/assignments$/);
}

test('the bell lists unread then read, marks one read, and opens an assignment with its feedback', async ({ page }) => {
  await signIn(page);
  const bell = page.getByRole('banner').getByRole('button', { name: 'Notifications, 3 unread' });
  await expect(bell).toBeVisible();
  await bell.click();
  const menu = page.getByRole('dialog', { name: 'Notifications' });
  await expect(menu.getByRole('heading', { name: 'Unread (3)' })).toBeVisible();
  const read = menu.getByRole('list', { name: 'Read', exact: true });
  await expect(read.getByRole('listitem')).toHaveCount(20);
  await menu.getByRole('button', { name: 'Load more' }).click();
  await expect(read.getByRole('listitem')).toHaveCount(26);

  // Mark as read moves an item down and lowers the count (it stays there, opening the Behaviour page).
  const unread = menu.getByRole('list', { name: 'Unread' });
  await unread.getByRole('listitem').filter({ hasText: 'Behaviour record' }).getByRole('button', { name: 'Mark as read' }).click();
  await expect(menu.getByRole('heading', { name: 'Unread (2)' })).toBeVisible();
  await expect(unread.getByText('Behaviour record', { exact: true })).toBeHidden();
  await expect(read.getByRole('listitem').first()).toContainText('Behaviour record');
  await expect(page.getByRole('button', { name: 'Notifications, 2 unread', includeHidden: true })).toBeAttached();

  // One about an assignment opens it in the pop-up and is marked read on the way.
  await menu.getByRole('button', { name: 'CL Business with Personal Finance I learning feedback updated' }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/[?&]task=203\b/);
  const dialog = page.getByRole('dialog', { name: '1.8B-[Case Study]-Supply Chain' });
  const feedback = dialog.getByRole('region', { name: 'Feedback' });
  await expect(feedback).toContainText('9/10');
  await expect(feedback.getByRole('list', { name: 'Criteria' }).getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
});

test('from the calendar, a notification about an assignment goes to Assignments with it open', async ({ page }) => {
  await signIn(page);
  await page.goto('/calendar');
  await page.getByRole('banner').getByRole('button', { name: /^Notifications/ }).click();
  const menu = page.getByRole('dialog', { name: 'Notifications' });
  await menu.getByRole('list', { name: 'Read', exact: true }).getByRole('button', { name: 'New comment on homework' }).first().click();
  await expect(page).toHaveURL(/\/assignments\?task=207\b/);
  await expect(page.getByRole('dialog', { name: 'Task 2：用户访谈提纲' })).toBeVisible();
});
