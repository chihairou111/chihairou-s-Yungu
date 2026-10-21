'use client';
import { useEffect, useState } from 'react';

const MINUTE = 60_000;

/**
 * The current time, starting from `initial` (the server's clock, so the first client render matches
 * the server HTML) and then following the device clock: right after mount (the server time may come
 * from a cached page), on every minute boundary, and at once whenever the page becomes visible or the
 * window regains focus — timers stall while a laptop sleeps or the browser freezes a background tab.
 */
export function useNow(initial: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Each tick re-aims at the next minute boundary, so a late timer never drifts.
    const tick = () => {
      clearTimeout(timer);
      setNow(Date.now());
      timer = setTimeout(tick, MINUTE - (Date.now() % MINUTE));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    timer = setTimeout(tick, 0);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    window.addEventListener('pageshow', tick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pageshow', tick);
    };
  }, []);
  return now;
}
