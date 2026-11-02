import { act, render, screen, waitFor, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoistStatus } from '@/lib/types';
import { ApiError } from './detail/api';
import TodoistMenu, { POLL_MS, SYNC_POLL_MS } from './TodoistMenu';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }) }));

const api = vi.hoisted(() => ({ fetchTodoistStatus: vi.fn(), syncTodoist: vi.fn(), disconnectTodoist: vi.fn() }));
vi.mock('./todoist-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./todoist-api')>()), ...api }));

const refresh = vi.hoisted(() => ({ listener: null as null | (() => void) }));
vi.mock('./RefreshContext', () => ({
  useOnRefresh: (listener: () => void) => {
    refresh.listener = listener;
  },
}));

const NOW = Date.UTC(2026, 10, 2, 10, 0); // Mon Nov 2 18:00 China
const OFF: TodoistStatus = { connected: false, state: 'ok' };
const OK: TodoistStatus = { connected: true, account: 'Bruce Zheng', state: 'ok', lastSyncAt: NOW - 3 * 60_000 };
const SYNCING: TodoistStatus = { ...OK, state: 'syncing' };
const failing = (code: NonNullable<TodoistStatus['error']>['code'], message: string): TodoistStatus => ({
  ...OK,
  state: 'error',
  error: { code, message },
});
const REAUTH = failing('reauth', 'Todoist needs you to connect again.');

const serve = (...answers: TodoistStatus[]) => {
  const last = answers[answers.length - 1];
  for (const a of answers.slice(0, -1)) api.fetchTodoistStatus.mockResolvedValueOnce(a);
  api.fetchTodoistStatus.mockResolvedValue(last);
};

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  api.syncTodoist.mockResolvedValue(undefined);
  api.disconnectTodoist.mockResolvedValue(undefined);
  window.history.replaceState(null, '', '/assignments');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const fn of [...Object.values(api), nav.replace]) fn.mockReset();
});

const badgeOf = (button: HTMLElement) => button.querySelector('.MuiBadge-badge');

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: /^Todoist/ }));
  return screen.findByRole('dialog', { name: 'Todoist' });
}

describe('TodoistMenu: the icon', () => {
  it.each([
    ['not connected', OFF],
    ['connected', OK],
    ['syncing', SYNCING],
  ])('has no badge and the plain name while %s', async (_name, status) => {
    serve(status);
    render(<TodoistMenu />);
    await waitFor(() => expect(api.fetchTodoistStatus).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: 'Todoist' });
    expect(badgeOf(button)).toHaveClass('MuiBadge-invisible');
  });

  it.each([
    ['reauth', 'Todoist needs you to connect again.'],
    ['todoist_unreachable', "Can't reach Todoist right now."],
    ['signin', 'Sign in to the dashboard again to keep syncing.'],
    ['yungu_unreachable', "Can't reach Yungu right now."],
  ] as const)('pins the red × to the icon and names the problem on %s', async (code, message) => {
    serve(failing(code, message));
    render(<TodoistMenu />);
    const button = await screen.findByRole('button', { name: 'Todoist, sync problem' });
    const badge = badgeOf(button)!;
    expect(badge).not.toHaveClass('MuiBadge-invisible');
    expect(badge).toHaveClass('MuiBadge-colorError');
    // A white × in the circle, not a number or a bare dot.
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge).toHaveTextContent('');
  });

  it('its tooltip is plain "Todoist", even with the badge (the name already says the problem)', async () => {
    serve(REAUTH);
    render(<TodoistMenu />);
    const button = await screen.findByRole('button', { name: 'Todoist, sync problem' });
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Todoist$/);
    expect(button).toHaveAccessibleDescription('Todoist');
  });

  it('a status that cannot be read shows no badge', async () => {
    api.fetchTodoistStatus.mockRejectedValue(new ApiError(502, "Can't reach Yungu right now. Try again."));
    render(<TodoistMenu />);
    await waitFor(() => expect(api.fetchTodoistStatus).toHaveBeenCalled());
    expect(badgeOf(screen.getByRole('button', { name: 'Todoist' }))).toHaveClass('MuiBadge-invisible');
  });
});

describe('TodoistMenu: the menu', () => {
  it('not connected: says what it does and offers Connect Todoist (the connect route)', async () => {
    serve(OFF);
    render(<TodoistMenu />);
    const menu = await openMenu();
    expect(menu).toHaveTextContent(/Inbox/);
    expect(within(menu).getByRole('link', { name: 'Connect Todoist' })).toHaveAttribute('href', '/api/todoist/connect');
    expect(within(menu).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('connected: the Todoist account, when it last synced, and Disconnect', async () => {
    serve(OK);
    render(<TodoistMenu />);
    const menu = await openMenu();
    expect(menu).toHaveTextContent('Connected to Todoist · Bruce Zheng');
    expect(within(menu).getByRole('status')).toHaveTextContent('Synced 3 min ago');
    expect(within(menu).queryByRole('link', { name: 'Connect Todoist' })).not.toBeInTheDocument();
  });

  it('connected without a name, and before the first sync', async () => {
    serve({ connected: true, state: 'ok' });
    render(<TodoistMenu />);
    const menu = await openMenu();
    expect(menu).toHaveTextContent('Connected to Todoist');
    expect(menu).not.toHaveTextContent('·');
    expect(within(menu).getByRole('status')).toHaveTextContent('Not synced yet');
  });

  it('re-reads the status on opening', async () => {
    serve(OFF, OK);
    render(<TodoistMenu />);
    await waitFor(() => expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(1));
    const menu = await openMenu();
    expect(await within(menu).findByText('Connected to Todoist · Bruce Zheng')).toBeInTheDocument();
  });

  it('Disconnect forgets the connection and offers Connect again', async () => {
    serve(OK);
    render(<TodoistMenu />);
    const menu = await openMenu();
    api.fetchTodoistStatus.mockResolvedValue(OFF);
    await userEvent.click(within(menu).getByRole('button', { name: 'Disconnect' }));
    expect(api.disconnectTodoist).toHaveBeenCalledOnce();
    expect(await within(menu).findByRole('link', { name: 'Connect Todoist' })).toBeInTheDocument();
  });

  it('a Disconnect that fails says so and keeps the connection', async () => {
    serve(OK);
    api.disconnectTodoist.mockRejectedValue(new ApiError(502, "Can't reach Yungu right now. Try again."));
    render(<TodoistMenu />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: 'Disconnect' }));
    expect(await within(menu).findByRole('alert')).toHaveTextContent("Can't reach Yungu right now. Try again.");
    expect(within(menu).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('reauth: the message and Reconnect (the connect route)', async () => {
    serve(REAUTH);
    render(<TodoistMenu />);
    const menu = await openMenu();
    expect(menu).toHaveTextContent('Todoist needs you to connect again.');
    expect(within(menu).getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/api/todoist/connect');
    expect(within(menu).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it.each([
    ['todoist_unreachable', "Can't reach Todoist right now."],
    ['yungu_unreachable', "Can't reach Yungu right now."],
  ] as const)('%s: the message and Try again, which syncs and shows Syncing…', async (code, message) => {
    serve(failing(code, message));
    render(<TodoistMenu />);
    const menu = await openMenu();
    // The service's straight apostrophe, set as the menu's own curly one.
    expect(menu).toHaveTextContent(message.replace("'", '’'));
    api.fetchTodoistStatus.mockResolvedValue(SYNCING);
    await userEvent.click(within(menu).getByRole('button', { name: 'Try again' }));
    expect(api.syncTodoist).toHaveBeenCalledOnce();
    expect(await within(menu).findByText('Syncing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todoist', hidden: true })).toBeInTheDocument();
  });

  it('signin: the message and Sign in again (which ends the dashboard session)', async () => {
    serve(failing('signin', 'Sign in to the dashboard again to keep syncing.'));
    render(<TodoistMenu />);
    const menu = await openMenu();
    expect(menu).toHaveTextContent('Sign in to the dashboard again to keep syncing.');
    expect(within(menu).getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/api/session/ended');
  });

  it('a status that cannot be read, opened: says so, with Try again', async () => {
    api.fetchTodoistStatus.mockRejectedValue(new ApiError(502, "Can't reach Yungu right now. Try again."));
    render(<TodoistMenu />);
    const menu = await openMenu();
    expect(await within(menu).findByText('Couldn’t load your Todoist connection.')).toBeInTheDocument();
    serve(OK);
    await userEvent.click(within(menu).getByRole('button', { name: 'Try again' }));
    expect(await within(menu).findByText('Connected to Todoist · Bruce Zheng')).toBeInTheDocument();
  });

  it('a 401 while open goes to sign in', async () => {
    serve(OK);
    render(<TodoistMenu />);
    await waitFor(() => expect(api.fetchTodoistStatus).toHaveBeenCalled());
    api.fetchTodoistStatus.mockRejectedValue(new ApiError(401, 'Sign in again.'));
    await openMenu();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'));
  });
});

describe('TodoistMenu: keeping the status current', () => {
  it('checks again every 5 minutes while the tab is visible, making up a missed check on return', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    serve(OK);
    render(<TodoistMenu />);
    await waitFor(() => expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(1));
    serve(REAUTH);
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Todoist, sync problem' })).toBeInTheDocument();
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(3);
  });

  it('every 3 seconds while a sync runs, then back to every 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    serve(SYNCING);
    render(<TodoistMenu />);
    await waitFor(() => expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(1));
    // The answer is in (and the faster pace set) before the clock moves.
    await act(async () => {});
    serve({ ...OK, lastSyncAt: NOW });
    await act(async () => vi.advanceTimersByTime(SYNC_POLL_MS));
    expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(SYNC_POLL_MS * 5));
    expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(2);
  });

  it('shows Synced just now once a sync seen in the open menu ends', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    serve(SYNCING);
    render(<TodoistMenu />);
    const menu = await openMenu();
    expect(within(menu).getByRole('status')).toHaveTextContent('Syncing…');
    serve({ ...OK, lastSyncAt: NOW });
    await act(async () => vi.advanceTimersByTime(SYNC_POLL_MS));
    expect(within(menu).getByRole('status')).toHaveTextContent('Synced just now');
  });

  it('re-reads the status after the app bar’s Refresh (which starts a sync)', async () => {
    serve(OK);
    render(<TodoistMenu />);
    await waitFor(() => expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(1));
    serve(SYNCING);
    await act(async () => refresh.listener?.());
    expect(api.fetchTodoistStatus).toHaveBeenCalledTimes(2);
  });
});

describe('TodoistMenu: back from Todoist', () => {
  it('?todoist=connected opens the menu once to show it, and leaves the rest of the URL alone', async () => {
    window.history.replaceState(null, '', '/assignments?tab=submitted&todoist=connected');
    serve(SYNCING);
    render(<TodoistMenu />);
    const menu = await screen.findByRole('dialog', { name: 'Todoist' });
    expect(await within(menu).findByText('Connected to Todoist · Bruce Zheng')).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe('/assignments?tab=submitted');
  });

  it.each([
    ['expired', 'That Todoist link expired. Try connecting again.'],
    ['refused', 'Todoist didn’t accept the connection. Try again.'],
    ['unreachable', 'Can’t reach Todoist right now. Try again.'],
    ['setup', 'Todoist isn’t set up on this server.'],
    ['denied', 'Todoist wasn’t connected.'],
    ['failed', 'Something went wrong. Try again.'],
    ['anything', 'Something went wrong. Try again.'],
  ])('?todoist=error&why=%s opens the menu with why', async (why, message) => {
    window.history.replaceState(null, '', `/assignments?todoist=error&why=${why}`);
    serve(OFF);
    render(<TodoistMenu />);
    const menu = await screen.findByRole('dialog', { name: 'Todoist' });
    expect(within(menu).getByRole('alert')).toHaveTextContent(message);
    expect(within(menu).getByRole('link', { name: 'Connect Todoist' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});
