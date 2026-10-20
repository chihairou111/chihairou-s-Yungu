'use client';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, isSessionEnded } from './detail/api';

/** Refetches the open assignment in place (`useDetailActions().refresh`); rejects with `ApiError`. */
type DetailRefresh = () => Promise<void>;

interface Registry {
  /** The open pop-up offers its refresh while it is open; returns the call that withdraws it. */
  register(refresh: DetailRefresh): () => void;
  current(): DetailRefresh | null;
  /** Other parts of the shell (the notification dot) hear about each refresh; returns the unsubscribe. */
  listen(listener: () => void): () => void;
  /** Tells every listener the service's cache was just dropped. */
  announce(): void;
}

const RefreshContext = createContext<Registry | null>(null);

/**
 * Lets the app bar's Refresh reach the assignment pop-up, which sits under the shell (and, being modal,
 * over the bar): the pop-up registers its own refresh while open and the bar's action calls it.
 */
export function RefreshProvider({ children }: { children: ReactNode }) {
  const detail = useRef<DetailRefresh | null>(null);
  const listeners = useRef(new Set<() => void>());
  const registry = useMemo<Registry>(
    () => ({
      listen(listener) {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
      announce() {
        for (const listener of listeners.current) listener();
      },
      register(refresh) {
        detail.current = refresh;
        return () => {
          if (detail.current === refresh) detail.current = null;
        };
      },
      current: () => detail.current,
    }),
    [],
  );
  return <RefreshContext value={registry}>{children}</RefreshContext>;
}

/** For the assignment pop-up: `refresh` while it is open, `null` when closed. */
export function useRegisterDetailRefresh(refresh: DetailRefresh | null): void {
  const registry = use(RefreshContext);
  useEffect(() => {
    if (registry && refresh) return registry.register(refresh);
  }, [registry, refresh]);
}

/** Runs `listener` after each app-bar refresh has dropped the service's cache (the newest `listener` is used). */
export function useOnRefresh(listener: () => void): void {
  const registry = use(RefreshContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => registry?.listen(() => latest.current()), [registry]);
}

/**
 * The service skips its read cache for requests carrying this cookie (`REFRESH_COOKIE` in
 * `lib/data/service.ts`, which is server-only). Short-lived, so a refresh cut off mid-way cannot leave
 * every later page uncached.
 */
const REFRESH_COOKIE = 'yl_refresh';
const setRefreshFlag = (on: boolean) => {
  document.cookie = `${REFRESH_COOKIE}=${on ? '1' : ''}; Path=/; Max-Age=${on ? 30 : 0}; SameSite=Lax`;
};

const NO_CONNECTION = 'No connection. Try again.';
const GENERIC_ERROR = 'Something went wrong. Try again.';

/** POST /api/refresh: the service drops its cached reads. Throws `ApiError` like the pop-up's calls. */
async function dropServiceCache(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
  } catch {
    throw new ApiError(0, NO_CONNECTION);
  }
  if (res.ok) return;
  const body: unknown = await res.json().catch(() => null);
  const message =
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : GENERIC_ERROR;
  throw new ApiError(res.status, message);
}

export interface RefreshState {
  /** From the click until the page has re-rendered and the open assignment is back. */
  refreshing: boolean;
  /** Starts a refresh; ignored while one runs. */
  refresh(): void;
  /** Why the last refresh failed (for a snackbar), until dismissed or the next refresh. */
  error: { message: string; key: number } | null;
  dismissError(): void;
}

/**
 * The refresh button's action: drop the service's cache, then re-render the page (`router.refresh()`,
 * flagged so the service skips its cache) and refetch the open assignment. A 401 means the session is
 * over (the response already cleared it and kept the reason), so it goes to the sign-in page, which says why.
 */
export function useRefresh(): RefreshState {
  const router = useRouter();
  const registry = use(RefreshContext);
  // Covers the async action and the router's re-render it starts, so "done" means the new page is in.
  const [pending, startTransition] = useTransition();
  // Set at once on click (state lags a render), so a double click starts one refresh.
  const running = useRef(false);
  const flagged = useRef(false);
  const [error, setError] = useState<RefreshState['error']>(null);

  useEffect(() => {
    if (!pending && flagged.current) {
      flagged.current = false;
      setRefreshFlag(false);
    }
  }, [pending]);

  const refresh = useCallback(() => {
    if (running.current || pending) return;
    running.current = true;
    setError(null);
    startTransition(async () => {
      try {
        await dropServiceCache();
        registry?.announce();
        setRefreshFlag(true);
        flagged.current = true;
        startTransition(() => router.refresh());
        await registry?.current()?.();
      } catch (e) {
        if (isSessionEnded(e)) router.replace('/login');
        else setError({ message: e instanceof ApiError ? e.message : GENERIC_ERROR, key: Date.now() });
      } finally {
        running.current = false;
      }
    });
  }, [pending, router, registry]);

  const dismissError = useCallback(() => setError(null), []);
  return { refreshing: pending, refresh, error, dismissError };
}
