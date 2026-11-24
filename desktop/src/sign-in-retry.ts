/**
 * The startup sign-in, tried again while Yungu cannot be reached (the Mac opened the app before its
 * Wi-Fi connected, or Yungu is down): every `intervalMs` (10 s), and at once on `now()` (waking,
 * unlocking, a suspension ending). Never while `blocked()` (Suspension Mode is on and suspended): nothing
 * may then go to Yungu. One attempt at a time; it ends when an attempt is `done` (signed in, the password
 * was refused, or the sign-in page is gone) or on `stop()` (the user signed in by hand, a restart).
 */
export type RetryOutcome = 'done' | 'retry';

export interface RetryOptions {
  /** One sign-in; `current()` turns false once this retry has been stopped (do nothing with the answer then). */
  attempt: (current: () => boolean) => Promise<RetryOutcome>;
  blocked: () => boolean;
  intervalMs?: number;
}

export const RETRY_INTERVAL_MS = 10_000;

export class SignInRetry {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every start and stop: an attempt from an earlier run is no longer current. */
  private run = 0;
  private on = false;
  /** The run number of the attempt on its way, or null: a stale attempt (older run) never blocks the current one. */
  private inFlightRun: number | null = null;
  private readonly intervalMs: number;

  constructor(private readonly opts: RetryOptions) {
    this.intervalMs = opts.intervalMs ?? RETRY_INTERVAL_MS;
  }

  get active(): boolean {
    return this.on;
  }

  /** Starts retrying; the first try is one interval away (the one that just failed counts as the first). */
  start(): void {
    this.stop();
    this.on = true;
    this.run += 1;
    this.schedule();
  }

  stop(): void {
    this.on = false;
    this.run += 1;
    this.clearTimer();
  }

  /** Tries at once (if retrying, not blocked and no attempt is on its way). */
  now(): void {
    if (!this.on || this.inFlightRun === this.run) return;
    this.clearTimer();
    void this.tick();
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (!this.on || this.inFlightRun === this.run) return;
    if (this.opts.blocked()) return this.schedule();
    const run = this.run;
    const current = () => this.on && this.run === run;
    this.inFlightRun = run;
    let outcome: RetryOutcome;
    try {
      outcome = await this.opts.attempt(current);
    } catch {
      outcome = 'retry';
    } finally {
      if (this.inFlightRun === run) this.inFlightRun = null;
    }
    if (!current()) return;
    if (outcome === 'done') this.stop();
    else this.schedule();
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
