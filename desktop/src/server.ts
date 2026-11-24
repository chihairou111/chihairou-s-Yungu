/**
 * The utilityProcess entry: runs the standalone Next server (its path is argv[2]) inside Electron, so the
 * bridge's `process.parentPort` reaches the main process.
 *
 * Yungu's fetch: the server's Yungu and OSS requests all go through `globalThis.__yunguFetch ?? fetch`.
 * The plan was to install Electron's `net.fetch` here (Chromium's network stack: system proxy and
 * certificates), but a check on Electron 45 showed `net.fetch` in a utility process cannot do
 * `redirect: 'manual'` (it rejects with "Redirect was cancelled" instead of returning the 3xx), and the
 * direct sign-in needs the real 3xx and its Set-Cookie. So the wrapper installed here calls Node's own
 * `fetch` (see README.md). It is Suspension Mode's gate: while the main process says `suspended`, new
 * requests are refused and those on their way are aborted (`fetch-gate.ts`).
 */
import { createFetchGate, suspensionMessage } from './fetch-gate';

const serverJs = process.argv[2];
if (!serverJs) throw new Error('server.ts: the standalone server path (argv[2]) is missing');

// The global fetch as it is when called (Next may wrap it once the server loads); never the wrapper itself.
const gate = createFetchGate((url, init) => globalThis.fetch(url, init));
(globalThis as { __yunguFetch?: typeof gate.fetch }).__yunguFetch = gate.fetch;
process.parentPort?.on('message', (e: { data: unknown }) => {
  const suspended = suspensionMessage(e.data);
  if (suspended !== null) gate.setSuspended(suspended);
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
require(serverJs);
