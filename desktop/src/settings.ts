/**
 * The app's own settings (Suspension Mode's switch, its allowed networks and the appearance), in
 * `<userData>/settings.json`. A missing, corrupt or odd file reads as the defaults. v1's `allowedWifi`
 * (Wi-Fi names) is dropped on load: networks are now recognised by their router.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isAppearance, type Appearance } from './appearance';
import { normaliseMac } from './network';

/** An allowed network: its router's MAC (normalised) and the label the owner gave it. */
export interface AllowedNetwork {
  label: string;
  mac: string;
}

export const LABEL_MAX = 64;

export interface SettingsData {
  suspension: boolean;
  allowedNetworks: AllowedNetwork[];
  /** The gear's Appearance choice; `auto` follows the system. */
  appearance: Appearance;
}

/** Labels trimmed (and capped); MACs normalised; entries without a label or a valid MAC, and repeated routers, dropped. */
export function cleanNetworks(list: unknown[]): AllowedNetwork[] {
  const out: AllowedNetwork[] = [];
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    const { label, mac } = n as Record<string, unknown>;
    if (typeof label !== 'string' || typeof mac !== 'string') continue;
    const l = label.trim().slice(0, LABEL_MAX);
    const m = normaliseMac(mac);
    if (l && m && !out.some((x) => x.mac === m)) out.push({ label: l, mac: m });
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
      return {
        suspension: r.suspension === true,
        allowedNetworks: Array.isArray(r.allowedNetworks) ? cleanNetworks(r.allowedNetworks) : [],
        appearance: isAppearance(r.appearance) ? r.appearance : 'auto',
      };
    } catch {
      return { suspension: false, allowedNetworks: [], appearance: 'auto' };
    }
  }

  get(): SettingsData {
    return {
      suspension: this.data.suspension,
      allowedNetworks: this.data.allowedNetworks.map((n) => ({ ...n })),
      appearance: this.data.appearance,
    };
  }

  setSuspension(on: boolean): void {
    this.data = { ...this.data, suspension: on === true };
    this.save();
  }

  setAllowedNetworks(list: AllowedNetwork[]): void {
    this.data = { ...this.data, allowedNetworks: cleanNetworks(list) };
    this.save();
  }

  setAppearance(appearance: Appearance): void {
    if (!isAppearance(appearance)) throw new Error('bad value');
    this.data = { ...this.data, appearance };
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
