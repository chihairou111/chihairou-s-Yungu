import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Student ID').fill('170104022');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/assignments$/);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const rangeLabel = (page: Page) => page.getByRole('main').getByRole('heading', { level: 2 }).first();

test('sign in, browse assignments and calendar, sign out', async ({ page }) => {
  // Signed out: the dashboard bounces to the sign-in page.
  await page.goto('/assignments');
  await expect(page).toHaveURL(/\/login$/);

  // Blank submit explains what is missing.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter your student ID and password.' })).toBeVisible();

  await signIn(page);
  for (const column of ['Overdue', 'Nearly overdue', 'Upcoming']) {
    await expect(page.getByRole('heading', { name: column, exact: true })).toBeVisible();
  }
  // Today's classes is no longer a column: a button on the right edge appears on hover and opens a drawer.
  await expect(page.getByRole('region', { name: "Today's classes" })).toHaveCount(0);
  const todayButton = page.getByRole('button', { name: "Today's classes" });
  await expect(todayButton).toHaveCSS('opacity', '0');
  const viewport = page.viewportSize()!;
  // Nothing overlays the page at the right edge: the hit target there is the page itself.
  const hitsMain = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('main') !== null,
    [viewport.width - 20, 150],
  );
  expect(hitsMain).toBe(true);
  await page.mouse.move(viewport.width - 20, viewport.height / 2);
  await expect(todayButton).toHaveCSS('opacity', '1');
  await todayButton.click();
  const drawer = page.getByRole('dialog', { name: "Today's classes" });
  // The real clock decides whether today has classes; the drawer shows either its items or its empty state.
  await expect(drawer.getByText('No classes today').or(drawer.getByRole('listitem').first())).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // By course: Classroom-style course cards, with idle courses below "No work due".
  await page.getByRole('button', { name: 'By course' }).click();
  await expect(page).toHaveURL(/\?view=course$/);
  await expect(page.getByRole('article', { name: 'Product Design I' })).toBeVisible();
  const idle = page.getByRole('region', { name: 'No work due' });
  await expect(idle.getByRole('article', { name: 'Chinese I' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'By course' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'By priority' }).click();
  await expect(page).toHaveURL(/\/assignments$/);

  // The session cookie survives a reload.
  await page.reload();
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(page.getByRole('heading', { name: 'Overdue', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Submitted' }).click();
  await expect(page).toHaveURL(/\?tab=submitted$/);
  await expect(page.getByText('Submitted late').first()).toBeVisible();

  // Hovering the rail reveals its labels; the link goes to the calendar.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.hover();
  const calendarLink = nav.getByRole('link', { name: 'Calendar' });
  await expect(calendarLink.getByText('Calendar')).toHaveCSS('opacity', '1');
  await calendarLink.click();
  await expect(page).toHaveURL(/\/calendar$/);

  const current = (await rangeLabel(page).textContent()) ?? '';
  expect(current).not.toBe('');
  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(rangeLabel(page)).not.toHaveText(current);
  await page.getByRole('link', { name: 'Previous week' }).click();
  await expect(rangeLabel(page)).toHaveText(current);
  await page.getByRole('link', { name: 'Next week' }).click();
  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(rangeLabel(page)).not.toHaveText(current);
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(rangeLabel(page)).toHaveText(current);

  // Sign out from the avatar menu; the dashboard is gated again.
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/assignments');
  await expect(page).toHaveURL(/\/login$/);
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('no horizontal page scroll on assignments or calendar', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Overdue', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // No hover on a phone, so the Today's classes button is always shown.
    const fab = page.getByRole('button', { name: "Today's classes" });
    await expect(fab).toHaveCSS('opacity', '1');
    // Material's bottom-right FAB spot (16px insets), not over the content's right edge.
    const box = (await fab.boundingBox())!;
    expect(Math.round(390 - (box.x + box.width))).toBe(16);
    expect(Math.round(844 - (box.y + box.height))).toBe(16);
    await page.goto('/assignments?view=course');
    await expect(page.getByRole('article', { name: 'Chinese I' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/assignments?tab=submitted');
    await expect(page.getByText('Submitted late').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/calendar');
    await expect(rangeLabel(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
