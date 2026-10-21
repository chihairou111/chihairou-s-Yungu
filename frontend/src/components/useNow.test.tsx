import { act, render, screen } from './test-render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

function Clock({ initial }: { initial: number }) {
  return <span>{useNow(initial)}</span>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('starts from the given time and follows the clock each minute', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 9, 19, 2, 0, 30);
    vi.setSystemTime(start);
    render(<Clock initial={start - 5000} />);
    expect(screen.getByText(String(start - 5000))).toBeInTheDocument();
    // First tick on the next minute boundary, then every 60 s.
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText(String(start + 30_000))).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText(String(start + 90_000))).toBeInTheDocument();
  });

  it('catches up at once when the page becomes visible again after the timers stalled (sleep, frozen tab)', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 9, 21, 3, 51, 0);
    vi.setSystemTime(start);
    render(<Clock initial={start} />);
    // The laptop sleeps for 29 minutes: the clock moves but no timer has fired yet.
    vi.setSystemTime(start + 29 * 60_000);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText(String(start + 29 * 60_000))).toBeInTheDocument();
  });

  it('catches up when the window regains focus', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 9, 21, 3, 51, 0);
    vi.setSystemTime(start);
    render(<Clock initial={start} />);
    vi.setSystemTime(start + 10 * 60_000);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByText(String(start + 10 * 60_000))).toBeInTheDocument();
  });

  it('starts from the device clock when the server time is stale (a cached page)', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 9, 21, 4, 20, 0);
    vi.setSystemTime(start);
    render(<Clock initial={start - 30 * 60_000} />);
    // After mount the hook follows the device clock rather than waiting for the next minute.
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText(String(start))).toBeInTheDocument();
  });
});
