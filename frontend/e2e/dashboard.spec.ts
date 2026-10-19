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
  // Grouped by due date; only late work carries a chip.
  // (Which groups show depends on today's date; the fixtures are always in the past.)
  await expect(page.getByRole('heading', { level: 3, name: /^(This week|Last week|Earlier)$/ }).first()).toBeVisible();
  await expect(page.getByText('Late', { exact: true })).toHaveCount(1);

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
    // Cards use the compact 16px margins: at least 340 of the 390px.
    const card = (await page.getByRole('article').first().boundingBox())!;
    expect(card.width).toBeGreaterThanOrEqual(340);
    await page.goto('/assignments?view=course');
    await expect(page.getByRole('article', { name: 'Chinese I' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/assignments?tab=submitted');
    await expect(page.getByText('Late', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/calendar');
    await expect(rangeLabel(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('the nav docks bottom-left, beside the bottom-right button, and clears the content', async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    const navBox = (await nav.boundingBox())!;
    expect(Math.round(navBox.x)).toBe(16);
    expect(Math.round(844 - (navBox.y + navBox.height))).toBe(16);
    expect(Math.round(navBox.height)).toBe(56);
    // Icons only, but each link keeps its name and the current page is marked.
    await expect(nav.getByRole('link', { name: 'Assignments' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();

    // No hover on a phone, so the Today's classes button is always shown, centred on the nav pill.
    const fab = page.getByRole('button', { name: "Today's classes" });
    await expect(fab).toHaveCSS('opacity', '1');
    const fabBox = (await fab.boundingBox())!;
    expect(Math.round(390 - (fabBox.x + fabBox.width))).toBe(16);
    expect(Math.round(fabBox.y + fabBox.height / 2)).toBe(Math.round(navBox.y + navBox.height / 2));
    expect(navBox.x + navBox.width).toBeLessThan(fabBox.x);

    // Scrolled to the end, the last card sits above the nav.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastCard = (await page.getByRole('article').last().boundingBox())!;
    expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(navBox.y);

    // The view switch scrolls with the content: only the title and tabs stay pinned.
    await page.evaluate(() => window.scrollTo(0, 0));
    const views = page.getByRole('group', { name: 'Group to-do work' });
    await expect(views).toHaveCount(1);
    expect(await views.evaluate((el) => el.closest('[data-page-header]') === null)).toBe(true);
    const header = (await page.locator('[data-page-header]').boundingBox())!;
    expect(Math.round(header.y + header.height)).toBe(104);

    // The nav still navigates.
    await nav.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(nav.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  });

  test('the calendar header is one row with the short range', async ({ page }) => {
    await signIn(page);
    await page.goto('/calendar');
    const header = (await page.locator('[data-page-header]').boundingBox())!;
    expect(Math.round(header.y + header.height)).toBe(104);
    await expect(rangeLabel(page)).toHaveText(/^[A-Z][a-z]{2} \d{1,2} – .+, \d{4}[A-Z][a-z]{2} \d{1,2}–/);
  });
});

test.describe('wide screens', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('content is capped at 1280 and lines up with the title and tabs', async ({ page }) => {
    await signIn(page);
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    const tabs = (await page.getByRole('tablist').boundingBox())!;
    const board = (await page.getByRole('tabpanel').boundingBox())!;
    expect(Math.round(board.width)).toBe(1280);
    expect(Math.round(title.x)).toBe(Math.round(board.x));
    expect(Math.round(tabs.x)).toBe(Math.round(board.x));
    // The first content row starts right under the header.
    const first = (await page.getByRole('heading', { name: 'Overdue', exact: true }).boundingBox())!;
    expect(first.y).toBeLessThanOrEqual(140);
  });
});

test.describe('half-width window', () => {
  test.use({ viewport: { width: 800, height: 800 } });

  test('the calendar keeps the week grid from 720px', async ({ page }) => {
    await signIn(page);
    await page.goto('/calendar');
    const days = page.getByRole('main').getByRole('region');
    await expect(days.first()).toBeVisible();
    const tops = await days.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('style switcher', () => {
  const radius = (page: Page, name: string) =>
    page.getByRole('article', { name }).evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

  async function chooseStyle(page: Page, label: string) {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitemradio', { name: label }).click();
  }

  test('the gear switches between rounded and classic at once, and the choice survives a reload', async ({ page }) => {
    await signIn(page);
    await page.goto('/assignments?view=course');
    // A new visitor gets the rounded Material 3 style: 12px course cards.
    await expect.poll(() => radius(page, 'Chinese I')).toBe('12px');

    await chooseStyle(page, 'Classic (Material 2)');
    await expect.poll(() => radius(page, 'Chinese I')).toBe('4px');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Classic (Material 2)' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.getByRole('article', { name: 'Chinese I' })).toBeVisible();
    expect(await radius(page, 'Chinese I')).toBe('4px');
    const cookie = (await page.context().cookies()).find((c) => c.name === 'yl_style');
    expect(cookie?.value).toBe('classic');

    await chooseStyle(page, 'Rounded (Material 3)');
    await expect.poll(() => radius(page, 'Chinese I')).toBe('12px');
    await page.reload();
    await expect(page.getByRole('article', { name: 'Chinese I' })).toBeVisible();
    expect(await radius(page, 'Chinese I')).toBe('12px');
  });

  test('the sign-in page renders in the stored style on first paint', async ({ page, context, baseURL }) => {
    const card = () => page.locator('main .MuiPaper-root').first();
    // JavaScript off: what the server rendered is what shows, so the style cannot come from a client-side switch.
    await page.route('**/*.js', (route) => route.abort());
    await page.goto('/login');
    expect(await card().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('28px');
    await context.addCookies([{ name: 'yl_style', value: 'classic', url: baseURL! }]);
    await page.goto('/login');
    expect(await card().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('4px');
  });
});
