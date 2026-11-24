/**
 * Suspension Mode: while the switch is on and the Mac is on a Wi-Fi whose name is not in the allowed
 * list (or a Wi-Fi whose name cannot be read), the app sends nothing to Yungu. No Wi-Fi at all is fine.
 */
import type { SettingsData } from './settings';
import type { WifiState } from './wifi';

export type SuspensionReason = 'not-allowed' | 'unknown';
export interface SuspensionState {
  suspended: boolean;
  reason?: SuspensionReason;
  /** The Wi-Fi's name, whenever the Mac is on a Wi-Fi whose name could be read. */
  ssid?: string;
}

export function isSuspended(settings: { get(): SettingsData }, wifi: WifiState): { suspended: boolean; reason?: SuspensionReason } {
  const { suspension, allowedWifi } = settings.get();
  if (!suspension || wifi.kind === 'none') return { suspended: false };
  if (wifi.kind === 'unknown') return { suspended: true, reason: 'unknown' };
  const ssid = wifi.ssid.trim();
  return allowedWifi.some((n) => n.trim() === ssid) ? { suspended: false } : { suspended: true, reason: 'not-allowed' };
}

function stateFor(settings: { get(): SettingsData }, wifi: WifiState): SuspensionState {
  const s: SuspensionState = isSuspended(settings, wifi);
  return wifi.kind === 'wifi' ? { ...s, ssid: wifi.ssid } : s;
}

const same = (a: SuspensionState | null, b: SuspensionState) =>
  a !== null && a.suspended === b.suspended && a.reason === b.reason && a.ssid === b.ssid;

export interface MonitorOptions {
  read: () => Promise<WifiState>;
  settings: { get(): SettingsData };
  onChange: (s: SuspensionState) => void;
  intervalMs?: number;
}

const FAIL_CLOSED: SuspensionState = { suspended: true, reason: 'unknown' };

/**
 * Reads the Wi-Fi only while the switch is on (macOS asks for Location access on the first reading, so
 * someone not using Suspension Mode is never asked): every `intervalMs` (3 s), on `check()` (boot) and
 * on `recheck()` (waking, unlocking: the last reading is dropped first, as on `drop()` at sleep/lock). `sync()` applies a settings change at once: switching on is suspended ("unknown")
 * until the first fresh reading lands (a reading from before is never reused); switching off stops the
 * polling. `readNow()` is the one reading made with the switch off, for the Allowed Wi-Fi dialog's
 * "Add current Wi-Fi". `onChange` hears the first state and then each change only; readings that come
 * back out of order, or from before the switch last changed, are dropped.
 */
export class SuspensionMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** The switch as last seen by `sync()`; null before the first. */
  private enabled: boolean | null = null;
  /** Bumped whenever the switch changes: readings started before are dropped. */
  private epoch = 0;
  /** The last reading made while the switch is on, since it was turned on. */
  private last: WifiState | null = null;
  /** The name from `readNow()` with the switch off. */
  private offSsid: string | undefined;
  private current: SuspensionState | null = null;
  private started = 0;
  private applied = 0;
  private readonly intervalMs: number;

  constructor(private readonly opts: MonitorOptions) {
    this.intervalMs = opts.intervalMs ?? 3_000;
  }

  /** The last state reported (not suspended before the first). */
  state(): SuspensionState {
    return this.current ?? { suspended: false };
  }

  start(): void {
    this.running = true;
    this.sync();
    if (this.enabled && !this.timer) this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  /** Applies the current settings now (no reading); starts or stops the polling as the switch changed. */
  sync(): void {
    const on = this.opts.settings.get().suspension;
    if (on !== this.enabled) {
      this.enabled = on;
      this.epoch += 1;
      this.last = null;
      this.clearTimer();
      if (on && this.running) this.schedule(0);
    }
    this.apply(this.evaluate());
  }

  /** A fresh reading, only while the switch is on. */
  async check(): Promise<void> {
    this.sync();
    if (this.enabled) await this.readInto();
  }

  /**
   * The Mac is going to sleep or locking (powerMonitor `suspend` / `lock-screen`): with the switch on,
   * the last reading is dropped, and so are readings already on their way, so the state is suspended
   * ("unknown") until a fresh reading lands. Nothing can then go out on a Wi-Fi the Mac woke up on before
   * that Wi-Fi has been read. A no-op with the switch off. The polling carries on.
   */
  drop(): void {
    this.sync();
    if (!this.enabled) return;
    this.last = null;
    this.applied = ++this.started; // readings started before this one are ignored when they land
    this.apply(this.evaluate());
  }

  /** Waking or unlocking (powerMonitor `resume` / `unlock-screen`): `drop()`, then a fresh reading. */
  async recheck(): Promise<void> {
    this.drop();
    await this.check();
  }

  /** One reading whatever the switch (the Allowed Wi-Fi dialog opening). */
  async readNow(): Promise<void> {
    this.sync();
    await this.readInto();
  }

  private async readInto(): Promise<void> {
    const n = ++this.started;
    const epoch = this.epoch;
    let wifi: WifiState;
    try {
      wifi = await this.opts.read();
    } catch {
      wifi = { kind: 'unknown' };
    }
    if (epoch !== this.epoch || n < this.applied) return; // the switch changed meanwhile, or a newer reading is in
    this.applied = n;
    if (this.enabled) this.last = wifi;
    else this.offSsid = wifi.kind === 'wifi' ? wifi.ssid : undefined;
    this.apply(this.evaluate());
  }

  private evaluate(): SuspensionState {
    if (!this.enabled) return this.offSsid ? { suspended: false, ssid: this.offSsid } : { suspended: false };
    return this.last ? stateFor(this.opts.settings, this.last) : FAIL_CLOSED;
  }

  private schedule(ms: number): void {
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      void this.check().finally(() => {
        if (this.running && this.epoch === epoch && this.enabled) this.schedule(this.intervalMs);
      });
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private apply(s: SuspensionState): void {
    if (same(this.current, s)) return;
    this.current = s;
    this.opts.onChange(s);
  }
}

/**
 * While suspended, the window may still load the app's own pages (and local schemes that go nowhere:
 * data:, blob: of the app, file: for the splash, the built-in PDF viewer, devtools); every request that
 * would leave the app is cancelled.
 */
export function blockedWhileSuspended(url: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }
  switch (u.protocol) {
    case 'data:':
    case 'file:':
    case 'devtools:':
    case 'chrome-extension:':
    case 'chrome:':
      return false;
    case 'blob:':
      return blockedWhileSuspended(url.slice('blob:'.length), origin);
    default:
      return !origin || u.origin !== new URL(origin).origin;
  }
}
