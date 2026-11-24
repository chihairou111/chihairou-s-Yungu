/**
 * chihairou's Yungu (local): the Electron main process. It starts the standalone Next server in a
 * utilityProcess on a free 127.0.0.1 port, locks it with a per-launch secret cookie, signs in with the
 * saved credentials, then shows the app in one window.
 *
 * Suspension Mode: the main process owns the network monitor and the settings, tells the server to
 * suspend or resume its Yungu requests, cancels the window's own outside requests (`setUpSession`) and
 * tells the page through the main window's preload (`window.yunguLocal`).
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  utilityProcess,
  type DownloadItem,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Session,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import { parseAppearance, themeSourceFor, windowBackground } from './appearance';
import { CredentialStore, type Credentials, type StringCrypto } from './credentials';
import { externalTarget, isAppUrl, redirectTarget } from './navigation';
import { permissionDecision } from './permissions';
import { parseServerMessage, type ServerMessage } from './server-messages';
import {
  encodeSession,
  LOCAL_COOKIE,
  NOTICE_MAX_AGE,
  NOTICE_PASSWORD,
  NOTICE_UNREACHABLE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SIGN_IN_NOTICE_COOKIE,
} from './session-cookie';
import { commandPaths, readNetwork, runCommand } from './network';
import { Settings, type AllowedNetwork } from './settings';
import { RETRY_INTERVAL_MS, SignInRetry, type RetryOutcome } from './sign-in-retry';
import { blockedWhileSuspended, SuspensionMonitor, type SuspensionState } from './suspension';
import { loadWindowState, MIN_HEIGHT, MIN_WIDTH, saveWindowState, type WindowState } from './window-state';

export const APP_NAME = "chihairou's Yungu (local)";
const SPLASH_DELAY_MS = 1_000;
/** The frontend's appearance cookie (`frontend/src/lib/appearance.ts`): auto | light | dark, a year. */
const APPEARANCE_COOKIE = 'yl_appearance';
const APPEARANCE_MAX_AGE = 60 * 60 * 24 * 365;
const STARTUP_TIMEOUT_MS = 30_000;
/** The startup sign-in's own timeouts are the server's; this only stops a silent server hanging the launch. */
const SIGN_IN_TIMEOUT_MS = 60_000;

// Development-only overrides (ignored in the packaged app): the smoke spec runs on the mock data source
// with its own profile directory.
const dev = !app.isPackaged;
if (dev && process.env.YUNGU_LOCAL_USER_DATA) app.setPath('userData', process.env.YUNGU_LOCAL_USER_DATA);
const dataSource = dev && process.env.YUNGU_LOCAL_DATA_SOURCE === 'mock' ? 'mock' : 'direct';
/** Stands in for a slow Yungu at the startup sign-in (the smoke spec checks the splash stays up). */
const signInDelayMs = dev ? Number(process.env.YUNGU_LOCAL_SIGN_IN_DELAY_MS) || 0 : 0;
/**
 * Stands in for saved credentials and a Yungu that cannot be reached at the first N startup sign-in
 * tries, then answers a sign-in (mock data source only: the smoke spec checks the retry).
 */
let fakeUnreachable = dev && dataSource === 'mock' ? Number(process.env.YUNGU_LOCAL_STARTUP_UNREACHABLE) || 0 : 0;
const fakeStartup = fakeUnreachable > 0;
/** The startup sign-in retry's interval (10 s; shorter in the smoke spec). */
const retryIntervalMs = (dev && Number(process.env.YUNGU_LOCAL_SIGN_IN_RETRY_MS)) || RETRY_INTERVAL_MS;

/** The per-launch lock: every request to the server must carry `yl_local=<secret>`. Never empty. */
const secret = randomBytes(32).toString('hex');

let win: BrowserWindow | null = null;
let server: UtilityProcess | null = null;
/** The running server's origin, `http://127.0.0.1:<port>`; empty until the first boot picks a port. */
let origin = '';
/** False while a boot is in progress: a server exit then is a failed start, not a crash. */
let running = false;
/** True from a boot's start until its app page (or the start-error page) is loaded: the splash's time. */
let starting = false;
let splashShown = false;
let quitting = false;
let store: CredentialStore;
/** Resolves the startup sign-in when its answer arrives. */
let pendingSignIn: ((m: SignInAnswer) => void) | null = null;
let settings: Settings;
let monitor: SuspensionMonitor;
/** Suspension Mode's current state (the monitor's last report). */
let suspension: SuspensionState = { suspended: false };
/** Downloads in progress, cancelled when a suspension starts. */
const downloads = new Set<DownloadItem>();
/**
 * The startup sign-in tried again (`retrySignIn`): it could not reach Yungu, or it was skipped because
 * the app started suspended. Stops once signed in (by itself or by the user), or on a restart.
 */
const retry = new SignInRetry({
  attempt: (current) => retrySignIn(current),
  blocked: () => suspension.suspended,
  intervalMs: retryIntervalMs,
});

type SignInAnswer = Extract<ServerMessage, { type: 'signed-in' | 'sign-in-failed' }>;
type StartupResult = SignInAnswer | { type: 'no-credentials' };

// ---------------------------------------------------------------------------------------------- paths

/** The standalone server: the frontend build in development, `resources/server` once packaged (Task 10). */
function standaloneServerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'server.js')
    : path.join(__dirname, '..', '..', 'frontend', '.next', 'standalone', 'server.js');
}

const userDataFile = (name: string) => path.join(app.getPath('userData'), name);
const splashFile = () => path.join(__dirname, 'splash.html');

// ---------------------------------------------------------------------------------------------- server

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

function startServer(port: number): UtilityProcess {
  const child = utilityProcess.fork(path.join(__dirname, 'server.js'), [standaloneServerPath()], {
    serviceName: `${APP_NAME} server`,
    stdio: 'inherit',
    env: {
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DATA_SOURCE: dataSource,
      YUNGU_LOCAL_SECRET: secret,
      YUNGU_LOCAL_STATE_DIR: app.getPath('userData'),
      NODE_ENV: 'production',
    },
  });
  child.once('spawn', () => {
    if (child === server) onServerReady(child);
  });
  child.on('message', (data: unknown) => {
    if (child === server) onServerMessage(parseServerMessage(data));
  });
  child.once('exit', () => {
    if (child !== server) return; // an old server we stopped on purpose
    server = null;
    pendingSignIn?.({ type: 'sign-in-failed', reason: 'unreachable' });
    if (!quitting && running) void serverStopped();
  });
  return child;
}

function stopServer(): void {
  const old = server;
  server = null;
  old?.kill();
}

function onServerMessage(m: ServerMessage | null): void {
  if (!m) return;
  switch (m.type) {
    case 'save-credentials':
      retry.stop(); // the user signed in themselves
      try {
        store.save({ loginId: m.loginId, password: m.password });
      } catch (e) {
        // The Keychain refused: this launch still works; the next one asks for the password again.
        console.warn(`Could not save the credentials (${errorName(e)}).`);
      }
      break;
    case 'forget-credentials':
      try {
        store.forget();
      } catch (e) {
        console.warn(`Could not forget the credentials (${errorName(e)}).`);
      }
      break;
    case 'signed-in':
    case 'sign-in-failed':
      pendingSignIn?.(m);
      break;
  }
}

/** Polls `GET /login` (with the lock cookie) until it answers 200; false on timeout or if the server exits. */
async function waitForServer(child: UtilityProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && server === child) {
    try {
      const res = await fetch(`${origin}/login`, {
        headers: { cookie: `${LOCAL_COOKIE}=${secret}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(2_000),
      });
      await res.body?.cancel();
      if (res.status === 200) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Signs in with the saved credentials, if any. The window loads nothing until this answers. */
async function startupSignIn(child: UtilityProcess): Promise<StartupResult> {
  if (signInDelayMs > 0) await new Promise((r) => setTimeout(r, signInDelayMs));
  return signInWithSaved(child);
}

function signInWithSaved(child: UtilityProcess): Promise<StartupResult> {
  if (fakeStartup) {
    if (fakeUnreachable > 0) {
      fakeUnreachable -= 1;
      return Promise.resolve({ type: 'sign-in-failed', reason: 'unreachable' });
    }
    return Promise.resolve({ type: 'signed-in', name: 'Test Student', token: 'dev-startup' });
  }
  // The bridge only exists in direct mode; the mock never answers.
  const saved = savedCredentials();
  if (!saved) return Promise.resolve({ type: 'no-credentials' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish({ type: 'sign-in-failed', reason: 'unreachable' }), SIGN_IN_TIMEOUT_MS);
    function finish(m: SignInAnswer) {
      clearTimeout(timer);
      pendingSignIn = null;
      resolve(m);
    }
    pendingSignIn = finish;
    child.postMessage({ type: 'credentials', loginId: saved.loginId, password: saved.password });
  });
}

/** The saved credentials to sign in with (direct mode only); null when there are none. Never throws. */
function savedCredentials(): Credentials | null {
  if (dataSource !== 'direct') return null;
  try {
    return store.load();
  } catch (e) {
    console.warn(`Could not read the saved credentials (${errorName(e)}).`);
    return null;
  }
}

const hasSaved = () => fakeStartup || savedCredentials() !== null;

/** The error's class name only: never its message, which may quote what failed. */
function errorName(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

// ---------------------------------------------------------------------------------------------- boot

let bootCount = 0;

/** Starts (or restarts) the server and opens the app in the window. */
async function boot(): Promise<void> {
  const thisBoot = ++bootCount;
  running = false;
  retry.stop();
  stopServer();
  const w = ensureWindow();

  // The splash stays up (after the first second) until the app page loads: through the server's start
  // and the startup sign-in, which waits on Yungu.
  starting = true;
  const splash = setTimeout(() => void showSplash(w), SPLASH_DELAY_MS);
  const endSplash = () => {
    clearTimeout(splash);
    if (thisBoot === bootCount) starting = false;
  };
  try {
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const child = startServer(port);
    server = child;
    const ready = await waitForServer(child, STARTUP_TIMEOUT_MS);
    if (thisBoot !== bootCount || w.isDestroyed()) return;
    if (!ready) {
      endSplash();
      stopServer();
      await showStartError(w);
      return;
    }

    const ses = session.defaultSession;
    await ses.cookies.set({ url: origin, name: LOCAL_COOKIE, value: secret, httpOnly: true, sameSite: 'strict', path: '/' });
    await setAppearanceCookie(ses);
    // With the switch on, a fresh Wi-Fi reading, so the server is suspended (or not) before it first
    // calls Yungu; with it off, nothing is read.
    await monitor.check();
    onServerReady(child);
    let result: StartupResult;
    let tryAgain = false;
    if (suspension.suspended && hasSaved()) {
      // Signing in now would only fail; it is retried once the suspension ends.
      tryAgain = true;
      result = { type: 'no-credentials' };
    } else {
      result = await startupSignIn(child);
      // Offline (the Wi-Fi not yet connected) or Yungu down: the sign-in page says so and keeps trying.
      tryAgain = result.type === 'sign-in-failed' && result.reason === 'unreachable';
    }
    endSplash();
    if (thisBoot !== bootCount || w.isDestroyed()) return;
    if (server !== child) {
      await showStartError(w); // it exited before the app opened
      return;
    }
    running = true;
    if (tryAgain) retry.start();
    await openApp(w, ses, result);
    // The suspension may have ended while the sign-in page was loading.
    if (tryAgain && !suspension.suspended && result.type === 'no-credentials') retry.now();
  } catch {
    if (thisBoot !== bootCount || w.isDestroyed()) return;
    endSplash();
    stopServer();
    await showStartError(w);
  } finally {
    endSplash();
  }
}

/** Every new server hears the current suspension (also after a Restart). */
function onServerReady(child: UtilityProcess): void {
  child.postMessage({ type: 'suspension', suspended: suspension.suspended });
}

/**
 * One more try of the startup sign-in (only while the window is still on the sign-in page: the user may
 * sign in by hand meanwhile). Signed in: opens Assignments. Unreachable again: the notice stays (renewed)
 * and the retry goes on. The password refused: the sign-in page with that notice.
 */
async function retrySignIn(current: () => boolean): Promise<RetryOutcome> {
  const child = server;
  const w = win;
  if (!running || !child || !w || w.isDestroyed() || !onSignInPage(w)) return 'done';
  const result = await signInWithSaved(child);
  if (!current() || server !== child || w.isDestroyed() || !onSignInPage(w)) return 'done';
  if (result.type === 'no-credentials') return 'done';
  if (result.type === 'sign-in-failed' && result.reason === 'unreachable') {
    await setNotice(session.defaultSession, NOTICE_UNREACHABLE);
    return 'retry';
  }
  await openApp(w, session.defaultSession, result);
  return 'done';
}

/**
 * The frontend's `yl_appearance` cookie, from the saved choice, so the first page is rendered in the
 * scheme the window already has (the settings are the source of truth; the page writes the same cookie).
 */
async function setAppearanceCookie(ses: Session): Promise<void> {
  await ses.cookies.set({
    url: origin,
    name: APPEARANCE_COOKIE,
    value: settings.get().appearance,
    sameSite: 'lax',
    path: '/',
    expirationDate: Date.now() / 1000 + APPEARANCE_MAX_AGE,
  });
}

async function setNotice(ses: Session, value: string): Promise<void> {
  await ses.cookies.set({
    url: origin,
    name: SIGN_IN_NOTICE_COOKIE,
    value,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expirationDate: Date.now() / 1000 + NOTICE_MAX_AGE,
  });
}

function onSignInPage(w: BrowserWindow): boolean {
  const url = w.webContents.getURL();
  return isAppUrl(url, origin) && new URL(url).pathname === '/login';
}

/** Loads the first page for the startup sign-in's result. Called only once that result is in. */
async function openApp(w: BrowserWindow, ses: Session, result: StartupResult): Promise<void> {
  const now = Date.now() / 1000;
  let page = '/login';
  if (result.type === 'signed-in') {
    await ses.cookies.set({
      url: origin,
      name: SESSION_COOKIE,
      value: encodeSession(result.name, result.token),
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expirationDate: now + SESSION_MAX_AGE,
    });
    await ses.cookies.remove(origin, SIGN_IN_NOTICE_COOKIE);
    page = '/assignments';
  } else {
    // A session left from an earlier launch would skip the sign-in page (and its notice).
    await ses.cookies.remove(origin, SESSION_COOKIE);
    if (result.type === 'sign-in-failed') {
      // Wrong password: sign in again. Unreachable: "trying again" while `retry` keeps at it.
      await setNotice(ses, result.reason === 'wrong-password' ? NOTICE_PASSWORD : NOTICE_UNREACHABLE);
    }
  }
  splashShown = false;
  await loadInto(w, () => w.loadURL(`${origin}${page}`));
}

async function loadInto(w: BrowserWindow, load: () => Promise<void>): Promise<void> {
  try {
    await load();
  } catch {
    // an aborted load (a newer one replaced it) is not an error to report
  }
  if (!w.isDestroyed() && !w.isVisible()) w.show();
}

/** Shows the splash while a boot is still starting (once; a no-op otherwise). */
async function showSplash(w: BrowserWindow): Promise<void> {
  if (w.isDestroyed() || !starting || splashShown) return;
  splashShown = true;
  await loadInto(w, () => w.loadFile(splashFile()));
}

async function showStartError(w: BrowserWindow): Promise<void> {
  splashShown = false;
  if (!w.isDestroyed()) await loadInto(w, () => w.loadFile(splashFile(), { hash: 'error' }));
}

/** The server exited while the app was in use. */
async function serverStopped(): Promise<void> {
  running = false;
  const options = {
    type: 'error' as const,
    message: `${APP_NAME} stopped unexpectedly.`,
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (response === 0) void boot();
  else app.quit();
}

// ---------------------------------------------------------------------------------------------- window

interface WindowOptions {
  state: WindowState;
  /** The main window's preload (`window.yunguLocal`); windows opened by pages get none. */
  preload?: string;
}

/** The one set of web preferences for every window; only the main app window gets a preload. */
function secureWebPreferences(preload?: string): Electron.WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    plugins: true, // the PDF viewer
    ...(preload ? { preload } : {}),
  };
}

function createWindow({ state, preload }: WindowOptions): BrowserWindow {
  const w = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: APP_NAME,
    show: false,
    // The app's surface for the scheme in use: no white flash before a page paints.
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    webPreferences: secureWebPreferences(preload),
  });
  if (state.maximized) w.maximize();
  // The page's own <title> would replace the app name.
  w.on('page-title-updated', (e) => e.preventDefault());
  w.on('close', () => {
    const b = w.getNormalBounds();
    saveWindowState(userDataFile('window-state.json'), { ...b, maximized: w.isMaximized() });
  });
  // The start-error page's Restart link (an in-page navigation to #restart).
  w.webContents.on('did-navigate-in-page', (_e, url) => {
    if (url.startsWith('file:') && new URL(url).hash === '#restart') void boot();
  });
  return w;
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  const screens = screen.getAllDisplays().map((d) => d.workArea);
  win = createWindow({
    state: loadWindowState(userDataFile('window-state.json'), screens),
    preload: path.join(__dirname, 'preload.js'),
  });
  win.on('closed', () => (win = null));
  return win;
}

/**
 * Every webContents (the window, and any window an app page opens) stays on the app's own pages, also
 * when an app address redirects elsewhere: a file link (`/api/files/<id>`) answers with a redirect to a
 * signed address on Yungu's file storage, which is downloaded instead (the Save dialog and Suspension
 * Mode's gate, as for any download); any other address goes to the browser (or nowhere). A window opened
 * only for that redirect ("Open in new tab") is closed again.
 */
function guardNavigation(contents: WebContents): void {
  let loaded = false; // a page ever committed in this webContents
  contents.on('did-navigate', () => (loaded = true));
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, origin)) return;
    event.preventDefault();
    openOutside(url);
  });
  contents.on('will-redirect', (event) => {
    if (!event.isMainFrame) return;
    const target = redirectTarget(event.url, origin);
    if (target === 'app') return;
    event.preventDefault();
    if (target === 'download') {
      // From the main window when there is one: it outlives a window closed below.
      const from = win && !win.isDestroyed() ? win.webContents : contents;
      from.downloadURL(event.url);
    } else {
      openOutside(event.url);
    }
    const w = BrowserWindow.fromWebContents(contents);
    if (!loaded && w && w !== win && !w.isDestroyed()) w.close();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url, origin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: APP_NAME,
          minWidth: MIN_WIDTH,
          minHeight: MIN_HEIGHT,
          webPreferences: secureWebPreferences(),
        },
      };
    }
    openOutside(url);
    return { action: 'deny' };
  });
}

function openOutside(url: string): void {
  if (externalTarget(url) === 'browser') void shell.openExternal(url).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------- session

/**
 * Downloads ask where to save; permissions as `permissionDecision` rules (app pages only). While
 * suspended, every request that would leave the app is cancelled, and so are downloads from outside.
 */
function setUpSession(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: suspension.suspended && blockedWhileSuspended(details.url, origin) });
  });
  ses.on('will-download', (_event, item) => {
    if (suspension.suspended && blockedWhileSuspended(item.getURL(), origin)) {
      item.cancel();
      return;
    }
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    downloads.add(item);
    item.once('done', () => downloads.delete(item));
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const decision = permissionDecision(permission, details.requestingUrl, mainFrameUrl(contents), origin);
    if (decision === 'media') {
      const types = 'mediaTypes' in details && details.mediaTypes ? details.mediaTypes : [];
      void mediaAccess(types).then(callback, () => callback(false));
      return;
    }
    callback(decision === 'allow');
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    return permissionDecision(permission, requestingOrigin, mainFrameUrl(contents), origin) !== 'deny';
  });
}

/** The page in the window that hosts `contents` (empty when there is none). */
function mainFrameUrl(contents: WebContents | null): string {
  if (!contents || contents.isDestroyed()) return '';
  return contents.mainFrame?.url ?? contents.getURL();
}

/** macOS asks the user once per device kind (System Settings remembers); elsewhere the OS has no such prompt. */
async function mediaAccess(types: ReadonlyArray<'video' | 'audio'>): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  for (const t of types) {
    const kind = t === 'video' ? 'camera' : 'microphone';
    const status = systemPreferences.getMediaAccessStatus(kind);
    if (status === 'granted') continue;
    if (status !== 'not-determined' || !(await systemPreferences.askForMediaAccess(kind))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------- suspension

/** What the page sees through `window.yunguLocal` (see preload.ts). */
interface LocalState extends SuspensionState {
  suspension: boolean;
  allowedNetworks: AllowedNetwork[];
}

function localState(): LocalState {
  const s = settings.get();
  return { suspension: s.suspension, allowedNetworks: s.allowedNetworks, ...suspension };
}

function pushState(): void {
  if (win && !win.isDestroyed()) win.webContents.send('yungu-local:state', localState());
}

function onSuspension(s: SuspensionState): void {
  const was = suspension.suspended;
  suspension = s;
  server?.postMessage({ type: 'suspension', suspended: s.suspended });
  if (s.suspended) {
    for (const d of downloads) if (blockedWhileSuspended(d.getURL(), origin)) d.cancel();
  } else if (was) {
    retry.now();
  }
  pushState();
}

/** The saved Appearance before the first window opens; the window's background then follows the scheme. */
function setUpAppearance(): void {
  nativeTheme.themeSource = themeSourceFor(settings.get().appearance);
  // Also when the system switches while the choice is Automatic.
  nativeTheme.on('updated', () => {
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors));
  });
}

function setUpSuspension(): void {
  // The system's networksetup / route / arp; stand-ins from YUNGU_NETWORK_COMMANDS only in development.
  const paths = commandPaths({ packaged: app.isPackaged, env: process.env });
  monitor = new SuspensionMonitor({ read: () => readNetwork(runCommand, paths), settings, onChange: onSuspension });
  monitor.start();
  // Readings happen only while the switch is on (`check()` reads nothing otherwise). Electron has no
  // network-change event: waking and unlocking read at once, the 3 s poll covers the rest. Going to
  // sleep or locking drops the last reading (suspended until a fresh one), so nothing goes out on the
  // network the Mac wakes up on before it has been read. Waking also retries a startup sign-in that could
  // not reach Yungu (the network may be back), once the reading says it may.
  const awake = () => void monitor.recheck().then(() => retry.now());
  powerMonitor.on('suspend', () => monitor.drop());
  powerMonitor.on('lock-screen', () => monitor.drop());
  powerMonitor.on('resume', awake);
  powerMonitor.on('unlock-screen', awake);

  /** Only the main window's app page may use the API. */
  const fromApp = (e: IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? '';
    if (!win || win.isDestroyed() || e.sender !== win.webContents || !isAppUrl(url, origin)) throw new Error('not allowed');
  };
  /** A setting changed: apply it at once and tell the page (switching on starts the polling, off stops it). */
  const changed = () => {
    monitor.sync();
    pushState();
  };
  ipcMain.handle('yungu-local:get-state', (e) => {
    fromApp(e);
    return localState();
  });
  ipcMain.handle('yungu-local:set-suspension', (e, on: unknown) => {
    fromApp(e);
    if (typeof on !== 'boolean') throw new Error('bad value');
    settings.setSuspension(on);
    changed();
  });
  // The Allowed networks dialog opening: one reading, so "Add current network" knows the router with the switch off.
  ipcMain.handle('yungu-local:read-network', async (e) => {
    fromApp(e);
    await monitor.readNow();
    return { mac: monitor.state().mac ?? null };
  });
  // The gear's Appearance: the window (and every page's prefers-color-scheme) follows it at once.
  ipcMain.handle('yungu-local:set-appearance', (e, value: unknown) => {
    fromApp(e);
    const appearance = parseAppearance(value);
    settings.setAppearance(appearance);
    nativeTheme.themeSource = themeSourceFor(appearance);
  });
  ipcMain.handle('yungu-local:set-allowed-networks', (e, list: unknown) => {
    fromApp(e);
    const ok = (n: unknown): n is AllowedNetwork => {
      if (!n || typeof n !== 'object' || Array.isArray(n)) return false;
      const { label, mac } = n as Record<string, unknown>;
      return typeof label === 'string' && label.length <= 200 && typeof mac === 'string' && mac.length <= 64;
    };
    if (!Array.isArray(list) || list.length > 200 || !list.every(ok)) throw new Error('bad value');
    settings.setAllowedNetworks(list.map(({ label, mac }) => ({ label, mac })));
    changed();
  });
}

// ---------------------------------------------------------------------------------------------- menu

function setUpMenu(): void {
  const appMenu: MenuItemConstructorOptions =
    process.platform === 'darwin' ? { role: 'appMenu' } : { label: APP_NAME, submenu: [{ role: 'quit' }] };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      appMenu,
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]),
  );
}

// ---------------------------------------------------------------------------------------------- app

/** safeStorage, except Linux's fallback "basic_text" backend (a fixed key: no better than plain text). */
const keychain: StringCrypto = {
  isEncryptionAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  encryptString: (s) => safeStorage.encryptString(s),
  decryptString: (b) => safeStorage.decryptString(b),
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    // Still starting (before the splash's first second): show the splash, never a blank window.
    if (starting) void showSplash(win);
    win.show();
    win.focus();
  });
  app.on('web-contents-created', (_event, contents) => guardNavigation(contents));
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    stopServer();
  });
  void app.whenReady().then(() => {
    store = new CredentialStore(userDataFile('credentials.bin'), keychain);
    settings = new Settings(userDataFile('settings.json'));
    setUpMenu();
    setUpAppearance();
    setUpSuspension();
    setUpSession(session.defaultSession);
    void boot();
  });
}
