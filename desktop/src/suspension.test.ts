import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './settings';
import { blockedWhileSuspended, isSuspended, SuspensionMonitor } from './suspension';
import type { WifiState } from './wifi';

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

const wifi = (ssid: string): WifiState => ({ kind: 'wifi', ssid });

describe('isSuspended', () => {
  it('is never suspended with the switch off', () => {
    for (const w of [wifi('Cafe'), { kind: 'unknown' } as const, { kind: 'none' } as const]) {
      expect(isSuspended(settings, w)).toEqual({ suspended: false });
    }
  });

  it('with the switch on: no Wi-Fi and allowed Wi-Fi are fine, anything else is suspended', () => {
    settings.setSuspension(true);
    settings.setAllowedWifi(['School']);
    expect(isSuspended(settings, { kind: 'none' })).toEqual({ suspended: false });
    expect(isSuspended(settings, wifi('School'))).toEqual({ suspended: false });
    expect(isSuspended(settings, wifi('Cafe'))).toEqual({ suspended: true, reason: 'not-allowed' });
    expect(isSuspended(settings, { kind: 'unknown' })).toEqual({ suspended: true, reason: 'unknown' });
    expect(isSuspended(settings, wifi('school'))).toEqual({ suspended: true, reason: 'not-allowed' }); // case counts
  });

  it('matches names typed with spaces around them', () => {
    settings.setSuspension(true);
    settings.setAllowedWifi(['  School  ']);
    expect(isSuspended(settings, wifi('School'))).toEqual({ suspended: false });
    // An object that slipped past Settings' trimming still matches after trimming.
    expect(isSuspended({ get: () => ({ suspension: true, allowedWifi: [' School '] }) }, wifi('School'))).toEqual({ suspended: false });
  });
});

describe('SuspensionMonitor', () => {
  function setUp(reads: Array<WifiState | Promise<WifiState>>) {
    const read = vi.fn(async () => reads.shift() ?? { kind: 'none' as const });
    const onChange = vi.fn();
    const monitor = new SuspensionMonitor({ read, settings, onChange });
    return { read, onChange, monitor, states: () => onChange.mock.calls.map((c) => c[0]) };
  }

  it('never reads the Wi-Fi while the switch is off: not on start, timers, check() or settings edits', async () => {
    vi.useFakeTimers();
    const { read, monitor, states } = setUp([]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await monitor.check(); // boot, resume, unlock-screen
    settings.setAllowedWifi(['School']);
    monitor.sync();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).not.toHaveBeenCalled();
    expect(states()).toEqual([{ suspended: false }]);
    monitor.stop();
  });

  it('switching on suspends at once (unknown) until the first reading, then polls every 3 s; off stops the polling', async () => {
    vi.useFakeTimers();
    settings.setAllowedWifi(['School']);
    let answer!: (w: WifiState) => void;
    const { read, monitor, states } = setUp([new Promise((r) => (answer = r)), wifi('School'), wifi('Cafe')]);
    monitor.start();
    settings.setSuspension(true);
    monitor.sync();
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' }); // before any reading lands
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    answer(wifi('School'));
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'School' });
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(states()).toEqual([
      { suspended: false },
      { suspended: true, reason: 'unknown' },
      { suspended: false, ssid: 'School' },
      { suspended: true, reason: 'not-allowed', ssid: 'Cafe' },
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
    settings.setAllowedWifi(['School']);
    const { monitor } = setUp([wifi('School'), new Promise(() => undefined) as Promise<WifiState>]);
    settings.setSuspension(true);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'School' });
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
    const { read, monitor } = setUp([wifi('Cafe')]);
    await monitor.check();
    expect(monitor.state()).toEqual({ suspended: true, reason: 'not-allowed', ssid: 'Cafe' });
    settings.setAllowedWifi(['Cafe']);
    monitor.sync();
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'Cafe' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('readNow() reads exactly once, also with the switch off, and keeps the name for "Add current Wi-Fi"', async () => {
    const { read, monitor } = setUp([wifi('Home')]);
    await monitor.readNow();
    expect(read).toHaveBeenCalledTimes(1);
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'Home' });
    settings.setAllowedWifi(['School']);
    monitor.sync();
    await monitor.check();
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'Home' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reports only changes', async () => {
    settings.setSuspension(true);
    const { monitor, states } = setUp([wifi('Cafe'), wifi('Cafe'), wifi('Cafe')]);
    for (let i = 0; i < 3; i++) await monitor.check();
    expect(states()).toEqual([{ suspended: true, reason: 'unknown' }, { suspended: true, reason: 'not-allowed', ssid: 'Cafe' }]);
  });

  it('ignores a reading that finished after a newer one, or after the switch went off', async () => {
    settings.setSuspension(true);
    let slow!: (w: WifiState) => void;
    const reads: Array<Promise<WifiState>> = [new Promise((r) => (slow = r)), Promise.resolve({ kind: 'none' })];
    const onChange = vi.fn();
    const monitor = new SuspensionMonitor({ read: () => reads.shift()!, settings, onChange });
    const first = monitor.check();
    await monitor.check();
    slow(wifi('Cafe'));
    await first;
    expect(monitor.state()).toEqual({ suspended: false });

    let late!: (w: WifiState) => void;
    reads.push(new Promise((r) => (late = r)));
    const third = monitor.check();
    settings.setSuspension(false);
    monitor.sync();
    late(wifi('Cafe'));
    await third;
    expect(monitor.state()).toEqual({ suspended: false });
  });

  it('sleep or lock drops the last reading (suspended, unknown) and drops readings already on their way', async () => {
    vi.useFakeTimers();
    settings.setSuspension(true);
    settings.setAllowedWifi(['School']);
    let stale!: (w: WifiState) => void;
    const { monitor } = setUp([wifi('School'), new Promise((r) => (stale = r)), wifi('School')]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'School' });
    await vi.advanceTimersByTimeAsync(3_000); // a poll reading starts and is still on its way
    monitor.drop(); // powerMonitor 'suspend' / 'lock-screen'
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' });
    stale(wifi('School')); // taken before the sleep: not trusted
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' });
    // The polling carries on and a fresh reading ends it.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'School' });
    monitor.stop();
  });

  it('a wake or unlock (recheck) is suspended (unknown) until its own fresh reading lands', async () => {
    settings.setSuspension(true);
    settings.setAllowedWifi(['School']);
    let fresh!: (w: WifiState) => void;
    const { monitor, states } = setUp([wifi('School'), new Promise((r) => (fresh = r))]);
    await monitor.check();
    expect(monitor.state()).toEqual({ suspended: false, ssid: 'School' });
    const woke = monitor.recheck(); // powerMonitor 'resume' / 'unlock-screen'
    expect(monitor.state()).toEqual({ suspended: true, reason: 'unknown' }); // before the reading answers
    fresh(wifi('Cafe'));
    await woke;
    expect(states().slice(-2)).toEqual([
      { suspended: true, reason: 'unknown' },
      { suspended: true, reason: 'not-allowed', ssid: 'Cafe' },
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
