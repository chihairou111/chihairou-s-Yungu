import { describe, expect, it, vi } from 'vitest';
import { createFetchGate, suspensionMessage, SuspendedError } from './fetch-gate';

/** A fetch that answers only when told to, and rejects with the signal's reason when aborted (like Node's). */
function slowFetch() {
  const calls: Array<{ url: string; init: RequestInit; answer: () => void }> = [];
  const f = vi.fn((url: string, init: RequestInit = {}) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      signal?.addEventListener('abort', () => reject(signal.reason));
      calls.push({ url, init, answer: () => resolve(new Response('ok')) });
    });
  });
  return { f, calls };
}

describe('the server fetch gate', () => {
  it('passes requests through while not suspended', async () => {
    const { f, calls } = slowFetch();
    const gate = createFetchGate(f);
    const p = gate.fetch('https://task.yungu.org/a', { method: 'GET' });
    calls[0].answer();
    await expect((await p).text()).resolves.toBe('ok');
    expect(calls[0].init.method).toBe('GET');
  });

  it('aborts a request already on its way when suspension starts', async () => {
    const { f } = slowFetch();
    const gate = createFetchGate(f);
    const p = gate.fetch('https://task.yungu.org/a', {});
    gate.setSuspended(true);
    await expect(p).rejects.toBeInstanceOf(SuspendedError);
    await expect(p).rejects.toMatchObject({ name: 'Suspended' });
  });

  it('refuses new requests while suspended without calling the real fetch', async () => {
    const { f } = slowFetch();
    const gate = createFetchGate(f);
    gate.setSuspended(true);
    await expect(gate.fetch('https://task.yungu.org/a', {})).rejects.toBeInstanceOf(SuspendedError);
    expect(f).not.toHaveBeenCalled();
  });

  it('works again after resuming, and a later suspension aborts only the new requests', async () => {
    const { f, calls } = slowFetch();
    const gate = createFetchGate(f);
    gate.setSuspended(true);
    gate.setSuspended(false);
    const p = gate.fetch('https://task.yungu.org/a', {});
    calls[0].answer();
    await expect(p).resolves.toBeInstanceOf(Response);
    const q = gate.fetch('https://task.yungu.org/b', {});
    gate.setSuspended(true);
    await expect(q).rejects.toBeInstanceOf(SuspendedError);
  });

  it("keeps the caller's own signal working", async () => {
    const { f } = slowFetch();
    const gate = createFetchGate(f);
    const mine = new AbortController();
    const p = gate.fetch('https://task.yungu.org/a', { signal: mine.signal });
    mine.abort(new Error('mine'));
    await expect(p).rejects.toThrow('mine');
  });
});

describe('suspensionMessage', () => {
  it('reads {type: "suspension", suspended}', () => {
    expect(suspensionMessage({ type: 'suspension', suspended: true })).toBe(true);
    expect(suspensionMessage({ type: 'suspension', suspended: false })).toBe(false);
    for (const m of [null, 1, {}, { type: 'suspension' }, { type: 'suspension', suspended: 'yes' }, { type: 'credentials', suspended: true }]) {
      expect(suspensionMessage(m)).toBeNull();
    }
  });
});
