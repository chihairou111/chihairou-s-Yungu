import { expect, test, type Page } from '@playwright/test';

// The Behaviour page against the mock: this month by default, months stepped in the URL, and the bell's
// behaviour record opening it. The mock lays its records back from now, so the list checks use last month,
// which always holds the whole set.

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Student ID').fill('170104022');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/assignments$/);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** This month and last month in China time, as `YYYY-MM` and "October 2026". */
function months() {
  const d = new Date(Date.now() + 8 * 3600_000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const prev = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
  const param = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, '0')}`;
  return {
    current: { param: param(y, m), label: `${MONTHS[m]} ${y}` },
    previous: { param: param(prev.y, prev.m), label: `${MONTHS[prev.m]} ${prev.y}`, name: MONTHS[prev.m] },
  };
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('the nav opens Behaviour on this month; the arrows step months in the URL', async ({ page }) => {
  const { current, previous } = months();
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Assignments', 'Calendar', 'Behaviour']);
  await nav.getByRole('link', { name: 'Behaviour' }).click();
  await expect(page).toHaveURL(/\/behaviour$/);
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText('Behaviour');
  await expect(page.getByRole('heading', { level: 2, name: current.label })).toBeVisible();
  await expect(page.getByRole('region', { name: /^凌云积分 −?\d+$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  await expect(page.getByText(/base/i)).toHaveCount(0);

  await page.getByRole('link', { name: 'Previous month' }).click();
  await expect(page).toHaveURL(new RegExp(`/behaviour\\?month=${previous.param}$`));
  await expect(page.getByRole('heading', { level: 2, name: previous.label })).toBeVisible();
  const card = page.getByRole('region', { name: /^凌云积分/ });
  await expect(card).toContainText(`凌云积分 · ${previous.name}`);
  await expect(card.getByText('Bonus')).toBeVisible();
  await expect(card.getByText('Deductions')).toBeVisible();
  // One struck-through revoked record, one tier record with its level; group headings by week.
  const revoked = page.getByRole('listitem').filter({ hasText: 'Revoked' });
  await expect(revoked).toHaveCount(1);
  await expect(revoked).toContainText('not counted');
  await expect(page.getByRole('listitem').filter({ hasText: 'Level 1' })).toHaveCount(1);
  expect(await page.getByRole('listitem').count()).toBeGreaterThanOrEqual(12);
  await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText(/^[A-Z][a-z]{2} \d+(–\d+)?$/);
  await expectNoHorizontalScroll(page);

  // Reload keeps the month; Back returns to this month; "This month" too.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: previous.label })).toBeVisible();
  await page.getByRole('link', { name: 'Next month' }).click();
  await expect(page).toHaveURL(new RegExp(`/behaviour\\?month=${current.param}$`));
  await page.getByRole('link', { name: 'Previous month' }).click();
  await page.getByRole('link', { name: 'This month' }).click();
  await expect(page).toHaveURL(/\/behaviour$/);
  await expect(page.getByRole('heading', { level: 2, name: current.label })).toBeVisible();
});

test('side by side, the card stays put while the list scrolls; on a phone the card sits on top', async ({ page }) => {
  const { previous } = months();
  await page.setViewportSize({ width: 1440, height: 800 });
  await signIn(page);
  await page.goto(`/behaviour?month=${previous.param}`);
  const card = page.getByRole('region', { name: /^凌云积分/ });
  const list = page.getByRole('region', { name: 'Records' });
  const before = (await card.boundingBox())!;
  const listBox = (await list.boundingBox())!;
  expect(listBox.x).toBeGreaterThan(before.x + before.width); // beside the card
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await list.boundingBox())!.y).toBeLessThan(listBox.y - 300);
  expect((await card.boundingBox())!.y).toBeCloseTo(before.y, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const top = (await card.boundingBox())!;
  expect((await list.boundingBox())!.y).toBeGreaterThan(top.y + top.height - 1); // below the card
  await expectNoHorizontalScroll(page);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await list.boundingBox())!.y).toBeLessThan(0);
  expect((await card.boundingBox())!.y).toBeGreaterThan(0); // still on screen, under the header
});

test('the bell opens the Behaviour page for a behaviour record', async ({ page }) => {
  await signIn(page);
  await page.getByRole('banner').getByRole('button', { name: /^Notifications/ }).click();
  const menu = page.getByRole('dialog', { name: 'Notifications' });
  // A read one, so this test marks nothing (the notifications test counts the unread ones).
  await menu.getByRole('list', { name: 'Read', exact: true }).getByRole('button', { name: 'Behaviour record' }).last().click();
  await expect(page).toHaveURL(/\/behaviour(\?month=\d{4}-\d{2})?$/);
  await expect(page.getByRole('region', { name: /^凌云积分/ })).toBeVisible();
});
