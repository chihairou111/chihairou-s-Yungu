import { SignInRefused, type Credentials, type LocalAccount } from './account';

/**
 * The channel between the Next server (an Electron utilityProcess) and Electron's main process, which
 * owns the Keychain. `process.parentPort` is that channel; it is absent in dev and tests, where nothing
 * is persisted. In: `{type:'credentials', loginId, password}` (saved ones, at startup). Out: `signed-in`,
 * `sign-in-failed`, `save-credentials` (a user sign-in through the page), `forget-credentials`.
 */
export type ParentPort = {
  postMessage(m: unknown): void;
  on(ev: 'message', cb: (e: { data: unknown }) => void): void;
};

const connected = new WeakSet<ParentPort>();

export function connectBridge(port: ParentPort | undefined, account: LocalAccount): void {
  if (!port || connected.has(port)) return;
  connected.add(port);

  let startup: Credentials | null = null; // the saved credentials being signed in right now
  account.onCredentials = (c) => {
    if (c === null) return port.postMessage({ type: 'forget-credentials' });
    // Already in the keychain: only a user's own sign-in is saved.
    if (startup && c.loginId === startup.loginId && c.password === startup.password) return;
    port.postMessage({ type: 'save-credentials', loginId: c.loginId, password: c.password });
  };

  port.on('message', (e) => {
    const m = e.data as { type?: unknown; loginId?: unknown; password?: unknown } | null;
    if (!m || m.type !== 'credentials' || typeof m.loginId !== 'string' || typeof m.password !== 'string') return;
    void startupSignIn(port, account, { loginId: m.loginId, password: m.password }, (c) => (startup = c));
  });
}

async function startupSignIn(
  port: ParentPort,
  account: LocalAccount,
  creds: Credentials,
  mark: (c: Credentials | null) => void,
): Promise<void> {
  mark(creds);
  try {
    const { name, token } = await account.signIn(creds.loginId, creds.password);
    port.postMessage({ type: 'signed-in', name, token });
  } catch (e) {
    if (e instanceof SignInRefused) {
      port.postMessage({ type: 'sign-in-failed', reason: 'wrong-password' });
      port.postMessage({ type: 'forget-credentials' });
    } else {
      port.postMessage({ type: 'sign-in-failed', reason: 'unreachable' }); // keep them: Yungu may just be down
    }
  } finally {
    mark(null);
  }
}
