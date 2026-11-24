// @vitest-environment node
// The credentials bridge between the Next server (utilityProcess) and Electron's main process.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAccount } from './account';
import { connectBridge, type ParentPort } from './bridge';
import { LOGIN_ID, PASSWORD, World, fakeClientFactory } from './fake-yungu';
import { YunguError } from './http';

class FakePort implements ParentPort {
  sent: Record<string, unknown>[] = [];
  private handlers: ((e: { data: unknown }) => void)[] = [];
  postMessage(m: unknown) {
    this.sent.push(m as Record<string, unknown>);
  }
  on(_ev: 'message', cb: (e: { data: unknown }) => void) {
    this.handlers.push(cb);
  }
  receive(data: unknown) {
    for (const h of this.handlers) h({ data });
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));
let dir: string;
let world: World;
let port: FakePort;
let account: LocalAccount;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yl-bridge-'));
  world = new World();
  port = new FakePort();
  account = new LocalAccount({ fetch: vi.fn(), stateDir: dir, makeClient: fakeClientFactory(world) });
  connectBridge(port, account);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bridge', () => {
  it('startup credentials sign in and report signed-in with the token', async () => {
    port.receive({ type: 'credentials', loginId: LOGIN_ID, password: PASSWORD });
    await settle();
    expect(port.sent).toEqual([{ type: 'signed-in', name: 'Ada Example', token: account.token() }]);
    expect(account.token()).toBeTruthy();
  });

  it('wrong startup password reports wrong-password and asks to forget', async () => {
    port.receive({ type: 'credentials', loginId: LOGIN_ID, password: 'nope' });
    await settle();
    expect(port.sent).toEqual([{ type: 'sign-in-failed', reason: 'wrong-password' }, { type: 'forget-credentials' }]);
  });

  it('unreachable startup reports unreachable and keeps credentials', async () => {
    world.loginFail = new YunguError('network down');
    port.receive({ type: 'credentials', loginId: LOGIN_ID, password: PASSWORD });
    await settle();
    expect(port.sent).toEqual([{ type: 'sign-in-failed', reason: 'unreachable' }]);
  });

  it('user sign-in posts save-credentials', async () => {
    await account.signIn(LOGIN_ID, PASSWORD);
    expect(port.sent).toEqual([{ type: 'save-credentials', loginId: LOGIN_ID, password: PASSWORD }]);
  });

  it('startup sign-in does not echo save-credentials, but a later user sign-in does', async () => {
    port.receive({ type: 'credentials', loginId: LOGIN_ID, password: PASSWORD });
    await settle();
    expect(port.sent.map((m) => m.type)).toEqual(['signed-in']);
    await account.signIn(LOGIN_ID, PASSWORD);
    expect(port.sent.map((m) => m.type)).toEqual(['signed-in', 'save-credentials']);
  });

  it('sign-out posts forget-credentials', async () => {
    await account.signIn(LOGIN_ID, PASSWORD);
    port.sent = [];
    account.signOut();
    expect(port.sent).toEqual([{ type: 'forget-credentials' }]);
  });

  it('ignores malformed messages', async () => {
    port.receive({ type: 'credentials', loginId: 1 });
    port.receive(null);
    port.receive({ type: 'other' });
    await settle();
    expect(port.sent).toEqual([]);
  });

  it('is idempotent per port, and does nothing without a port', async () => {
    connectBridge(port, account);
    await account.signIn(LOGIN_ID, PASSWORD);
    expect(port.sent).toHaveLength(1);
    expect(() => connectBridge(undefined, account)).not.toThrow();
  });
});
