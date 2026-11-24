import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Settings } from './settings';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yl-settings-'));
  file = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SCHOOL = { label: 'School', mac: '80:05:88:d0:83:e2' };
const HOME = { label: 'Home', mac: 'aa:bb:cc:dd:ee:01' };

describe('Settings', () => {
  it('defaults to off with no allowed network', () => {
    expect(new Settings(file).get()).toEqual({ suspension: false, allowedNetworks: [], appearance: 'auto' });
  });

  it('keeps the switch and the list in the file', () => {
    const s = new Settings(file);
    s.setSuspension(true);
    s.setAllowedNetworks([SCHOOL, HOME]);
    s.setAppearance('dark');
    const want = { suspension: true, allowedNetworks: [SCHOOL, HOME], appearance: 'dark' };
    expect(new Settings(file).get()).toEqual(want);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(want);
  });

  it('trims labels, normalises MACs and drops empties, bad MACs and repeated routers', () => {
    const s = new Settings(file);
    s.setAllowedNetworks([
      { label: '  School ', mac: '80:5:88:D0:83:E2' },
      { label: '   ', mac: 'aa:bb:cc:dd:ee:02' },
      { label: 'Bad', mac: 'not-a-mac' },
      { label: 'School again', mac: '80:05:88:d0:83:e2' },
      { label: 'Home\t', mac: 'aa:bb:cc:dd:ee:01' },
    ]);
    expect(s.get().allowedNetworks).toEqual([SCHOOL, HOME]);
  });

  it('drops the old allowedWifi names on load (and from the file at the next save)', () => {
    writeFileSync(file, JSON.stringify({ suspension: true, allowedWifi: ['School', 'Home'], appearance: 'light' }));
    const s = new Settings(file);
    expect(s.get()).toEqual({ suspension: true, allowedNetworks: [], appearance: 'light' });
    s.setSuspension(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ suspension: false, allowedNetworks: [], appearance: 'light' });
  });

  it('survives a corrupt or odd file', () => {
    for (const text of ['{nope', '[]', 'null', '{"suspension":"yes","allowedNetworks":"School"}', '{"allowedNetworks":[1, "A", null, {"label": 2}]}']) {
      writeFileSync(file, text);
      const got = new Settings(file).get();
      expect(got.suspension, text).toBe(false);
      expect(got.allowedNetworks, text).toEqual([]);
    }
    writeFileSync(file, JSON.stringify({ allowedNetworks: [1, { label: ' A ', mac: '1:2:3:4:5:6' }, null], suspension: true }));
    expect(new Settings(file).get()).toEqual({ suspension: true, allowedNetworks: [{ label: 'A', mac: '01:02:03:04:05:06' }], appearance: 'auto' });
  });

  it('keeps only auto, light or dark as the appearance (anything else reads as auto)', () => {
    for (const a of ['light', 'dark', 'auto']) {
      writeFileSync(file, JSON.stringify({ appearance: a }));
      expect(new Settings(file).get().appearance).toBe(a);
    }
    for (const a of ['Dark', 'system', '', 1, null, ['dark']]) {
      writeFileSync(file, JSON.stringify({ appearance: a }));
      expect(new Settings(file).get().appearance, String(a)).toBe('auto');
    }
    const s = new Settings(file);
    s.setAppearance('light');
    expect(() => s.setAppearance('system' as never)).toThrow();
    expect(s.get().appearance).toBe('light');
  });

  it('hands out copies', () => {
    const s = new Settings(file);
    s.setAllowedNetworks([SCHOOL]);
    s.get().allowedNetworks.push(HOME);
    s.get().allowedNetworks[0].label = 'X';
    expect(s.get().allowedNetworks).toEqual([SCHOOL]);
  });
});
