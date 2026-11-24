// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const localAccount = vi.hoisted(() => vi.fn());
vi.mock('./lib/data/direct', () => ({ localAccount }));
import { register } from './instrumentation';

const proc = process as unknown as { parentPort?: unknown };
afterEach(() => {
  vi.unstubAllEnvs();
  delete proc.parentPort;
  localAccount.mockClear();
});

describe('register', () => {
  it('creates the account when direct and a parent port exist', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DATA_SOURCE', 'direct');
    proc.parentPort = {};
    await register();
    expect(localAccount).toHaveBeenCalledOnce();
  });

  it.each([
    ['not direct', 'mock', {}],
    ['no parent port', 'direct', undefined],
  ])('does nothing: %s', async (_n, source, port) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DATA_SOURCE', source);
    proc.parentPort = port;
    await register();
    expect(localAccount).not.toHaveBeenCalled();
  });
});
