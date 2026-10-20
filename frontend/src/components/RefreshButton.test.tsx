import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';
import RefreshButton from './RefreshButton';
import { RefreshProvider, useOnRefresh, useRegisterDetailRefresh } from './RefreshContext';
import ThemeRegistry from './ThemeRegistry';

const nav = vi.hoisted(() => ({ pathname: '/assignments', refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh, replace: nav.replace }),
}));

/** A controllable answer to POST /api/refresh. */
function deferred() {
  let resolve!: (res: Response) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const noContent = () => new Response(null, { status: 204 });
const failed = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => noContent());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  nav.refresh.mockReset();
  nav.replace.mockReset();
  nav.pathname = '/assignments';
  document.cookie = 'yl_refresh=; Max-Age=0; Path=/';
});

function renderButton(extra?: React.ReactNode) {
  return render(
    <ThemeRegistry>
      <RefreshProvider>
        <RefreshButton />
        {extra}
      </RefreshProvider>
    </ThemeRegistry>,
  );
}

const button = () => screen.getByRole('button', { name: 'Refresh' });

describe('RefreshButton in the app bar', () => {
  it('sits between Notifications and the avatar on both pages', async () => {
    for (const pathname of ['/assignments', '/calendar']) {
      nav.pathname = pathname;
      const { unmount } = render(
        <ThemeRegistry>
          <AppShell userName="Bruce Zheng">content</AppShell>
        </ThemeRegistry>,
      );
      const bar = screen.getByRole('banner');
      const refresh = within(bar).getByRole('button', { name: 'Refresh' });
      const bell = within(bar).getByRole('button', { name: 'Notifications' });
      const avatar = within(bar).getByRole('button', { name: 'Account: Bruce Zheng' });
      expect(bell.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(refresh.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      unmount();
    }
  });

  it('explains itself in a tooltip', async () => {
    renderButton();
    await userEvent.hover(button());
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Refresh from Yungu');
  });
});

describe('refreshing', () => {
  it('asks the server to drop its cache, then re-renders the page', async () => {
    const answer = deferred();
    fetchMock.mockReturnValueOnce(answer.promise);
    renderButton();
    await userEvent.click(button());
    expect(fetchMock).toHaveBeenCalledWith('/api/refresh', expect.objectContaining({ method: 'POST' }));
    // The page is re-rendered only once the cache is gone, so it cannot come back stale.
    expect(nav.refresh).not.toHaveBeenCalled();
    await act(async () => answer.resolve(noContent()));
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it('tells the shell (the notification dot) once the cache is gone, and only then', async () => {
    const answer = deferred();
    fetchMock.mockReturnValueOnce(answer.promise);
    const heard = vi.fn();
    function Listener() {
      useOnRefresh(heard);
      return null;
    }
    render(
      <ThemeRegistry>
        <RefreshProvider>
          <RefreshButton />
          <Listener />
        </RefreshProvider>
      </ThemeRegistry>,
    );
    await userEvent.click(button());
    expect(heard).not.toHaveBeenCalled();
    await act(async () => answer.resolve(noContent()));
    expect(heard).toHaveBeenCalledOnce();
  });

  it('is disabled (but keeps focus) while it runs, so a double click refreshes once', async () => {
    const answer = deferred();
    fetchMock.mockReturnValueOnce(answer.promise);
    renderButton();
    await userEvent.dblClick(button());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    expect(button()).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing…');
    await act(async () => answer.resolve(noContent()));
    await waitFor(() => expect(button()).not.toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it('spins while it runs, unless reduced motion is asked for', async () => {
    const answer = deferred();
    fetchMock.mockReturnValue(answer.promise);
    const { unmount } = renderButton();
    await userEvent.click(button());
    expect(button()).toHaveAttribute('data-spinning', 'true');
    unmount();

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener() {},
      removeEventListener() {},
    }));
    renderButton();
    await userEvent.click(button());
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    expect(button()).not.toHaveAttribute('data-spinning', 'true');
    // Still said to screen readers.
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing…');
    // React entangles pending async actions, so none may be left running for the next test.
    await act(async () => answer.resolve(noContent()));
  });

  it('asks the service to skip its cache for the re-render, then stops asking', async () => {
    let flagged: boolean | null = null;
    nav.refresh.mockImplementation(() => {
      flagged = document.cookie.includes('yl_refresh=1');
    });
    renderButton();
    await userEvent.click(button());
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(flagged).toBe(true);
    await waitFor(() => expect(document.cookie).not.toContain('yl_refresh=1'));
  });

  it('also refreshes the open assignment, after the cache is gone', async () => {
    const detailRefresh = vi.fn(async () => {
      // The service's cache was dropped first.
      expect(fetchMock).toHaveBeenCalled();
    });
    function OpenDetail() {
      useRegisterDetailRefresh(detailRefresh);
      return null;
    }
    renderButton(<OpenDetail />);
    await userEvent.click(button());
    await waitFor(() => expect(detailRefresh).toHaveBeenCalledOnce());
    expect(nav.refresh).toHaveBeenCalledOnce();
  });

  it('leaves a closed assignment alone', async () => {
    const detailRefresh = vi.fn(async () => {});
    function Detail() {
      const [open, setOpen] = useState(true);
      useRegisterDetailRefresh(open ? detailRefresh : null);
      return <button onClick={() => setOpen(false)}>Close detail</button>;
    }
    renderButton(<Detail />);
    await userEvent.click(screen.getByRole('button', { name: 'Close detail' }));
    await userEvent.click(button());
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledOnce());
    expect(detailRefresh).not.toHaveBeenCalled();
  });

  it("shows the server's message in a snackbar when it fails, and can be tried again", async () => {
    fetchMock.mockResolvedValueOnce(failed(502, "Can't reach Yungu right now. Try again."));
    renderButton();
    await userEvent.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Yungu right now. Try again.");
    expect(nav.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(button()).not.toHaveAttribute('aria-disabled', 'true'));
    await userEvent.click(button());
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledOnce());
  });

  it('says so when the request never reaches the server', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderButton();
    await userEvent.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection. Try again.');
  });

  it("shows the open assignment's failure the same way", async () => {
    const { ApiError } = await import('./detail/api');
    function OpenDetail() {
      useRegisterDetailRefresh(async () => {
        throw new ApiError(502, "Can't reach Yungu right now. Try again.");
      });
      return null;
    }
    renderButton(<OpenDetail />);
    await userEvent.click(button());
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Yungu right now. Try again.");
  });

  it('goes to sign-in when the session has ended (the 401 already cleared it and kept the reason)', async () => {
    fetchMock.mockResolvedValueOnce(failed(401, 'Sign in again — your Yungu password may have changed.'));
    renderButton();
    await userEvent.click(button());
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'));
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
