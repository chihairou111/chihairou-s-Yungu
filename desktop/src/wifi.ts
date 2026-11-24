/**
 * Which Wi-Fi the Mac is on, for Suspension Mode. A tiny bundled Swift helper (`native/wifi-ssid.swift`,
 * built on the Mac by `npm run build:wifi-helper`) prints exactly one line: `SSID:<name>`, `NONE` (no
 * Wi-Fi interface, Wi-Fi off, or not joined to a network) or `UNKNOWN` (joined, but the name cannot be
 * read: Location access refused or not yet given). Anything else, an error or no answer within 2 s is
 * `unknown`, which Suspension Mode treats as a Wi-Fi that is not allowed.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

export type WifiState = { kind: 'none' } | { kind: 'wifi'; ssid: string } | { kind: 'unknown' };

export const WIFI_TIMEOUT_MS = 2_000;
const UNKNOWN: WifiState = { kind: 'unknown' };

/** The helper's one line, read strictly. */
export function parseHelperOutput(out: string): WifiState {
  const lines = out.split('\n');
  if (lines[lines.length - 1] === '') lines.pop(); // the line's own newline
  if (lines.length !== 1) return UNKNOWN;
  const line = lines[0].replace(/\r$/, '');
  if (line === 'NONE') return { kind: 'none' };
  if (line === 'UNKNOWN') return UNKNOWN;
  if (line.startsWith('SSID:') && line.length > 'SSID:'.length) return { kind: 'wifi', ssid: line.slice('SSID:'.length) };
  return UNKNOWN;
}

/**
 * The helper to run: `<resources>/bin/wifi-ssid` in the app; in development `YUNGU_WIFI_HELPER` may
 * point at a stand-in (the smoke spec's script). The override is never honoured once packaged.
 */
export function helperPath(opts: { packaged: boolean; resourcesPath: string; env: Record<string, string | undefined> }): string {
  if (!opts.packaged && opts.env.YUNGU_WIFI_HELPER) return opts.env.YUNGU_WIFI_HELPER;
  return path.join(opts.resourcesPath, 'bin', 'wifi-ssid');
}

/** Runs the helper (no shell, no arguments) and hands back its stdout. */
export function runHelper(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, [], { timeout: WIFI_TIMEOUT_MS, maxBuffer: 4096, encoding: 'utf8', windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

/** One reading. Never rejects: every failure is `unknown`. An empty `bin` (no helper set up) too. */
export async function readWifi(run: (bin: string) => Promise<string> = runHelper, bin = ''): Promise<WifiState> {
  if (!bin) return UNKNOWN;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WifiState>((resolve) => {
    timer = setTimeout(() => resolve(UNKNOWN), WIFI_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(bin).then(parseHelperOutput, () => UNKNOWN), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
