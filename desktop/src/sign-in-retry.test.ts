import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInRetry, type RetryOutcome } from './sign-in-retry';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setUp(outcomes: Array<RetryOutcome | Promise<RetryOutcome>>, blocked = { now: false }) {
  const attempt = vi.fn(async (_current: () => boolean) => outcomes.shift() ?? 'retry');
  const retry = new SignInRetry({ attempt, blocked: () => blocked.now, intervalMs: 10_000 });
  return { attempt, retry, blocked };
}

describe('SignInRetry', () => {
  it('tries every 10 s until an attempt is done, then stops', async () => {
    const { attempt, retry } = setUp(['retry', 'retry', 'done']);
    retry.start();
    expect(retry.active).toBe(true);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(attempt).not.toHaveBeenCalled(); // the first try already failed: wait a full interval
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(retry.active).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('now() (waking, unlocking, a suspension ending) tries at once and restarts the interval', async () => {
    const { attempt, retry } = setUp(['retry', 'done']);
    retry.start();
    await vi.advanceTimersByTimeAsync(4_000);
    retry.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(retry.active).toBe(false);
  });

  it('never tries while blocked (Suspension Mode), and carries on once unblocked', async () => {
    const { attempt, retry, blocked } = setUp(['done'], { now: true });
    retry.start();
    retry.now();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).not.toHaveBeenCalled();
    expect(retry.active).toBe(true);
    blocked.now = false;
    retry.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(retry.active).toBe(false);
  });

  it('runs one attempt at a time', async () => {
    let answer!: (o: RetryOutcome) => void;
    const { attempt, retry } = setUp([new Promise((r) => (answer = r)), 'done']);
    retry.start();
    retry.now();
    retry.now();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    answer('retry');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('stop() (signed in by hand, a restart) ends it, and an attempt on its way learns it is no longer current', async () => {
    let answer!: (o: RetryOutcome) => void;
    const { attempt, retry } = setUp([new Promise((r) => (answer = r))]);
    retry.start();
    retry.now();
    await vi.advanceTimersByTimeAsync(0);
    const current = attempt.mock.calls[0][0];
    expect(current()).toBe(true);
    retry.stop();
    expect(current()).toBe(false);
    answer('retry');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(retry.active).toBe(false);
    retry.now(); // nothing to do once stopped
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('a failing attempt counts as a retry', async () => {
    const { attempt, retry } = setUp(['done']);
    attempt.mockRejectedValueOnce(new Error('x'));
    retry.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(retry.active).toBe(false);
  });

  it('a stale attempt from before a restart never blocks or cancels the new run', async () => {
    let answerOld!: (o: RetryOutcome) => void;
    const { attempt, retry } = setUp([new Promise((r) => (answerOld = r)), 'done']);
    retry.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).toHaveBeenCalledTimes(1); // pending
    retry.stop();
    retry.start(); // restart while the old attempt is still pending
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).toHaveBeenCalledTimes(2); // the new run still ticks
    answerOld('done'); // the stale attempt finishes late
    await vi.advanceTimersByTimeAsync(0);
    expect(retry.active).toBe(false); // new run ended by its own 'done'
  });

  it('a stale attempt finishing does not cancel the new run schedule', async () => {
    let answerOld!: (o: RetryOutcome) => void;
    const { attempt, retry } = setUp([new Promise((r) => (answerOld = r)), 'retry', 'retry']);
    retry.start();
    await vi.advanceTimersByTimeAsync(10_000);
    retry.stop();
    retry.start();
    answerOld('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(retry.active).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
