import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

// The packaged app (`npm run dist:linux-dir`): set YUNGU_SMOKE_BINARY to its executable, e.g.
//   YUNGU_SMOKE_BINARY=release/linux-unpacked/chihairou-yungu-local xvfb-run -a npx playwright test e2e/packaged.spec.ts
// A packaged app ignores the mock data source, so this only checks what needs no sign-in.
const binary = process.env.YUNGU_SMOKE_BINARY;
const APP_NAME = "chihairou's Yungu (local)";

test.skip(!binary, 'set YUNGU_SMOKE_BINARY to the packaged executable');

let app: ElectronApplication;
let userData: string;

test.beforeEach(async () => {
  userData = mkdtempSync(path.join(tmpdir(), 'yl-packaged-'));
  // --user-data-dir keeps the run off any real profile; no credentials are saved there, so the app opens /login.
  app = await electron.launch({
    executablePath: path.resolve(binary!),
    args: ['--no-sandbox', `--user-data-dir=${userData}`],
    timeout: 60_000,
  });
});

test.afterEach(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

test('the packaged app opens /login from its bundled server, locked', async () => {
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/login$/, { timeout: 45_000 });
  const origin = new URL(page.url()).origin;

  const info = await app.evaluate(({ app: a, BrowserWindow }) => ({
    packaged: a.isPackaged,
    resources: process.resourcesPath,
    title: BrowserWindow.getAllWindows()[0].getTitle(),
  }));
  expect(info.packaged).toBe(true);
  expect(info.title).toBe(APP_NAME);
  // The server it started is the bundled one.
  const { existsSync } = await import('node:fs');
  expect(existsSync(path.join(info.resources, 'server', 'server.js'))).toBe(true);
  expect(existsSync(path.join(info.resources, 'server', 'node_modules', 'next'))).toBe(true);

  await expect(page.getByLabel('Student ID')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  // Static files come through the bundled server too.
  expect(await page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0);

  const res = await fetch(`${origin}/login`, { redirect: 'manual' });
  expect(res.status).toBe(403);
});
