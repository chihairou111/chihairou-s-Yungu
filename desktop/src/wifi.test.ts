import { afterEach, describe, expect, it, vi } from 'vitest';
import { helperPath, parseHelperOutput, readWifi, WIFI_TIMEOUT_MS } from './wifi';

describe('parseHelperOutput', () => {
  it('reads the three answers', () => {
    expect(parseHelperOutput('SSID:School\n')).toEqual({ kind: 'wifi', ssid: 'School' });
    expect(parseHelperOutput('SSID:My Home 5G')).toEqual({ kind: 'wifi', ssid: 'My Home 5G' });
    expect(parseHelperOutput('NONE\n')).toEqual({ kind: 'none' });
    expect(parseHelperOutput('UNKNOWN\n')).toEqual({ kind: 'unknown' });
  });

  it('takes anything else as unknown', () => {
    for (const out of ['', '\n', 'SSID:', 'SSID:\n', 'none', 'NONE\nNONE\n', 'SSID:A\nSSID:B\n', 'hello', 'Error: no permission']) {
      expect(parseHelperOutput(out), JSON.stringify(out)).toEqual({ kind: 'unknown' });
    }
  });
});

describe('readWifi', () => {
  afterEach(() => vi.useRealTimers());

  it('runs the helper and parses its output', async () => {
    const run = vi.fn(async () => 'SSID:School\n');
    await expect(readWifi(run, '/x/wifi-ssid')).resolves.toEqual({ kind: 'wifi', ssid: 'School' });
    expect(run).toHaveBeenCalledWith('/x/wifi-ssid');
    await expect(readWifi(async () => 'NONE\n', '/x')).resolves.toEqual({ kind: 'none' });
  });

  it('maps an error, garbage or a missing helper to unknown', async () => {
    await expect(readWifi(async () => Promise.reject(new Error('ENOENT')), '/x')).resolves.toEqual({ kind: 'unknown' });
    await expect(readWifi(async () => 'garbage', '/x')).resolves.toEqual({ kind: 'unknown' });
    const run = vi.fn(async () => 'NONE');
    await expect(readWifi(run, '')).resolves.toEqual({ kind: 'unknown' });
    expect(run).not.toHaveBeenCalled();
  });

  it('gives up after 2 s', async () => {
    vi.useFakeTimers();
    expect(WIFI_TIMEOUT_MS).toBe(2_000);
    const read = readWifi(() => new Promise<string>(() => undefined), '/x');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(read).resolves.toEqual({ kind: 'unknown' });
  });
});

describe('helperPath', () => {
  it('is the bundled helper once packaged, whatever the environment says', () => {
    expect(helperPath({ packaged: true, resourcesPath: '/App/Resources', env: { YUNGU_WIFI_HELPER: '/tmp/fake' } })).toBe(
      '/App/Resources/bin/wifi-ssid',
    );
  });

  it('takes YUNGU_WIFI_HELPER in development', () => {
    expect(helperPath({ packaged: false, resourcesPath: '/r', env: { YUNGU_WIFI_HELPER: '/tmp/fake' } })).toBe('/tmp/fake');
    expect(helperPath({ packaged: false, resourcesPath: '/r', env: {} })).toBe('/r/bin/wifi-ssid');
  });
});
