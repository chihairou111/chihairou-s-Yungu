import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Suspension Mode end to end, with stand-ins for macOS's networksetup, route and arp: scripts in a folder
// (`YUNGU_NETWORK_COMMANDS`, honoured only while the app is not packaged) that print what a Mac would for
// the network the spec last set with `setNetwork`.

let app: ElectronApplication;
let dir: string;
let userData: string;
let other: Server;
let otherHits = 0;
let otherUrl = '';

const shellDir = path.join(__dirname, '..');
const OSS_URL = 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/stu/1/blocked-check.pdf';
const callsFile = () => path.join(dir, 'calls.txt');
const fakeDir = () => path.join(dir, 'bin');
/** How many readings the app has made (each starts with networksetup). */
const helperCalls = () => {
  try {
    return readFileSync(callsFile(), 'utf8').split('\n').filter((l) => l === 'networksetup').length;
  } catch {
    return 0;
  }
};

// The owner's school router, a café's and a home one.
const SCHOOL = '80:5:88:d0:83:e2';
const CAFE = 'cc:cc:cc:0:0:1';
const HOME = 'aa:aa:aa:0:0:1';

const PORTS = `Hardware Port: Ethernet Adapter (en4)
Device: en4
Ethernet Address: 11:22:33:44:55:66

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: aa:bb:cc:dd:ee:ff
`;
const ROUTE = `   route to: default
destination: default
    gateway: 10.0.160.1
  interface: en0
`;

/**
 * What the fake commands answer: a router's MAC (on Wi-Fi with that router), `none` (Wi-Fi not joined:
 * route says "not in table"), `incomplete` (arp has no MAC) or `garbage` (networksetup fails).
 * `{ aged: true }`: arp says "-- no entry" until the router has been pinged (macOS ages entries out).
 */
function setNetwork(net: string, opts: { aged?: boolean } = {}) {
  const out = (name: string, text: string) => writeFileSync(path.join(fakeDir(), `${name}.out`), text);
  rmSync(path.join(fakeDir(), 'pinged'), { force: true });
  rmSync(path.join(fakeDir(), 'ping-args'), { force: true });
  out('ping', '');
  writeFileSync(path.join(fakeDir(), 'aged'), opts.aged ? 'yes' : 'no');
  writeFileSync(path.join(fakeDir(), 'mode'), net === 'garbage' ? 'fail' : net === 'none' ? 'no-route' : 'ok');
  out('networksetup', PORTS);
  out('route', ROUTE);
  out('arp', `? (10.0.160.1) at ${net === 'incomplete' ? '(incomplete)' : net} on en0 ifscope [ethernet]\n`);
}

function writeFakes() {
  mkdirSync(fakeDir(), { recursive: true });
  const script = (name: string, body: string) => {
    const file = path.join(fakeDir(), name);
    writeFileSync(file, `#!/bin/sh\necho ${name} >> "${callsFile()}"\nmode=$(cat "${fakeDir()}/mode")\n${body}\ncat "${fakeDir()}/${name}.out"\n`);
    chmodSync(file, 0o755);
  };
  script('networksetup', '[ "$mode" = fail ] && { echo "boom" >&2; exit 1; }');
  script('route', '[ "$mode" = no-route ] && { echo "route: writing to routing socket: not in table" >&2; exit 1; }');
  script(
    'arp',
    `[ "$(cat "${fakeDir()}/aged")" = yes ] && [ ! -f "${fakeDir()}/pinged" ] && { echo "10.0.160.1 (10.0.160.1) -- no entry"; exit 1; }`,
  );
  // ping: records its arguments and refreshes the (fake) ARP entry.
  script('ping', `echo "$*" >> "${fakeDir()}/ping-args"\ntouch "${fakeDir()}/pinged"`);
}

test.beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'yl-susp-e2e-'));
  userData = path.join(dir, 'user-data');
  writeFakes();
  setNetwork(HOME);
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
      YUNGU_NETWORK_COMMANDS: fakeDir(),
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

/** The gear (Settings) menu: Appearance, then Suspension Mode's switch and Allowed networks…. */
async function openMenu(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('menu', { name: 'Settings' });
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

const SCHOOL_SAVED = { label: 'School', mac: '80:05:88:d0:83:e2' };

test('suspends on a router not allowed, resumes by itself on an allowed one, and the button turns it off', async () => {
  const page = await signIn();
  await watchErrors();
  // Before Suspension Mode is on, the page's requests leave as usual.
  expect(await pageFetch(page, otherUrl)).toBe('ok');
  expect(otherHits).toBe(1);
  // With the switch off the network is never read.
  await page.waitForTimeout(3_500);
  expect(helperCalls()).toBe(0);

  // The preload is the main window's only: a window an app page opens has no API.
  const [child] = await Promise.all([app.waitForEvent('window'), page.evaluate(() => void window.open('/login'))]);
  await child.waitForLoadState();
  expect(await child.evaluate(() => typeof (window as { yunguLocal?: unknown }).yunguLocal)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys((window as unknown as { yunguLocal: object }).yunguLocal).sort())).toEqual([
    'getState',
    'onState',
    'readNetwork',
    'setAllowedNetworks',
    'setAppearance',
    'setSuspension',
  ]);
  await child.close();

  // At school: readNetwork() reads once and answers with the router's MAC (normalised).
  setNetwork(SCHOOL);
  expect(await page.evaluate(() => (window as unknown as { yunguLocal: { readNetwork(): Promise<unknown> } }).yunguLocal.readNetwork())).toEqual({
    mac: SCHOOL_SAVED.mac,
  });
  expect(helperCalls()).toBe(1);

  // Allow it with "Add current network" and a label.
  let menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: 'Allowed networks…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Allowed networks' });
  await expect(dialog.getByText('No networks allowed yet.')).toBeVisible();
  const add = dialog.getByRole('button', { name: 'Add current network' });
  await expect(add).toBeDisabled(); // a label first
  await expect.poll(helperCalls).toBe(2); // opening it reads the network once
  await dialog.getByLabel('Label').fill('School');
  await add.click();
  await expect(dialog.getByRole('listitem')).toHaveText(['School']);
  await expect(dialog.getByText('This network is allowed as “School”.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  // Focus is back on the gear, not lost on <body>.
  await expect(page.getByRole('banner').getByRole('button', { name: 'Settings' })).toBeFocused();

  // Switch on at home: the screen at once, focus on its button, and nothing leaves the app.
  setNetwork(HOME);
  menu = await openMenu(page);
  await menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' }).click();
  const screen = screenOf(page);
  await expect(screen).toBeVisible({ timeout: 2_000 });
  await expect(screen).toContainText('Not sending anything to Yungu on this network.');
  await expect(page.getByRole('button', { name: 'Turn off Suspension Mode' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(screen).toBeVisible();
  expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))).toEqual({
    suspension: true,
    allowedNetworks: [SCHOOL_SAVED],
    appearance: 'auto',
  });

  expect(await pageFetch(page, OSS_URL)).toBe('failed');
  expect(await pageFetch(page, otherUrl)).toBe('failed');
  expect(otherHits).toBe(1);
  await expect.poll(netErrors).toEqual(expect.arrayContaining([`${OSS_URL} net::ERR_BLOCKED_BY_CLIENT`]));
  // The app's own server still answers.
  expect(await page.evaluate(() => fetch('/login').then((r) => r.status))).toBe(200);

  // Back on the school router the screen goes by itself (the 3 s poll), and requests leave again.
  setNetwork(SCHOOL);
  await expect(screen).toBeHidden({ timeout: 4_000 });
  expect(await pageFetch(page, otherUrl)).toBe('ok');
  expect(otherHits).toBe(2);
  await expect(page).toHaveURL(/\/assignments$/);

  // On a café's router it is back; its button turns Suspension Mode off.
  setNetwork(CAFE);
  await expect(screen).toBeVisible({ timeout: 4_000 });
  await expect(screen).toContainText('Not sending anything to Yungu on this network.');
  await page.getByRole('button', { name: 'Turn off Suspension Mode' }).click();
  await expect(screen).toBeHidden();
  expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8')).suspension).toBe(false);
  // The gear menu stayed open under the screen since the switch was clicked; it shows the switch off.
  menu = page.getByRole('menu', { name: 'Settings' });
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' })).toHaveAttribute('aria-checked', 'false');
  // Off again: the polling stops.
  const callsWhenOff = helperCalls();
  await page.waitForTimeout(4_000);
  expect(helperCalls()).toBe(callsWhenOff);

  // No network at all (Wi-Fi not joined) is never suspended, switch on or not.
  setNetwork('none');
  await menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' }).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Suspension Mode' })).toHaveAttribute('aria-checked', 'true');
  // (Suspended for the moment until the first reading lands, then not.)
  await expect(screen).toBeHidden({ timeout: 4_000 });
  await page.waitForTimeout(3_500);
  await expect(screen).toBeHidden();
  expect(await pageFetch(page, otherUrl)).toBe('ok');
});

test("a router that can't be read suspends, also over the sign-in page; v1's Wi-Fi names are dropped", async () => {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ suspension: true, allowedWifi: ['School'], allowedNetworks: [SCHOOL_SAVED] }),
  );
  setNetwork('incomplete');
  await launch();
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/\/login$/, { timeout: 45_000 });
  const screen = screenOf(page);
  await expect(screen).toBeVisible();
  await expect(screen).toContainText("Can't tell which network this is.");
  // A failing command is the same as an unreadable router.
  setNetwork('garbage');
  await page.waitForTimeout(3_500);
  await expect(screen).toContainText("Can't tell which network this is.");
  setNetwork('none');
  await expect(screen).toBeHidden({ timeout: 4_000 });
  // An aged-out ARP entry for the allowed router: one ping, then the MAC; never suspended for it.
  setNetwork(SCHOOL, { aged: true });
  const pings = () => {
    try {
      return readFileSync(path.join(fakeDir(), 'ping-args'), 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  await expect.poll(pings, { timeout: 4_000 }).toEqual(['-n -q -c 1 -t 1 -b en0 10.0.160.1']);
  await page.waitForTimeout(3_500);
  await expect(screen).toBeHidden();
  expect(pings()).toHaveLength(1); // the entry is fresh again: no more pings
  // The allowed router still counts.
  setNetwork(SCHOOL);
  await page.waitForTimeout(3_500);
  await expect(screen).toBeHidden();
  const state = await page.evaluate(() => (window as unknown as { yunguLocal: { getState(): Promise<Record<string, unknown>> } }).yunguLocal.getState());
  expect(state).toEqual({ suspension: true, allowedNetworks: [SCHOOL_SAVED], suspended: false, mac: SCHOOL_SAVED.mac });
});
