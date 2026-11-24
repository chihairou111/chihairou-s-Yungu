/**
 * The app's own settings (Suspension Mode's switch and the allowed Wi-Fi names), in
 * `<userData>/settings.json`. A missing, corrupt or odd file reads as the defaults.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface SettingsData {
  suspension: boolean;
  allowedWifi: string[];
}

/** Trimmed, without empties or repeats (names compare exactly: case counts). */
export function cleanNames(names: unknown[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const t = n.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export class Settings {
  private data: SettingsData;

  constructor(private readonly file: string) {
    this.data = Settings.load(file);
  }

  private static load(file: string): SettingsData {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
      const r = raw as Record<string, unknown>;
      return { suspension: r.suspension === true, allowedWifi: Array.isArray(r.allowedWifi) ? cleanNames(r.allowedWifi) : [] };
    } catch {
      return { suspension: false, allowedWifi: [] };
    }
  }

  get(): SettingsData {
    return { suspension: this.data.suspension, allowedWifi: [...this.data.allowedWifi] };
  }

  setSuspension(on: boolean): void {
    this.data = { ...this.data, suspension: on === true };
    this.save();
  }

  setAllowedWifi(names: string[]): void {
    this.data = { ...this.data, allowedWifi: cleanNames(names) };
    this.save();
  }

  /** Written whole to a temporary file, then moved over the old one: never half a file. */
  private save(): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // A settings file that cannot be written: the change still holds until the app quits.
    }
  }
}
