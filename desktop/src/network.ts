/**
 * Which network the Mac is on, for Suspension Mode, recognised by its router: the hardware (MAC) address
 * of the Wi-Fi interface's default gateway. Reading it needs no permission (the Wi-Fi's name needs
 * Location access since macOS 14.4, which an unsigned app never gets asked for). Three system commands,
 * run without a shell:
 *
 * 1. `networksetup -listallhardwareports`: the `Device:` after `Hardware Port: Wi-Fi` (e.g. `en0`).
 * 2. `route -n get -ifscope <device> default`: its `gateway:`. Scoped to the Wi-Fi device, so a proxy in
 *    TUN mode (whose utun interface holds the unscoped default route) does not hide the router.
 * 3. `arp -n <gateway>`: `? (10.0.160.1) at 80:5:88:d0:83:e2 on en0 ifscope [ethernet]`.
 *
 * No Wi-Fi device, or no gateway on it (Wi-Fi off, not joined) → `none`. Anything else that does not end
 * in a MAC on that device (an `(incomplete)` entry, an error, no answer within 2 s in all) → `unknown`,
 * which Suspension Mode treats as a network that is not allowed.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

export type NetworkState = { kind: 'none' } | { kind: 'network'; mac: string } | { kind: 'unknown' };

/** Runs a command (no shell) and hands back its stdout; rejects on a non-zero exit (with `stderr`). */
export type Run = (cmd: string, args: string[]) => Promise<string>;

export interface CommandPaths {
  networksetup: string;
  route: string;
  arp: string;
}

export const SYSTEM_COMMANDS: CommandPaths = {
  networksetup: '/usr/sbin/networksetup',
  route: '/sbin/route',
  arp: '/usr/sbin/arp',
};

export const NETWORK_TIMEOUT_MS = 2_000;
const UNKNOWN: NetworkState = { kind: 'unknown' };
const NONE: NetworkState = { kind: 'none' };

/**
 * The commands to run: the system's, always once packaged. In development `YUNGU_NETWORK_COMMANDS` may
 * name a folder of stand-ins (`networksetup`, `route`, `arp`: the suspension spec's scripts).
 */
export function commandPaths(opts: { packaged: boolean; env: Record<string, string | undefined> }): CommandPaths {
  const dir = opts.env.YUNGU_NETWORK_COMMANDS;
  if (opts.packaged || !dir) return { ...SYSTEM_COMMANDS };
  return { networksetup: path.join(dir, 'networksetup'), route: path.join(dir, 'route'), arp: path.join(dir, 'arp') };
}

/** `80:5:88:d0:83:E2` → `80:05:88:d0:83:e2`: six colon-separated octets of one or two hex digits; else null. */
export function normaliseMac(s: string): string | null {
  if (typeof s !== 'string') return null;
  const parts = s.trim().split(':');
  if (parts.length !== 6 || !parts.every((p) => /^[0-9a-fA-F]{1,2}$/.test(p))) return null;
  return parts.map((p) => p.toLowerCase().padStart(2, '0')).join(':');
}

const DEVICE = /^[a-z]+[0-9]+$/;

/** The Wi-Fi interface (`en0`), from `networksetup -listallhardwareports`; null on a Mac without one. */
export async function wifiDevice(run: Run, paths: CommandPaths = SYSTEM_COMMANDS): Promise<string | null> {
  const out = await run(paths.networksetup, ['-listallhardwareports']);
  const lines = out.split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const port = /^Hardware Port:\s*(.+)$/.exec(lines[i]);
    if (!port || !/^(Wi-Fi|AirPort)$/.test(port[1].trim())) continue;
    const device = /^Device:\s*(\S+)$/.exec(lines[i + 1] ?? '');
    if (device && DEVICE.test(device[1])) return device[1];
  }
  return null;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

async function readOnce(run: Run, paths: CommandPaths): Promise<NetworkState> {
  const device = await wifiDevice(run, paths);
  if (!device) return NONE;

  let route: string;
  try {
    route = await run(paths.route, ['-n', 'get', '-ifscope', device, 'default']);
  } catch (err) {
    // No default route on the Wi-Fi: off, or not joined.
    const stderr = String((err as { stderr?: unknown }).stderr ?? '');
    if (/not in table/.test(stderr)) return NONE;
    return UNKNOWN;
  }
  const gw = /^\s*gateway:\s*(\S+)\s*$/m.exec(route);
  if (!gw) return NONE;
  const gateway = gw[1];
  const ip = IPV4.exec(gateway);
  if (!ip || ip.slice(1).some((o) => Number(o) > 255)) return UNKNOWN;

  const arp = await run(paths.arp, ['-n', gateway]);
  for (const line of arp.split('\n')) {
    const m = /^\S+ \(([^)]+)\) at (\S+) on (\S+)(?:\s|$)/.exec(line.trim());
    if (!m || m[1] !== gateway || m[3] !== device) continue;
    const mac = normaliseMac(m[2]);
    if (mac) return { kind: 'network', mac };
  }
  return UNKNOWN;
}

/** One reading. Never rejects: every failure, and no answer within 2 s in all, is `unknown`. */
export async function readNetwork(run: Run = runCommand, paths: CommandPaths = SYSTEM_COMMANDS): Promise<NetworkState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<NetworkState>((resolve) => {
    timer = setTimeout(() => resolve(UNKNOWN), NETWORK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readOnce(run, paths).catch(() => UNKNOWN), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The real `Run`: `execFile`, no shell, 2 s per command, a small output limit. */
export const runCommand: Run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: NETWORK_TIMEOUT_MS, maxBuffer: 64 * 1024, encoding: 'utf8', windowsHide: true, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)),
    );
  });
