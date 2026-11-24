import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Suspension Mode end to end, with a stand-in for the Swift Wi-Fi helper: a script that prints whatever
// the spec last wrote to `wifi.txt` (`YUNGU_WIFI_HELPER`, honoured only while the app is not packaged).

let app: ElectronApplication;
let dir: string;
let userData: string;
let other: Server;
let otherHits = 0;
let otherUrl = '';

const shellDir = path.join(__dirname, '..');
const OSS_URL = 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/stu/1/blocked-check.pdf';
const wifiFile = () => path.join(dir, 'wifi.txt');
const callsFile = () => path.join(dir, 'calls.txt');
/** How many times the app has run the helper. */
const helperCalls = () => {
  try {
    return readFileSync(callsFile(), 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
};
const setWifi = (line: string) => writeFileSync(wifiFile(), `${line}\n`);

test.beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'yl-susp-e2e-'));
  userData = path.join(dir, 'user-data');
  const helper = path.join(dir, 'wifi-ssid');
  writeFileSync(helper, `#!/bin/sh\necho x >> "${callsFile()}"\ncat "${wifiFile()}"\n`);
  chmodSync(helper, 0o755);
  setWifi('SSID:Home');
  // Another server on this machine: a request to it leaves the app (counted when it arrives).
  otherHits = 0;
  other = createServer((_req, res) => {
    otherHits += 1;
    res.writeHead(200, { 'access-control-allow-origin': '*' }).end('hi');
  });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/ping`;
});

async function launch() {
  app = await electron.launch({
    args: [shellDir, '--no-sandbox'],
    env: {
      ...process.env,
      YUNGU_LOCAL_DATA_SOURCE: 'mock',
      YUNGU_LOCAL_USER_DATA: userData,
      YUNGU_WIFI_HELPER: path.join(dir, 'wifi-ssid'),
    },
    timeout: 60_000,
  });
}

test.afterEach(async () => {
  await app?.close();
  await new Promise((r) => other.close(r));
  rmSync(dir, { recursive: true, force: true });
});

async function signIn(): Promise<Page> {
  await launch();
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/\/login$/, { timeout: 45_000 });
  // Retried: a form filled before it hydrates can be reset by it.
  await expect(async () => {
    await page.getByLabel('Student ID').fill('100000001');
    await page.getByLabel('Password').fill('x');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/assignments$/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  return page;
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: /^Account:/ }).click();
  return page.getByRole('menu');
}

/** What the window's session saw happen to requests that left the app (cancelled ones show as blocked). */
async function watchErrors() {
  await app.evaluate(({ session }) => {
    const errors: string[] = [];
    (globalThis as { netErrors?: string[] }).netErrors = errors;
    session.defaultSession.webRequest.onErrorOccurred((d) => errors.push(`${d.url} ${d.error}`));
  });
}
const netErrors = () => app.evaluate(() => (globalThis as { netErrors?: string[] }).netErrors ?? []);

/** A request from the page; resolves to 'ok' or 'failed'. */
const pageFetch = (page: Page, url: string) =>
  page.evaluate((u) => fetch(u, { mode: 'no-cors', cache: 'no-store' }).then(() => 'ok', () => 'failed'), url);

const screenOf = (page: Page) => page.getByRole('alertdialog', { name: 'Suspension Mode' });

test('suspends on a Wi-Fi not allowed, resumes by itself on an allowed one, and the button turns it off', async () => {
  const page = await signIn();
  await watchErrors();
  // Before Suspension Mode is on, the page's requests leave as usual.
  expect(await pageFetch(page, otherUrl)).toBe('ok');
  expect(otherHits).toBe(1);
  // With the switch off the Wi-Fi is never read (no Location prompt for someone not using it).
  await page.waitForTimeout(3_500);
  expect(helperCalls()).toBe(0);

  // The preload is the main window's only: a window an app page opens has no API.
  const [child] = await Promise.all([app.waitForEvent('window'), page.evaluate(() => void window.open('/login'))]);
  await child.waitForLoadState();
  expect(await child.evaluate(() => typeof (window as { yunguLocal?: unknown }).yunguLocal)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys((window as unknown as { yunguLocal: object }).yunguLocal).sort())).toEqual([
    'getState',
    'onState',
    'readWifi',
    'setAllowedWifi',
    'setSuspension',
  ]);
  await child.close();

  // Allow "School" through the list editor.
  let menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: 'Allowed Wi-Fi…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Allowed Wi-Fi' });
  // Opening it reads the Wi-Fi once, so it can offer "Home" (not listed).
  await expect(dialog.getByRole('button', { name: 'Add current Wi-Fi' })).toBeVisible();
  expect(helperCalls()).toBe(1);
  await dialog.getByLabel('Wi-Fi name').fill('School');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByRole('listitem')).toHaveText(['School']);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // Switch on while on "Home": the screen at once, focus on its button, and nothing leaves the app.
  menu = await openMenu(page);
  await menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' }).click();
  const screen = screenOf(page);
  await expect(screen).toBeVisible({ timeout: 2_000 });
  await expect(screen).toContainText('Not sending anything to Yungu on "Home".');
  await expect(page.getByRole('button', { name: 'Turn off Suspension Mode' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(screen).toBeVisible();
  expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))).toEqual({ suspension: true, allowedWifi: ['School'] });

  expect(await pageFetch(page, OSS_URL)).toBe('failed');
  expect(await pageFetch(page, otherUrl)).toBe('failed');
  expect(otherHits).toBe(1);
  await expect.poll(netErrors).toEqual(expect.arrayContaining([`${OSS_URL} net::ERR_BLOCKED_BY_CLIENT`]));
  // The app's own server still answers.
  expect(await page.evaluate(() => fetch('/login').then((r) => r.status))).toBe(200);

  // On "School" the screen goes by itself (the 3 s poll), and requests leave again.
  setWifi('SSID:School');
  await expect(screen).toBeHidden({ timeout: 4_000 });
  expect(await pageFetch(page, otherUrl)).toBe('ok');
  expect(otherHits).toBe(2);
  await expect(page).toHaveURL(/\/assignments$/);

  // On "Cafe" it is back; its button turns Suspension Mode off.
  setWifi('SSID:Cafe');
  await expect(screen).toBeVisible({ timeout: 4_000 });
  await expect(screen).toContainText('Not sending anything to Yungu on "Cafe".');
  await page.getByRole('button', { name: 'Turn off Suspension Mode' }).click();
  await expect(screen).toBeHidden();
  expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8')).suspension).toBe(false);
  // The account menu stayed open under the screen since the switch was clicked; it shows the switch off.
  menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' })).toHaveAttribute('aria-checked', 'false');
  // Off again: the polling stops.
  const callsWhenOff = helperCalls();
  await page.waitForTimeout(4_000);
  expect(helperCalls()).toBe(callsWhenOff);

  // No Wi-Fi at all is never suspended, switch on or not.
  setWifi('NONE');
  await menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' }).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' })).toHaveAttribute('aria-checked', 'true');
  // (Suspended for the moment until the first reading lands, then not.)
  await expect(screen).toBeHidden({ timeout: 4_000 });
  await page.waitForTimeout(3_500);
  await expect(screen).toBeHidden();
  expect(await pageFetch(page, otherUrl)).toBe('ok');
});

test("a Wi-Fi whose name can't be read suspends, also over the sign-in page", async () => {
  mkdirSync(userData, { recursive: true });
  writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ suspension: true, allowedWifi: ['School'] }));
  setWifi('UNKNOWN');
  await launch();
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/\/login$/, { timeout: 45_000 });
  const screen = screenOf(page);
  await expect(screen).toBeVisible();
  await expect(screen).toContainText("Can't tell which Wi-Fi this is.");
  // A broken helper is the same as an unreadable name.
  setWifi('garbage');
  await page.waitForTimeout(3_500);
  await expect(screen).toContainText("Can't tell which Wi-Fi this is.");
  setWifi('NONE');
  await expect(screen).toBeHidden({ timeout: 4_000 });
});
