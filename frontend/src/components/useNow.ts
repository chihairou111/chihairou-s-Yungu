'use client';
import { useEffect, useState } from 'react';

const MINUTE = 60_000;

/**
 * The current time, starting from `initial` (the server's clock, so the first client render matches
 * the server HTML) and then following the device clock on every minute boundary.
 */
export function useNow(initial: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => setNow(Date.now());
    const first = setTimeout(() => {
      tick();
      interval = setInterval(tick, MINUTE);
    }, MINUTE - (Date.now() % MINUTE));
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);
  return now;
}
