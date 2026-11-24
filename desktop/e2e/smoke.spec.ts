import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const APP_NAME = "chihairou's Yungu (local)";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath = require('electron') as unknown as string;

let app: ElectronApplication;
let userData: string;

const shellDir = path.join(__dirname, '..');
const envFor = (extra: Record<string, string> = {}) => ({
  ...process.env,
  YUNGU_LOCAL_DATA_SOURCE: 'mock',
  YUNGU_LOCAL_USER_DATA: userData,
  ...extra,
});

async function launch(extra?: Record<string, string>) {
  app = await electron.launch({ args: [shellDir, '--no-sandbox'], env: envFor(extra), timeout: 60_000 });
}

test.beforeEach(async ({}, testInfo) => {
  userData = mkdtempSync(path.join(tmpdir(), 'yl-desktop-'));
  if (!/slow startup|unreachable startup/.test(testInfo.title)) await launch();
});

test.afterEach(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test('opens on the sign-in page, signs in, keeps links outside and the server locked', async () => {
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/login$/, { timeout: 45_000 });
  const origin = new URL(page.url()).origin;

  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const prefs = w.webContents.getLastWebPreferences()!;
    return {
      title: w.getTitle(),
      prefs: {
        contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration,
        sandbox: prefs.sandbox,
        webSecurity: prefs.webSecurity,
      },
    };
  });
  expect(win.title).toBe(APP_NAME);
  expect(win.prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
  // plugins: true: the built-in PDF viewer is on.
  expect(await page.evaluate(() => navigator.pdfViewerEnabled)).toBe(true);

  // From outside the app (no lock cookie, or a wrong one) the server refuses everything.
  for (const headers of [{}, { cookie: 'yl_local=wrong' }, { cookie: 'yl_local=' }]) {
    for (const p of ['/login', '/assignments', '/api/session', '/favicon.ico']) {
      const res = await fetch(`${origin}${p}`, { headers, redirect: 'manual' });
      expect(res.status, `${p} ${JSON.stringify(headers)}`).toBe(403);
    }
  }

  // Sign in with the mock.
  await page.getByLabel('Student ID').fill('100000001');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${origin}/assignments`);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe(APP_NAME);

  // Fullscreen is allowed on app pages (a video's fullscreen button).
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'fs';
    b.textContent = 'fs';
    b.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
    b.onclick = () => {
      document.documentElement.requestFullscreen().then(
        () => (b.dataset.result = 'ok'),
        (e: Error) => (b.dataset.result = e.name),
      );
    };
    document.body.prepend(b);
  });
  await page.locator('#fs').click();
  await expect(page.locator('#fs')).toHaveAttribute('data-result', 'ok');
  await page.evaluate(() => document.exitFullscreen());
  // (before the link clicks below: Playwright then waits on the navigations the shell cancels)

  // External links go to the browser (stubbed here); the window stays on the app.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  await page.evaluate(() => {
    const add = (id: string, href: string, blank = false) => {
      const a = document.createElement('a');
      a.id = id;
      a.href = href;
      a.textContent = id;
      if (blank) a.target = '_blank';
      document.body.prepend(a);
    };
    add('ext', 'https://task.yungu.org/some/page');
    add('ext-blank', 'https://example.com/blank', true);
    add('file', 'file:///etc/passwd');
    add('other-port', 'http://127.0.0.1:1/');
    add('localhost', 'http://localhost:1/');
  });
  // The DOM's click() (Playwright's own click would wait for the navigation the shell cancels).
  for (const id of ['ext', 'ext-blank', 'file', 'other-port', 'localhost']) {
    await page.evaluate((i) => document.getElementById(i)!.click(), id);
  }
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['https://task.yungu.org/some/page', 'https://example.com/blank']);
  await page.waitForTimeout(500);
  expect(page.url()).toBe(`${origin}/assignments`);
  expect(app.windows()).toHaveLength(1);
});

test('a server that stops is reported, and Restart brings the app back', async () => {
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/\/login$/, { timeout: 45_000 });
  const before = new URL(page.url()).origin;

  await app.evaluate(({ dialog }) => {
    const shown: string[] = [];
    (globalThis as { shown?: string[] }).shown = shown;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args[args.length - 1] as { message: string; buttons: string[] };
      shown.push(`${options.message} [${options.buttons.join('/')}]`);
      return { response: 0, checkboxChecked: false }; // Restart
    }) as typeof dialog.showMessageBox;
  });
  const pid = await app.evaluate(({ app: a }) => {
    const m = a.getAppMetrics().find((p) => p.type === 'Utility' && p.name === "chihairou's Yungu (local) server");
    return m?.pid;
  });
  expect(pid).toBeTruthy();
  process.kill(pid!, 'SIGKILL');

  await expect
    .poll(() => app.evaluate(() => (globalThis as { shown?: string[] }).shown))
    .toEqual([`${APP_NAME} stopped unexpectedly. [Restart/Quit]`]);
  // A new server on a new port, and the window on it.
  await expect.poll(() => new URL(page.url()).origin, { timeout: 45_000 }).not.toBe(before);
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/login$/);
  expect((await fetch(`${before}/login`).catch(() => null))?.status).toBeUndefined(); // the old one is gone
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('the splash stays up through a slow startup sign-in, also for a second launch', async () => {
  await launch({ YUNGU_LOCAL_SIGN_IN_DELAY_MS: '6000' });
  const page = await app.firstWindow();
  const view = () =>
    app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { visible: w.isVisible(), url: w.webContents.getURL() };
    });
  // The server is up within the delay; the window still shows the splash, not a blank page.
  await expect.poll(view, { timeout: 5_000 }).toEqual({ visible: true, url: expect.stringMatching(/splash\.html$/) });
  await expect(page.getByText('Starting…')).toBeVisible();

  // A second launch only brings this window forward, still on the splash.
  const second = spawn(electronPath, [shellDir, '--no-sandbox'], { env: envFor(), stdio: 'ignore' });
  const code = await new Promise<number | null>((r) => second.once('exit', r));
  expect(code).toBe(0);
  expect(await view()).toEqual({ visible: true, url: expect.stringMatching(/splash\.html$/) });

  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/login$/, { timeout: 15_000 });
});

test('an unreachable startup sign-in shows the notice and opens Assignments by itself once it gets through', async () => {
  // Saved credentials and a Yungu that cannot be reached at the startup sign-in and the first retry; the
  // second retry (1.5 s apart here, 10 s in the app) gets through.
  await launch({ YUNGU_LOCAL_STARTUP_UNREACHABLE: '2', YUNGU_LOCAL_SIGN_IN_RETRY_MS: '1500' });
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/login$/, { timeout: 45_000 });
  await expect(page.getByRole('alert')).toHaveText("Can't reach Yungu right now — trying again.");
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled(); // the form still works meanwhile
  await expect(page).toHaveURL(/\/assignments$/, { timeout: 20_000 });
  // And it stays there: the retry has stopped.
  await page.waitForTimeout(4_000);
  await expect(page).toHaveURL(/\/assignments$/);
});

test('a redirect off the app is downloaded (file storage) or sent to the browser, and never moves a window', async () => {
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/\/login$/, { timeout: 45_000 });
  const origin = new URL(page.url()).origin;
  const OSS = 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/stu/1/signed.pdf?Signature=x';
  const OUT = 'https://example.com/elsewhere';
  // Stand-ins: app addresses that redirect (as /api/files/<id> does to a signed link), a recorded
  // downloadURL on the main window, and a recorded openExternal.
  await app.evaluate(
    ({ BrowserWindow, session, shell }, { oss, out }) => {
      const g = globalThis as { downloads?: string[]; opened?: string[] };
      g.downloads = [];
      g.opened = [];
      const main = BrowserWindow.getAllWindows()[0].webContents;
      main.downloadURL = (url: string) => void g.downloads!.push(url);
      shell.openExternal = async (url: string) => void g.opened!.push(url);
      session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
        const p = new URL(d.url).pathname;
        cb(p === '/to-oss' ? { redirectURL: oss } : p === '/to-out' ? { redirectURL: out } : {});
      });
    },
    { oss: OSS, out: OUT },
  );
  const state = () =>
    app.evaluate(() => {
      const g = globalThis as { downloads?: string[]; opened?: string[] };
      return { downloads: g.downloads, opened: g.opened };
    });

  // In the main window: it stays on its page.
  await page.evaluate(() => void (location.href = '/to-oss'));
  await expect.poll(state).toEqual({ downloads: [OSS], opened: [] });
  await page.evaluate(() => void (location.href = '/to-out'));
  await expect.poll(state).toEqual({ downloads: [OSS], opened: [OUT] });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(`${origin}/login`);

  // "Open in new tab": the window opened only for the redirect closes again.
  await page.evaluate(() => void window.open('/to-oss', '_blank'));
  await expect.poll(state).toEqual({ downloads: [OSS, OSS], opened: [OUT] });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await page.evaluate(() => void window.open('/to-out', '_blank'));
  await expect.poll(state).toEqual({ downloads: [OSS, OSS], opened: [OUT, OUT] });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(page.url()).toBe(`${origin}/login`);
});
