import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Appearance in the gear menu, against the mock: the choice applies at once, is remembered in the
// yl_appearance cookie so the server's first HTML already carries it, and Automatic follows the system.

// The M3 surfaces (theme/expressive.ts lightRoles.surface / darkRoles.surface) as computed colours.
const LIGHT_SURFACE = 'rgb(249, 249, 255)';
const DARK_SURFACE = 'rgb(17, 19, 24)';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Student ID').fill('170104022');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/assignments$/);
}

async function choose(page: Page, option: 'Automatic' | 'Light' | 'Dark') {
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Appearance' }).hover();
  const sub = page.getByRole('menu', { name: 'Appearance' });
  await expect(sub).toBeVisible();
  await sub.getByRole('menuitemradio', { name: option }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const html = (page: Page) => page.locator('html');

test('Dark applies at once and the server renders it on the next load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page);
  await expect(html(page)).toHaveAttribute('data-appearance', 'light');
  await choose(page, 'Dark');
  await expect(html(page)).toHaveAttribute('data-appearance', 'dark');
  await expect.poll(() => bodyBackground(page)).toBe(DARK_SURFACE);
  expect((await page.context().cookies()).find((c) => c.name === 'yl_appearance')?.value).toBe('dark');

  // The first HTML, before any script: <html> already says dark.
  const first = await (await page.request.get('/assignments')).text();
  expect(first).toMatch(/<html[^>]*data-appearance="dark"/);
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-appearance', 'dark');
  expect(await bodyBackground(page)).toBe(DARK_SURFACE);

  // The checked option is marked.
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Appearance' }).hover();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Light renders light from the server too.
  await choose(page, 'Light');
  await expect(html(page)).toHaveAttribute('data-appearance', 'light');
  expect(await (await page.request.get('/assignments')).text()).toMatch(/<html[^>]*data-appearance="light"/);
});

test('Automatic follows the system scheme live, without a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page);
  await choose(page, 'Light');
  await choose(page, 'Automatic');
  await expect(html(page)).toHaveAttribute('data-appearance', 'dark');
  await expect.poll(() => bodyBackground(page)).toBe(DARK_SURFACE);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => bodyBackground(page)).toBe(LIGHT_SURFACE);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => bodyBackground(page)).toBe(DARK_SURFACE);

  // The server leaves the attribute to the init script, which sets it before paint on a reload.
  const first = await (await page.request.get('/assignments')).text();
  expect(first).not.toMatch(/<html[^>]*data-appearance=/);
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-appearance', 'dark');
});

test('no light flash on a dark load: the first paint already has the dark surface', async ({ page }) => {
  await signIn(page);
  await choose(page, 'Dark');
  // Record the body colour from the very first script that can run, before the app's own.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { firstBg: string }).firstBg = getComputedStyle(document.body).backgroundColor;
    });
  });
  await page.goto('/calendar');
  expect(await page.evaluate(() => (window as unknown as { firstBg: string }).firstBg)).toBe(DARK_SURFACE);
  // The sign-in page, outside the dashboard, follows the same choice.
  const login = await (await page.request.get('/login')).text();
  expect(login).toMatch(/<html[^>]*data-appearance="dark"/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a tap opens the submenu inside the screen', async ({ page }) => {
    await signIn(page);
    await page.getByRole('banner').getByRole('button', { name: 'Settings' }).tap();
    await page.getByRole('menuitem', { name: 'Appearance' }).tap();
    const sub = page.getByRole('menu', { name: 'Appearance' });
    await expect(sub).toBeVisible();
    const box = await sub.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await sub.getByRole('menuitemradio', { name: 'Dark' }).tap();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  });
});

// Every surface in Dark: axe finds no contrast failure, and each is photographed in both schemes at a
// laptop and a phone size for review (SHOTS_DIR, else test-results/appearance).
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/appearance';
const AXE = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');

async function contrastViolations(page: Page, include?: string) {
  await page.addScriptTag({ path: AXE });
  // Let entrance motion settle so colours are measured at rest.
  await page.waitForTimeout(400);
  return page.evaluate(async (scope) => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[]; failureSummary: string }[] }[] }> } }).axe;
    const r = await axe.run(scope ? { include: [scope] } : document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return r.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary}`));
  }, include);
}

type Surface = { name: string; open: (page: Page) => Promise<void>; scope?: string; signedOut?: boolean };

const SURFACES: Surface[] = [
  { name: 'assignments', open: async (p) => { await p.goto('/assignments'); await expect(p.getByRole('article').first()).toBeVisible(); } },
  { name: 'submitted', open: async (p) => { await p.goto('/assignments?tab=submitted'); await expect(p.getByRole('article').first()).toBeVisible(); } },
  { name: 'calendar', open: async (p) => { await p.goto('/calendar'); await expect(p.getByRole('listitem').first()).toBeVisible(); } },
  { name: 'behaviour', open: async (p) => { await p.goto('/behaviour'); await expect(p.getByRole('main')).toBeVisible(); } },
  {
    name: 'popup-todo',
    scope: '[role="dialog"]',
    open: async (p) => { await p.goto('/assignments?task=102'); await expect(p.getByRole('dialog').getByRole('heading', { name: 'Attachments (4)' })).toBeVisible(); },
  },
  {
    name: 'popup-submitted',
    scope: '[role="dialog"]',
    open: async (p) => { await p.goto('/assignments?tab=submitted&task=207'); await expect(p.getByRole('dialog', { name: 'Task 2：用户访谈提纲' })).toBeVisible(); },
  },
  {
    name: 'write',
    scope: '[role="dialog"]',
    open: async (p) => {
      await p.goto('/assignments?task=102');
      await p.getByRole('dialog').getByRole('region', { name: 'Your work' }).getByRole('button', { name: 'Write' }).click();
      await expect(p.getByRole('dialog').getByRole('textbox', { name: 'Your writing' })).toBeVisible();
    },
  },
  {
    name: 'camera',
    open: async (p) => {
      await p.goto('/assignments?task=102');
      await p.getByRole('dialog').getByRole('region', { name: 'Your work' }).getByRole('button', { name: 'Camera' }).click();
      const camera = p.getByRole('dialog', { name: 'Camera' });
      await camera.getByRole('button', { name: 'Take photo' }).click();
      await expect(camera.getByRole('list', { name: 'Photos taken' })).toBeVisible();
    },
  },
  {
    name: 'recorder',
    open: async (p) => {
      await p.goto('/assignments?task=102');
      await p.getByRole('dialog').getByRole('region', { name: 'Your work' }).getByRole('button', { name: 'Record' }).click();
      await expect(p.getByRole('dialog', { name: 'Record audio' })).toBeVisible();
    },
  },
  {
    name: 'notifications',
    scope: '[role="dialog"]',
    open: async (p) => {
      await p.goto('/assignments');
      await p.getByRole('banner').getByRole('button', { name: /^Notifications/ }).click();
      await expect(p.getByRole('dialog', { name: 'Notifications' }).getByRole('heading', { name: /^Unread/ })).toBeVisible();
    },
  },
  {
    name: 'gear',
    scope: '[role="menu"]',
    open: async (p) => {
      await p.goto('/assignments');
      await p.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
      await p.getByRole('menuitem', { name: 'Appearance' }).click();
      await expect(p.getByRole('menu', { name: 'Appearance' })).toBeVisible();
    },
  },
  { name: 'login', signedOut: true, open: async (p) => { await p.goto('/login'); await expect(p.getByLabel('Student ID')).toBeVisible(); } },
];

// Signed in once per worker; every signed-in surface starts from that session.
const signedIn = test.extend<object, { session: string }>({
  session: [
    async ({ browser }, provide, workerInfo) => {
      const file = path.join(workerInfo.project.outputDir, `.session-${workerInfo.workerIndex}.json`);
      const page = await browser.newPage({ baseURL: workerInfo.project.use.baseURL });
      await signIn(page);
      await page.context().storageState({ path: file });
      await page.context().close();
      await provide(file);
    },
    { scope: 'worker' },
  ],
  storageState: ({ session }, provide) => provide(session),
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`every surface at ${viewport.width}×${viewport.height}`, () => {
    for (const surface of SURFACES) {
      (surface.signedOut ? test : signedIn)(
        `${surface.name}: no contrast failure in Dark; photographed in both schemes`,
        async ({ browser, baseURL, storageState }) => {
          // A fresh context per scheme: nothing (a route, an open dialog) carries over.
          for (const scheme of ['light', 'dark'] as const) {
            const context = await browser.newContext({ baseURL, viewport, storageState: surface.signedOut ? undefined : storageState });
            await context.addCookies([{ name: 'yl_appearance', value: scheme, url: baseURL! }]);
            const page = await context.newPage();
            await surface.open(page);
            await expect(html(page)).toHaveAttribute('data-appearance', scheme);
            const violations = await contrastViolations(page, surface.scope);
            await page.screenshot({ path: `${SHOTS}/${surface.name}-${scheme}-${viewport.width}.png` });
            await context.close();
            if (scheme === 'dark') expect(violations).toEqual([]);
          }
        },
      );
    }
  });
}
