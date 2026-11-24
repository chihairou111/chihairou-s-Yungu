/**
 * The server process's gate on Yungu: every Yungu and OSS request the server makes goes through
 * `globalThis.__yunguFetch` (see `server.ts`). While Suspension Mode suspends, new requests are refused
 * before they leave the Mac and the ones already on their way are aborted (a shared AbortController,
 * swapped for a fresh one on each suspension). The frontend reports the refusal as "Can't reach Yungu".
 */
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The error the gate throws (and aborts with). Its `name` is what the frontend looks for. */
export class SuspendedError extends Error {
  constructor() {
    super('Suspension Mode: not sending anything to Yungu.');
    this.name = 'Suspended';
  }
}

export function createFetchGate(underlying: Fetch) {
  let suspended = false;
  let controller = new AbortController();
  return {
    fetch(input: string, init: RequestInit = {}): Promise<Response> {
      if (suspended) return Promise.reject(new SuspendedError());
      const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
      return underlying(input, { ...init, signal });
    },
    setSuspended(on: boolean): void {
      if (on && !suspended) {
        controller.abort(new SuspendedError());
        controller = new AbortController();
      }
      suspended = on;
    },
    isSuspended: () => suspended,
  };
}

/** `{type: 'suspension', suspended}` from the main process: the flag, or null for any other message. */
export function suspensionMessage(data: unknown): boolean | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as { type?: unknown; suspended?: unknown };
  return m.type === 'suspension' && typeof m.suspended === 'boolean' ? m.suspended : null;
}
