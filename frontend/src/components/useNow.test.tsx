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
});
