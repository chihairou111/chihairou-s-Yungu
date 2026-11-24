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
  // Today's classes: a button on the right edge appears on hover and docks a panel beside the content.
  const todayButton = page.getByRole('button', { name: "Today's classes", exact: true });
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
  const todayPanel = page.getByRole('complementary', { name: "Today's classes" });
  // The real clock decides whether today has classes; the panel shows either its items or its empty state.
  await expect(todayPanel.getByText('No classes today').or(todayPanel.getByRole('listitem').first())).toBeVisible();
  // The title sits inside the panel (no separate title bar); hovering the panel reveals the edge button on its left edge.
  await expect(todayPanel.getByRole('heading', { name: "Today's classes" })).toBeVisible();
  await page.mouse.move(viewport.width - 100, viewport.height / 2);
  await expect(todayButton).toHaveCSS('opacity', '1');
  await todayButton.click();
  await expect(todayPanel).toBeHidden();

  // By course is gone: no grouping switch, and a stale ?view=course still shows the priority columns.
  await expect(page.getByRole('button', { name: 'By course' })).toHaveCount(0);
  await page.goto('/assignments?view=course');
  await expect(page.getByRole('heading', { name: 'Overdue', exact: true })).toBeVisible();
  await page.goto('/assignments');

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

test('work returned for revision sits under Nearly overdue with a "Returned" chip, never Overdue', async ({ page }) => {
  await signIn(page);
  const nearly = page.getByRole('region', { name: 'Nearly overdue' });
  const card = nearly.getByRole('article').filter({ hasText: 'Lab Report: Pendulum Period' });
  await expect(card).toBeVisible();
  // "Returned" on screen; " for revision" is there for screen readers.
  const chip = card.locator('.MuiChip-root');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('Returned for revision');
  await expect(card).not.toContainText('late');
  await expect(page.getByRole('region', { name: 'Overdue', exact: true }).getByText('Lab Report: Pendulum Period')).toHaveCount(0);

  await card.getByRole('button', { name: 'Lab Report: Pendulum Period' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lab Report: Pendulum Period' });
  await expect(dialog.getByText('Returned for revision', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/days late/)).toHaveCount(0);
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
    // Each icon sits over its label, and the current page is marked.
    await expect(nav.getByRole('link', { name: 'Assignments' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();

    // No hover on a phone, so the Today's classes button is always shown, centred on the nav pill.
    const fab = page.getByRole('button', { name: "Today's classes", exact: true });
    await expect(fab).toHaveCSS('opacity', '1');
    const fabBox = (await fab.boundingBox())!;
    expect(Math.round(390 - (fabBox.x + fabBox.width))).toBe(16);
    expect(Math.round(fabBox.y + fabBox.height / 2)).toBe(Math.round(navBox.y + navBox.height / 2));
    expect(navBox.x + navBox.width).toBeLessThan(fabBox.x);

    // Scrolled to the end, the last card sits above the nav.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastCard = (await page.getByRole('article').last().boundingBox())!;
    expect(lastCard.y + lastCard.height).toBeLessThanOrEqual(navBox.y);

    // Only the title and tabs stay pinned.
    await page.evaluate(() => window.scrollTo(0, 0));
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

test.describe('one style', () => {
  const card = (page: Page) => page.getByRole('article').first();
  const radius = (page: Page) => card(page).evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

  test('no style choice: the Settings gear holds only Appearance; the dashboard is Rounded even with an old Classic cookie', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'yl_style', value: 'classic', url: baseURL! }]);
    await signIn(page);
    await expect(card(page)).toBeVisible();
    expect(await radius(page)).toBe('12px');
    const bar = page.getByRole('banner');
    const labels = await bar.getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(labels).toEqual([expect.stringMatching(/^Notifications/), 'Refresh', 'Settings', expect.stringMatching(/^Account: /)]);
    // The gear (hosted) offers Appearance and nothing else: no style picker came back with it.
    await bar.getByRole('button', { name: 'Settings' }).click();
    const items = await page.getByRole('menu').getByRole('menuitem').allTextContents();
    expect(items.map((t) => t.trim())).toEqual(['Appearance']);
    await page.keyboard.press('Escape');
  });

  test('the sign-in page is Rounded on first paint, whatever an old style cookie says', async ({ page, context, baseURL }) => {
    const card = () => page.locator('main .MuiPaper-root').first();
    // JavaScript off: what the server rendered is what shows.
    await page.route('**/*.js', (route) => route.abort());
    await page.goto('/login');
    expect(await card().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('28px');
    await context.addCookies([{ name: 'yl_style', value: 'classic', url: baseURL! }]);
    await page.goto('/login');
    expect(await card().evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('28px');
  });
});

test('refresh: reloads each page from the service past its cache', async ({ page }) => {
  await signIn(page);
  for (const path of ['/assignments', '/calendar']) {
    await page.goto(path);
    const bar = page.getByRole('banner');
    const refresh = bar.getByRole('button', { name: 'Refresh' });
    await expect(refresh).toBeVisible();
    // Right of Notifications, the same size.
    const [r, n] = [await refresh.boundingBox(), await bar.getByRole('button', { name: 'Notifications' }).boundingBox()];
    expect(n!.x + n!.width).toBeLessThanOrEqual(r!.x);
    expect(r!.height).toBe(n!.height);

    const dropped = page.waitForResponse((res) => res.url().endsWith('/api/refresh') && res.request().method() === 'POST');
    // The re-render that follows asks for the page again, with the no-cache flag set.
    const rerendered = page.waitForRequest(async (req) => {
      if (new URL(req.url()).pathname !== path) return false;
      // The cookie header is only in allHeaders().
      const headers = await req.allHeaders();
      return headers['rsc'] === '1' && (headers['cookie'] ?? '').includes('yl_refresh=1');
    });
    await refresh.click();
    expect((await dropped).status()).toBe(204);
    await rerendered;
    await expect(refresh).not.toHaveAttribute('aria-disabled', 'true');
    await expect(refresh).toBeFocused();
    await expect(page.getByRole('main')).toBeVisible();
    await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === 'yl_refresh' && c.value === '1')).toBe(false);
  }
});

test.describe("docked today's classes panel", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const panel = (page: Page) => page.getByRole('complementary', { name: "Today's classes" });
  const contentWidth = (page: Page) => page.getByRole('tabpanel').evaluate((el) => el.getBoundingClientRect().width);
  const panelCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'yl_today_panel')?.value;

  test('opens in place, pushes the content left, and keeps its state across reloads', async ({ page }) => {
    await signIn(page);
    // Closed by default: no panel, full-width content.
    await expect(panel(page)).toHaveCount(0);
    const wide = await contentWidth(page);

    // The edge button opens it as part of the page: no dialog, and the content narrows to make room.
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 20, viewport.height / 2);
    const toggle = page.getByRole('button', { name: "Today's classes", exact: true });
    await expect(toggle).toHaveCSS('opacity', '1');
    await toggle.click();
    await expect(panel(page)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', (await panel(page).getAttribute('id'))!);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => contentWidth(page)).toBeLessThan(wide - 300);
    await expect.poll(() => panel(page).evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    const box = (await panel(page).boundingBox())!;
    expect(Math.round(box.x + box.width)).toBe(viewport.width);
    // Below the header band (64 + 48), which still spans the full width above it.
    expect(Math.round(box.y)).toBe(112);
    const band = (await page.locator('[data-page-header]').boundingBox())!;
    expect(Math.round(band.x + band.width)).toBe(viewport.width);
    expect(band.y + band.height).toBeLessThanOrEqual(box.y + 1);
    const main = (await page.getByRole('tabpanel').boundingBox())!;
    expect(main.x + main.width).toBeLessThanOrEqual(box.x);
    await expect(panel(page).getByText('No classes today').or(panel(page).getByRole('listitem').first())).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await panelCookie(page)).toBe('open');

    // The page stays usable beside it (no backdrop, no focus trap).
    await page.getByRole('tab', { name: 'Submitted' }).click();
    await expect(page).toHaveURL(/\?tab=submitted$/);
    await expect(panel(page)).toBeVisible();

    // A reload paints it open at once, already in place (no slide on first paint).
    await page.reload();
    await expect(panel(page)).toBeVisible();
    expect(await panel(page).evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    expect(await contentWidth(page)).toBeLessThan(wide - 300);

    // Hovering the panel reveals the edge button, which closes it; that survives a reload too.
    await page.mouse.move(viewport.width - 100, viewport.height / 2);
    await expect(toggle).toHaveCSS('opacity', '1');
    await toggle.click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => contentWidth(page)).toBeCloseTo(wide, 0);
    expect(await panelCookie(page)).toBe('closed');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'This week' }).or(page.getByRole('heading', { name: 'Earlier' })).first()).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    expect(await contentWidth(page)).toBeCloseTo(wide, 0);
  });

  test('the panel belongs to the shell but stays off Calendar, and comes back unchanged', async ({ page }) => {
    await signIn(page);
    const toggle = page.getByRole('button', { name: "Today's classes", exact: true });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect.poll(() => panel(page).evaluate((el) => el.getBoundingClientRect().x)).toBe(1280 - 344);
    const before = (await panel(page).boundingBox())!;
    const nav = page.getByRole('navigation', { name: 'Main' });

    // Calendar already shows today as a column: neither the panel nor its button, and no space held.
    await nav.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole('main').getByRole('region').first()).toBeVisible();
    await expect(page.locator('aside#today-panel')).toHaveCount(0);
    await expect(toggle).toHaveCount(0);
    expect(await page.getByRole('main').evaluate((el) => Math.round(el.getBoundingClientRect().right))).toBe(1280);
    await expectNoHorizontalScroll(page);
    // The stored state is left for the other pages, also across a reload on Calendar.
    expect(await panelCookie(page)).toBe('open');
    await page.reload();
    await expect(page.getByRole('main').getByRole('region').first()).toBeVisible();
    await expect(page.locator('aside#today-panel')).toHaveCount(0);
    await expect(toggle).toHaveCount(0);

    // Back on Assignments it is open again, already in place (no slide).
    await nav.getByRole('link', { name: 'Assignments' }).click();
    await expect(page).toHaveURL(/\/assignments$/);
    await expect(panel(page)).toBeVisible();
    expect(await panel(page).evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    expect(await panel(page).boundingBox()).toEqual(before);
  });

  test('only the panel slides: the content takes its new width in one step', async ({ page }) => {
    await signIn(page);
    const wide = await contentWidth(page);
    const toggle = page.getByRole('button', { name: "Today's classes", exact: true });
    await toggle.focus();
    await page.keyboard.press('Enter');
    // Opening: the content narrows at once (nothing animates its margins or padding).
    await expect.poll(() => contentWidth(page)).toBeLessThan(wide - 300);
    for (const el of [page.getByRole('main'), page.locator('[data-page-header]'), page.getByRole('banner').locator('.MuiToolbar-root')]) {
      expect(await el.evaluate((e) => getComputedStyle(e).transitionProperty)).not.toMatch(/margin|padding/);
    }
    await expect.poll(() => panel(page).evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    // Closing: the content keeps its width until the panel has slid out, then widens in one step.
    await page.keyboard.press('Enter');
    expect(await contentWidth(page)).toBeLessThan(wide - 300);
    await expect.poll(() => contentWidth(page)).toBeCloseTo(wide, 0);
  });

  test('the server renders the stored state (JavaScript off)', async ({ page, context, baseURL }) => {
    await signIn(page);
    await context.addCookies([{ name: 'yl_today_panel', value: 'open', url: baseURL! }]);
    await page.route('**/*.js', (route) => route.abort());
    await page.goto('/assignments');
    const aside = page.locator('aside#today-panel');
    await expect(aside).toBeVisible();
    const box = (await aside.boundingBox())!;
    expect(Math.round(box.x)).toBe(1280 - 344);
    const main = (await page.getByRole('tabpanel').boundingBox())!;
    expect(main.x + main.width).toBeLessThanOrEqual(box.x);
  });

  test('keyboard: the toggle keeps focus and Enter closes it again', async ({ page }) => {
    await signIn(page);
    const toggle = page.getByRole('button', { name: "Today's classes", exact: true });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe('below the dock width (1000px)', () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test('a stored open panel does not dock: the columns stay side by side and the button opens the drawer', async ({ page, context, baseURL }) => {
    await signIn(page);
    await context.addCookies([{ name: 'yl_today_panel', value: 'open', url: baseURL! }]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Overdue', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: "Today's classes" })).toHaveCount(0);
    expect(await page.getByRole('main').evaluate((el) => Math.round(el.getBoundingClientRect().right))).toBe(1000);
    const lefts = await Promise.all(
      ['Overdue', 'Nearly overdue', 'Upcoming'].map(async (name) =>
        Math.round((await page.getByRole('heading', { name, exact: true }).boundingBox())!.x),
      ),
    );
    expect(new Set(lefts).size).toBe(3);
    await expectNoHorizontalScroll(page);
    const fab = page.getByRole('button', { name: "Today's classes", exact: true });
    await expect(fab).toHaveCSS('opacity', '1');
    await expect(fab).toHaveAttribute('aria-expanded', 'false');
    await fab.click();
    await expect(page.getByRole('dialog', { name: "Today's classes" })).toBeVisible();
  });
});

test.describe('just below the dock width (1199px)', () => {
  test.use({ viewport: { width: 1199, height: 800 } });

  test('opens the drawer, not the panel', async ({ page, context, baseURL }) => {
    await signIn(page);
    await context.addCookies([{ name: 'yl_today_panel', value: 'open', url: baseURL! }]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Overdue', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: "Today's classes" })).toHaveCount(0);
    await page.getByRole('button', { name: "Today's classes", exact: true }).click();
    await expect(page.getByRole('dialog', { name: "Today's classes" })).toBeVisible();
  });
});

test.describe('at the dock width (1200px)', () => {
  test.use({ viewport: { width: 1200, height: 800 } });

  test('a stored open panel docks', async ({ page, context, baseURL }) => {
    await signIn(page);
    await context.addCookies([{ name: 'yl_today_panel', value: 'open', url: baseURL! }]);
    await page.reload();
    await expect(page.getByRole('complementary', { name: "Today's classes" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('stored open panel on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('does not dock; the button still opens the drawer', async ({ page, context, baseURL }) => {
    await signIn(page);
    await context.addCookies([{ name: 'yl_today_panel', value: 'open', url: baseURL! }]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Overdue', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: "Today's classes" })).toHaveCount(0);
    const fab = page.getByRole('button', { name: "Today's classes", exact: true });
    await expect(fab).toHaveAttribute('aria-expanded', 'false');
    await fab.click();
    await expect(page.getByRole('dialog', { name: "Today's classes" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test('keyboard: Tab reaches a card, which shows a focus ring and opens the pop-up', async ({ page }) => {
  await signIn(page);
  await page.getByRole('heading', { name: 'Overdue', exact: true }).waitFor();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.closest('article') !== null)) break;
  }
  const ring = await page.evaluate(() => {
    const card = document.activeElement!.closest('article')!;
    const style = getComputedStyle(card);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(ring).toEqual({ style: 'solid', width: '2px' });

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]task=\d+/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('attachments: rendered previews, and a full-screen viewer that steps through the files', async ({ page }) => {
  // pdf.js fetches its fonts and CMaps from the app on demand; none may be missing.
  const pdfjsAssets: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/pdfjs/')) pdfjsAssets.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await signIn(page);
  await page.goto('/assignments?task=102');
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: 'Attachments (4)' })).toBeVisible();

  // The PDF's first page is drawn by pdf.js (its worker served by the app) and kept as an image, not left
  // blank; the caption gains the page count pdf.js read.
  const pdfTile = detail.getByRole('button', { name: /Observation worksheet\.pdf/ });
  await expect(pdfTile).toHaveAccessibleName('Observation worksheet.pdf, PDF · 1 page · 17 KB');
  await expect
    .poll(() =>
      pdfTile.locator('img').evaluate((img: HTMLImageElement) => {
        if (!img.complete || img.naturalWidth === 0) return false;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128) return true; // some dark text pixels
        return false;
      }),
    )
    .toBe(true);
  expect(pdfjsAssets.filter((line) => !line.startsWith('200 '))).toEqual([]);

  await detail.getByRole('button', { name: /Field notes example\.png/ }).click();
  const viewer = page.getByRole('dialog', { name: 'Field notes example.png' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText('File 3 of 4')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /\?download=1$/);

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Example observation.mp4' }).locator('video')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Observation worksheet.pdf' }).locator('iframe')).toHaveAttribute('src', '/mock/sample.pdf');

  // Esc closes only the viewer; focus is back on the tile that opened it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Observation worksheet\.pdf/ })).toBeHidden();
  await expect(detail.getByRole('button', { name: /Field notes example\.png/ })).toBeFocused();
  await expect(page).toHaveURL(/task=102/);
});

test('your work: upload files, submit, and the task moves to Submitted', async ({ page }) => {
  await signIn(page);
  await page.goto('/assignments?task=104');
  const work = page.getByRole('dialog').getByRole('region', { name: 'Your work' });
  await expect(work.getByText('Not submitted')).toBeVisible();
  await expect(work.getByRole('button', { name: 'Submit' })).toBeDisabled();

  await work.locator('input[type="file"]').setInputFiles([
    { name: 'answers.txt', mimeType: 'text/plain', buffer: Buffer.from('1. 42') },
    { name: 'blank.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
  ]);
  await expect(work.getByRole('button', { name: /^answers\.txt/ })).toBeVisible();
  await expect(work.getByRole('alert')).toHaveText(/blank\.txt is empty\./);

  // A trip to the writer and back keeps the list (and what the server has as the draft).
  await work.getByRole('button', { name: 'Write' }).click();
  await page.getByRole('button', { name: 'Back to assignment' }).click();
  await expect(work.getByRole('button', { name: /^answers\.txt/ })).toBeVisible();

  await work.getByRole('button', { name: 'Submit' }).click();
  await expect(work.getByRole('button', { name: 'Update' })).toBeVisible();
  await expect(work.getByText('Submitted', { exact: true })).toBeVisible();

  // The draft and the hand-in live on the server: a reload shows the same.
  await page.reload();
  await expect(work.getByRole('button', { name: /^answers\.txt/ })).toBeVisible();
  const update = work.getByRole('button', { name: 'Update' });
  await expect(update).toHaveAttribute('aria-disabled', 'true');
  await expect(work.getByText('No changes to hand in')).toBeVisible();

  // An edit after the submit only changes the draft: it says so, survives a reload, and Update hands it in.
  const notHandedIn = work.getByText('Changes not handed in — press Update to hand them in.');
  const draftSaved = page.waitForResponse((r) => r.url().endsWith('/api/assignments/104/draft') && r.request().method() === 'PUT');
  await work.locator('input[type="file"]').setInputFiles({ name: 'more.txt', mimeType: 'text/plain', buffer: Buffer.from('2') });
  await expect(work.getByRole('button', { name: /^more\.txt/ })).toBeVisible();
  await draftSaved;
  await expect(notHandedIn).toBeVisible();
  await expect(update).not.toHaveAttribute('aria-disabled', 'true');
  await expect(work.getByText('Submitted', { exact: true })).toBeVisible();
  await page.reload();
  await expect(work.getByRole('button', { name: /^more\.txt/ })).toBeVisible();
  await expect(notHandedIn).toBeVisible();
  await update.click();
  await expect(notHandedIn).toBeHidden();
  await expect(update).toHaveAttribute('aria-disabled', 'true');

  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Submitted' }).click();
  await expect(page.getByText('Unit 4 Problem Set')).toBeVisible();
});

test('mark as submitted: an assignment that takes no files is handed in with one click', async ({ page }) => {
  await signIn(page);
  // Needs files: no Mark as submitted, Submit stays disabled.
  await page.goto('/assignments?task=101');
  const required = page.getByRole('dialog').getByRole('region', { name: 'Your work' });
  await expect(required.getByRole('button', { name: 'Submit' })).toBeDisabled();
  await expect(required.getByRole('button', { name: 'Mark as submitted' })).toHaveCount(0);

  // "Reading check-in": no files needed, none added.
  await page.goto('/assignments?task=105');
  const dialog = page.getByRole('dialog', { name: 'Reading check-in: Chapter 3' });
  const work = dialog.getByRole('region', { name: 'Your work' });
  await expect(work.getByText('Not submitted')).toBeVisible();
  const mark = work.getByRole('button', { name: 'Mark as submitted' });
  await expect(mark).toBeEnabled();
  await mark.dblclick();
  await expect(work.getByText('Submitted', { exact: true })).toBeVisible();
  const update = work.getByRole('button', { name: 'Update' });
  await expect(update).toHaveAttribute('aria-disabled', 'true');
  await expect(update).toBeFocused();
  await expect(work.getByText('No changes to hand in')).toBeVisible();

  // It lives on the server: a reload shows it handed in, and it moved to the Submitted tab.
  await page.reload();
  await expect(work.getByText('Submitted', { exact: true })).toBeVisible();
  await expect(work.getByRole('button', { name: 'Mark as submitted' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Submitted' }).click();
  await expect(page.getByText('Reading check-in: Chapter 3')).toBeVisible();
});

test('write: format text, keep the draft across a reload, save it to Your work as an online document', async ({ page }) => {
  await signIn(page);
  await page.goto('/assignments?task=104');
  const dialog = page.getByRole('dialog');
  const work = dialog.getByRole('region', { name: 'Your work' });
  await work.getByRole('button', { name: 'Write' }).click();
  await expect(page).toHaveURL(/write=1/);

  const doc = dialog.getByRole('textbox', { name: 'Your writing' });
  await doc.click();
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('观察记录');
  await expect(dialog.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' — first visit');
  await expect(dialog.getByText('Draft saved')).toBeVisible();

  // The draft lives in this browser: a reload brings it back.
  await page.reload();
  await expect(doc.locator('strong')).toHaveText('观察记录');

  // A link inserted at the caret; text typed after it, even right at its end, stays outside the link.
  await doc.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' see ');
  await dialog.getByRole('button', { name: 'Link' }).click();
  await page.getByRole('textbox', { name: 'Link address' }).fill('example.com');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' more');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('!');
  await expect(doc.locator('a')).toHaveText('https://example.com');
  await expect(doc).toContainText('https://example.com!');

  const title = dialog.getByRole('textbox', { name: 'Title' });
  await title.fill('Field notes');
  await dialog.getByRole('button', { name: 'Save to Your work' }).click();
  await expect(page.getByText('Saved Field notes to Your work')).toBeVisible();
  await expect(page).not.toHaveURL(/write=1/);
  const row = work.getByRole('button', { name: 'Field notes, Online document' });
  await expect(row).toBeFocused();

  // Not handed in yet: the row opens it again in the writer, and saving updates the same document.
  await row.click();
  await expect(page).toHaveURL(/write=1&doc=/);
  await expect(doc.locator('strong')).toHaveText('观察记录');
  await expect(doc.locator('a')).toHaveAttribute('href', 'https://example.com');
  await doc.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Second visit.');
  await dialog.getByRole('button', { name: 'Save to Your work' }).click();
  await expect(page.getByText('Saved Field notes to Your work')).toBeVisible();
  await expect(work.getByRole('button', { name: /^Field notes, Online document/ })).toHaveCount(1);

  // It lives on the server: after a reload the row opens with the saved text, and the drafts are used up.
  await page.reload();
  await work.getByRole('button', { name: 'Field notes, Online document' }).click();
  await expect(doc).toContainText('Second visit.');
  await expect(dialog.getByText('Draft saved')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Back to assignment' }).click();
  await work.getByRole('button', { name: 'Write' }).click();
  await expect(doc).toHaveText('');
});

test('write: an online document past Yungu\'s limit is refused before sending, and the text stays', async ({ page }) => {
  await signIn(page);
  await page.goto('/assignments?task=104&write=1');
  const dialog = page.getByRole('dialog');
  const doc = dialog.getByRole('textbox', { name: 'Your writing' });
  await doc.click();
  let sent = 0;
  page.on('request', (r) => {
    if (r.url().includes('/online-docs')) sent += 1;
  });
  await page.keyboard.insertText('观'.repeat(21_840));
  await dialog.getByRole('button', { name: 'Save to Your work' }).click();
  await expect(dialog.getByText('Too long for Yungu — cut about 4 characters.')).toBeVisible();
  expect(sent).toBe(0);
  await expect(page).toHaveURL(/write=1/);
  await expect(dialog.getByText('Draft saved')).toBeVisible();
});

test('a handed-in online document opens as a preview; Edit saves a new one in its place, for Update', async ({ page }) => {
  await signIn(page);
  await page.goto('/assignments?task=208');
  const dialog = page.getByRole('dialog', { name: '课堂反思：第一次用户访谈' });
  const work = dialog.getByRole('region', { name: 'Your work' });
  await expect(work.getByText('Submitted', { exact: true })).toBeVisible();
  let fetchedDoc = false;
  page.on('request', (r) => {
    if (r.url().includes('/api/files/fx-doc-208')) fetchedDoc = true;
  });

  await work.getByRole('button', { name: '课堂反思, Online document' }).click();
  const viewer = page.getByRole('dialog', { name: '课堂反思', exact: true });
  const page_ = viewer.getByRole('article', { name: '课堂反思' });
  await expect(page_.getByRole('heading', { level: 3 })).toBeVisible();
  await expect(page_.locator('blockquote')).not.toHaveCount(0);
  await expect(page).not.toHaveURL(/write=1/);

  await viewer.getByRole('button', { name: 'Edit' }).click();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/write=1&doc=fx-doc-208/);
  const doc = dialog.getByRole('textbox', { name: 'Your writing' });
  await expect(doc.locator('h1')).toBeVisible();
  await doc.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('补充一句。');
  await dialog.getByRole('button', { name: 'Save to Your work' }).click();
  await expect(page.getByText('Saved 课堂反思 to Your work')).toBeVisible();

  // The handed-in version is untouched: a new document took its place, waiting for Update.
  const rows = work.getByRole('button', { name: '课堂反思, Online document' });
  await expect(rows).toHaveCount(1);
  await expect(work.getByText('Changes not handed in — press Update to hand them in.')).toBeVisible();
  await expect(work.getByRole('button', { name: 'Update' })).toBeEnabled();
  // The new one is not handed in, so it opens straight in the writer.
  await rows.click();
  await expect(page).toHaveURL(/write=1&doc=(?!fx-doc-208)/);
  await expect(doc).toContainText('补充一句。');
  expect(fetchedDoc).toBe(false);
});

// Chromium's fake camera and microphone (flags in playwright.config.ts); 127.0.0.1 is a secure context.
test.describe('camera and recorder (fake devices)', () => {
  test('two photos and a recording land in Your work as separate files', async ({ page }) => {
    await signIn(page);
    await page.goto('/assignments?task=103');
    const work = page.getByRole('dialog').getByRole('region', { name: 'Your work' });

    await work.getByRole('button', { name: 'Camera' }).click();
    const camera = page.getByRole('dialog', { name: 'Camera' });
    const shutter = camera.getByRole('button', { name: 'Take photo' });
    await expect(shutter).toBeEnabled();
    await shutter.click();
    await shutter.click();
    await camera.getByRole('button', { name: 'Add 2 photos' }).click();
    await expect(camera).toBeHidden();
    await expect(work.getByRole('button', { name: 'Camera' })).toBeFocused();
    await expect(work.getByRole('button', { name: /^Photo \d{4}-\d{2}-\d{2} [\d.]+( \(2\))?\.jpg, Image/ })).toHaveCount(2);

    await work.getByRole('button', { name: 'Record' }).click();
    const recorder = page.getByRole('dialog', { name: 'Record audio' });
    await recorder.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(recorder.getByText('00:01')).toBeVisible();
    await recorder.getByRole('button', { name: 'Stop' }).click();
    await expect(recorder.locator('audio[controls]')).toBeVisible();
    await recorder.getByRole('button', { name: 'Add recording' }).click();
    await expect(work.getByRole('button', { name: /^Recording .*\.webm, Audio/ })).toBeVisible();
    // Nothing is left holding the camera or the microphone.
    await expect(page.locator('video')).toHaveCount(0);
  });
});
