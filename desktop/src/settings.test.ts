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

describe('Settings', () => {
  it('defaults to off with no allowed Wi-Fi', () => {
    expect(new Settings(file).get()).toEqual({ suspension: false, allowedWifi: [], appearance: 'auto' });
  });

  it('keeps the switch and the list in the file', () => {
    const s = new Settings(file);
    s.setSuspension(true);
    s.setAllowedWifi(['School', 'Home']);
    s.setAppearance('dark');
    expect(new Settings(file).get()).toEqual({ suspension: true, allowedWifi: ['School', 'Home'], appearance: 'dark' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ suspension: true, allowedWifi: ['School', 'Home'], appearance: 'dark' });
  });

  it('trims names and drops empties and duplicates (case counts)', () => {
    const s = new Settings(file);
    s.setAllowedWifi(['  School ', '', '   ', 'School', 'school', 'Home\t']);
    expect(s.get().allowedWifi).toEqual(['School', 'school', 'Home']);
  });

  it('survives a corrupt or odd file', () => {
    for (const text of ['{nope', '[]', 'null', '{"suspension":"yes","allowedWifi":"School"}', '{"allowedWifi":[1, " A ", null]}']) {
      writeFileSync(file, text);
      const got = new Settings(file).get();
      expect(got.suspension, text).toBe(false);
      expect(Array.isArray(got.allowedWifi), text).toBe(true);
    }
    writeFileSync(file, '{"allowedWifi":[1, " A ", null], "suspension": true}');
    expect(new Settings(file).get()).toEqual({ suspension: true, allowedWifi: ['A'], appearance: 'auto' });
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
    s.get().allowedWifi.push('X');
    expect(s.get().allowedWifi).toEqual([]);
  });
});
