import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './settings';
import { blockedWhileSuspended, isSuspended, SuspensionMonitor } from './suspension';
import type { NetworkState } from './network';

let dir: string;
let settings: Settings;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yl-susp-'));
  settings = new Settings(join(dir, 'settings.json'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

// Routers by MAC: the owner's school router, a café's, a home one.
const SCHOOL = '80:05:88:d0:83:e2';
const CAFE = 'cc:cc:cc:00:00:01';
const HOME = 'aa:aa:aa:00:00:01';
const net = (mac: string): NetworkState => ({ kind: 'network', mac });
const allow = (...macs: string[]) => settings.setAllowedNetworks(macs.map((mac, i) => ({ label: `Net ${i}`, mac })));

describe('isSuspended', () => {
  it('is never suspended with the switch off', () => {
    for (const w of [net(CAFE), { kind: 'unknown' } as const, { kind: 'none' } as const]) {
      expect(isSuspended(settings, w)).toEqual({ suspended: false });
    }
  });

  it('with the switch on: no network and an allowed router are fine, another router or an unknown one is suspended', () => {
    settings.setSuspension(true);
    allow(SCHOOL);
    expect(isSuspended(settings, { kind: 'none' })).toEqual({ suspended: false });
    expect(isSuspended(settings, net(SCHOOL))).toEqual({ suspended: false });
    expect(isSuspended(settings, net(CAFE))).toEqual({ suspended: true, reason: 'not-allowed' });
    expect(isSuspended(settings, { kind: 'unknown' })).toEqual({ suspended: true, reason: 'unknown' });
  });

  it('with nothing allowed, every router is suspended', () => {
    settings.setSuspension(true);
    expect(isSuspended(settings, net(SCHOOL))).toEqual({ suspended: true, reason: 'not-allowed' });
    expect(isSuspended(settings, { kind: 'none' })).toEqual({ suspended: false });
  });

  it('compares MACs however they are written', () => {
    settings.setSuspension(true);
    allow('80:5:88:D0:83:E2');
    expect(isSuspended(settings, net('80:05:88:d0:83:e2'))).toEqual({ suspended: false });
    // An object that slipped past Settings' normalising still matches after normalising.
    const raw = { get: () => ({ suspension: true, allowedNetworks: [{ label: 'S', mac: '80:5:88:D0:83:E2' }], appearance: 'auto' as const }) };
    expect(isSuspended(raw, net('80:05:88:d0:83:e2'))).toEqual({ suspended: false });
    expect(isSuspended(raw, net('80:5:88:d0:83:e2'))).toEqual({ suspended: false });
  });
});

describe('SuspensionMonitor', () => {
  function setUp(reads: Array<NetworkState | Promise<NetworkState>>) {
    const read = vi.fn(async () => reads.shift() ?? { kind: 'none' as const });
    const onChange = vi.fn();
    const monitor = new SuspensionMonitor({ read, settings, onChange });
    return { read, onChange, monitor, states: () => onChange.mock.calls.map((c) => c[0]) };
  }

  it('never reads the network while the switch is off: not on start, timers, check() or settings edits', async () => {
    vi.useFakeTimers();
    const { read, monitor, states } = setUp([]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await monitor.check(); // boot, resume, unlock-screen
    allow(SCHOOL);
    monitor.sync();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).not.toHaveBeenCalled();
    expect(states()).toEqual([{ suspended: false }]);
    monitor.stop();
  });

  it('switching on suspends at once (unknown) until the first reading, then polls every 3 s; off stops the polling', async () => {
    vi.useFakeTimers();
    allow(SCHOOL);
    let answer!: (w: NetworkState) => void;
    const { read, monitor, states } = setUp([new Promise((r) => (answer = r)), net(SCHOOL), net(CAFE)]);
    monitor.start();
    settings.setSuspension(true);
    monitor.sync();
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' }); // before any reading lands
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    answer(net(SCHOOL));
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: false, mac: SCHOOL });
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(states()).toEqual([
      { suspended: false },
      { suspended: true, reason: 'unknown' },
      { suspended: false, mac: SCHOOL },
      { suspended: true, reason: 'not-allowed', mac: CAFE },
    ]);

    settings.setSuspension(false);
    monitor.sync();
    expect(monitor.state()).toEqual({ suspended: false });
    const calls = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(calls);
  });

  it('never reuses a reading from before the switch was last turned on', async () => {
    vi.useFakeTimers();
    allow(SCHOOL);
    const { monitor } = setUp([net(SCHOOL), new Promise(() => undefined) as Promise<NetworkState>]);
    settings.setSuspension(true);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: false, mac: SCHOOL });
    settings.setSuspension(false);
    monitor.sync();
    settings.setSuspension(true);
    monitor.sync();
    await vi.advanceTimersByTimeAsync(10_000); // the new reading never answers
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' });
    monitor.stop();
  });

  it('a list edit while on re-applies the current reading without another read', async () => {
    settings.setSuspension(true);
    const { read, monitor } = setUp([net(CAFE)]);
    await monitor.check();
    expect(monitor.state()).toEqual({ suspended: true, reason: 'not-allowed', mac: CAFE });
    allow(CAFE);
    monitor.sync();
    expect(monitor.state()).toEqual({ suspended: false, mac: CAFE });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('readNow() reads exactly once, also with the switch off, and keeps the name for "Add current network"', async () => {
    const { read, monitor } = setUp([net(HOME)]);
    await monitor.readNow();
    expect(read).toHaveBeenCalledTimes(1);
    expect(monitor.state()).toEqual({ suspended: false, mac: HOME });
    allow(SCHOOL);
    monitor.sync();
    await monitor.check();
    expect(monitor.state()).toEqual({ suspended: false, mac: HOME });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reports only changes', async () => {
    settings.setSuspension(true);
    const { monitor, states } = setUp([net(CAFE), net(CAFE), net(CAFE)]);
    for (let i = 0; i < 3; i++) await monitor.check();
    expect(states()).toEqual([{ suspended: true, reason: 'unknown' }, { suspended: true, reason: 'not-allowed', mac: CAFE }]);
  });

  it('ignores a reading that finished after a newer one, or after the switch went off', async () => {
    settings.setSuspension(true);
    let slow!: (w: NetworkState) => void;
    const reads: Array<Promise<NetworkState>> = [new Promise((r) => (slow = r)), Promise.resolve({ kind: 'none' })];
    const onChange = vi.fn();
    const monitor = new SuspensionMonitor({ read: () => reads.shift()!, settings, onChange });
    const first = monitor.check();
    await monitor.check();
    slow(net(CAFE));
    await first;
    expect(monitor.state()).toEqual({ suspended: false });

    let late!: (w: NetworkState) => void;
    reads.push(new Promise((r) => (late = r)));
    const third = monitor.check();
    settings.setSuspension(false);
    monitor.sync();
    late(net(CAFE));
    await third;
    expect(monitor.state()).toEqual({ suspended: false });
  });

  it('sleep or lock drops the last reading (suspended, unknown) and drops readings already on their way', async () => {
    vi.useFakeTimers();
    settings.setSuspension(true);
    allow(SCHOOL);
    let stale!: (w: NetworkState) => void;
    const { monitor } = setUp([net(SCHOOL), new Promise((r) => (stale = r)), net(SCHOOL)]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: false, mac: SCHOOL });
    await vi.advanceTimersByTimeAsync(3_000); // a poll reading starts and is still on its way
    monitor.drop(); // powerMonitor 'suspend' / 'lock-screen'
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' });
    stale(net(SCHOOL)); // taken before the sleep: not trusted
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' });
    // The polling carries on and a fresh reading ends it.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(monitor.state()).toEqual({ suspended: false, mac: SCHOOL });
    monitor.stop();
  });

  it('a wake or unlock (recheck) is suspended (unknown) until its own fresh reading lands', async () => {
    settings.setSuspension(true);
    allow(SCHOOL);
    let fresh!: (w: NetworkState) => void;
    const { monitor, states } = setUp([net(SCHOOL), new Promise((r) => (fresh = r))]);
    await monitor.check();
    expect(monitor.state()).toEqual({ suspended: false, mac: SCHOOL });
    const woke = monitor.recheck(); // powerMonitor 'resume' / 'unlock-screen'
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' }); // before the reading answers
    fresh(net(CAFE));
    await woke;
    expect(states().slice(-2)).toEqual([
      { suspended: true, reason: 'unknown' },
      { suspended: true, reason: 'not-allowed', mac: CAFE },
    ]);
  });

  it('drop() and recheck() change nothing with the switch off', async () => {
    const { read, monitor, states } = setUp([]);
    monitor.start();
    monitor.drop();
    await monitor.recheck();
    expect(read).not.toHaveBeenCalled();
    expect(states()).toEqual([{ suspended: false }]);
    monitor.stop();
  });
});

describe('blockedWhileSuspended', () => {
  const origin = 'http://127.0.0.1:4321';
  it('lets the app itself and local schemes through', () => {
    for (const url of [`${origin}/assignments`, `${origin}/_next/static/x.js`, 'data:image/png;base64,AA', `blob:${origin}/123`, 'file:///app/splash.html', 'devtools://devtools/x', 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html']) {
      expect(blockedWhileSuspended(url, origin), url).toBe(false);
    }
  });

  it('blocks everything that leaves the app', () => {
    for (const url of ['https://task.yungu.org/api', 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/a.pdf', 'http://127.0.0.1:9999/', 'ws://example.com/', 'wss://task.yungu.org/', 'http://localhost:4321/', 'blob:https://example.com/1', 'ftp://x/']) {
      expect(blockedWhileSuspended(url, origin), url).toBe(true);
    }
  });
});
