import { act, render, screen, waitFor, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification } from '@/lib/types';
import { ApiError } from './detail/api';
import theme from '@/theme';
import NotificationsMenu, { POLL_MS } from './NotificationsMenu';

const nav = vi.hoisted(() => ({ pathname: '/assignments', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
}));

const api = vi.hoisted(() => ({ fetchUnreadCount: vi.fn(), fetchNotifications: vi.fn(), markNotificationRead: vi.fn() }));
vi.mock('./notifications-api', () => api);

const task = vi.hoisted(() => ({ openTaskHere: vi.fn() }));
vi.mock('./detail/useTaskParam', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./detail/useTaskParam')>()),
  openTaskHere: task.openTaskHere,
}));

const refresh = vi.hoisted(() => ({ listener: null as null | (() => void) }));
vi.mock('./RefreshContext', () => ({
  useOnRefresh: (listener: () => void) => {
    refresh.listener = listener;
  },
}));

const NOW = Date.UTC(2026, 9, 20, 10, 0); // Tue Oct 20 18:00 China
const HOUR = 3600_000;
const note = (id: string, read: boolean, taskId: number | null, hoursAgo = 1, title = `Title ${id}`): Notification => ({
  id,
  title,
  body: `Body ${id}`,
  createdAt: NOW - hoursAgo * HOUR,
  read,
  taskId,
});

const UNREAD = [note('9', false, 203, 2, 'Feedback updated'), note('8', false, null, 5, 'School notice')];
const READ = Array.from({ length: 20 }, (_, i) => note(String(100 - i), true, i % 2 ? 207 : null, 30 + i));

function serve({ unread = UNREAD, read = READ, more = true } = {}) {
  api.fetchUnreadCount.mockResolvedValue(unread.length);
  api.fetchNotifications.mockImplementation(async (isRead: boolean, page: number) =>
    isRead
      ? page === 1
        ? { items: read, hasMore: more }
        : { items: [note('50', true, null, 90, 'Older one')], hasMore: false }
      : { items: unread, hasMore: false },
  );
  api.markNotificationRead.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  nav.pathname = '/assignments';
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const fn of [...Object.values(api), nav.push, nav.replace, task.openTaskHere]) fn.mockReset();
});

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
  return screen.findByRole('dialog', { name: 'Notifications' });
}

describe('NotificationsMenu', () => {
  it('fetches the count on load and names it on the button, with a dot', async () => {
    render(<NotificationsMenu />);
    const button = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(api.fetchUnreadCount).toHaveBeenCalledOnce();
    const badge = button.querySelector('.MuiBadge-badge');
    expect(badge).not.toHaveClass('MuiBadge-invisible');
    // A numbered badge, not a bare dot.
    expect(badge).toHaveTextContent('2');
    expect(badge).not.toHaveClass('MuiBadge-dot');
  });

  it('caps the badge at 99+', async () => {
    serve({ unread: Array.from({ length: 120 }, (_, i) => note(`u${i}`, false, null)) });
    render(<NotificationsMenu />);
    const button = await screen.findByRole('button', { name: /^Notifications, \d+ unread$/ });
    expect(button.querySelector('.MuiBadge-badge')).toHaveTextContent('99+');
  });

  it('puts the unread count in the page title, and drops it when nothing is unread', async () => {
    document.title = "chihairou's Yungu";
    const { unmount } = render(<NotificationsMenu />);
    await waitFor(() => expect(document.title).toBe("(2) chihairou's Yungu"));
    // Next writes the page title back on navigation; the count is put back in front of it.
    document.title = "chihairou's Yungu";
    await waitFor(() => expect(document.title).toBe("(2) chihairou's Yungu"));
    unmount();
    expect(document.title).toBe("chihairou's Yungu");
  });

  it('shows no dot and a plain name with nothing unread', async () => {
    serve({ unread: [] });
    render(<NotificationsMenu />);
    await waitFor(() => expect(api.fetchUnreadCount).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: 'Notifications' });
    expect(button.querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible');
  });

  it('opens a popover with Unread then Read, each item with title, body and time', async () => {
    render(<NotificationsMenu />);
    const menu = await openMenu();
    const headings = within(menu).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Unread (2)', 'Read']);
    const unread = within(menu).getByRole('list', { name: 'Unread' });
    const first = within(unread).getAllByRole('listitem')[0];
    expect(first).toHaveTextContent('Feedback updated');
    expect(first).toHaveTextContent('Body 9');
    expect(within(first).getByText('Today 16:00')).toBeInTheDocument();
    expect(within(unread).getAllByRole('button', { name: 'Mark as read' })).toHaveLength(2);
    expect(within(within(menu).getByRole('list', { name: 'Read' })).getAllByRole('listitem')).toHaveLength(20);
    expect(api.fetchNotifications).toHaveBeenCalledWith(false, 1);
    expect(api.fetchNotifications).toHaveBeenCalledWith(true, 1);
  });

  it('opens from the bell in 200ms on the pop-up\'s strong ease-out, however tall the list is', async () => {
    // A browser that does not ask for reduced motion (jsdom has no matchMedia, which MUI reads as asking).
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    render(<NotificationsMenu />);
    const menu = await openMenu();
    // Opacity over the whole 200ms; the scale over two thirds of it, on the strong ease-out.
    expect(menu.style.transition).toContain('opacity 200ms');
    expect(menu.style.transition).toMatch(/transform 133(\.\d+)?ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    vi.unstubAllGlobals();
  });

  it('rings the badge in the app bar\'s own surface, so it reads as cut out of the bell', async () => {
    render(<NotificationsMenu />);
    const button = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    const badge = button.querySelector('.MuiBadge-badge')!;
    // The colour is a per-scheme CSS variable, which jsdom cannot resolve after the `border` shorthand,
    // so read the badge's own emitted rule.
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    const rules = [...badge.classList].flatMap((c) => css.match(new RegExp(`\\.${c}\\{[^}]*\\}`, 'g')) ?? []);
    expect(rules.join('')).toContain(`border-color:${theme.yungu.header.bg}`);
  });

  it('says so when nothing is unread', async () => {
    serve({ unread: [] });
    render(<NotificationsMenu />);
    const menu = await openMenu();
    expect(await within(menu).findByText('No unread notifications')).toBeInTheDocument();
  });

  it('Mark as read moves the item to Read, lowers the dot and tells Yungu', async () => {
    render(<NotificationsMenu />);
    const menu = await openMenu();
    const unread = within(menu).getByRole('list', { name: 'Unread' });
    await userEvent.click(within(unread).getAllByRole('button', { name: 'Mark as read' })[0]);
    expect(api.markNotificationRead).toHaveBeenCalledWith('9');
    await waitFor(() => expect(within(unread).queryByText('Feedback updated')).toBeNull());
    expect(within(within(menu).getByRole('list', { name: 'Read' })).getAllByRole('listitem')[0]).toHaveTextContent('Feedback updated');
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread', hidden: true })).toBeInTheDocument();
    expect(within(menu).getByRole('heading', { name: 'Unread (1)' })).toBeInTheDocument();
  });

  it('puts the item back and says why when marking fails', async () => {
    api.markNotificationRead.mockRejectedValue(new ApiError(502, "Can't reach Yungu right now. Try again."));
    render(<NotificationsMenu />);
    const menu = await openMenu();
    const unread = within(menu).getByRole('list', { name: 'Unread' });
    await userEvent.click(within(unread).getAllByRole('button', { name: 'Mark as read' })[0]);
    expect(await within(menu).findByRole('alert')).toHaveTextContent("Can't reach Yungu right now. Try again.");
    expect(within(unread).getByText('Feedback updated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread', hidden: true })).toBeInTheDocument();
  });

  it('opening an item about an assignment opens its pop-up here and marks it read', async () => {
    render(<NotificationsMenu />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: 'Feedback updated' }));
    expect(task.openTaskHere).toHaveBeenCalledWith(203);
    expect(api.markNotificationRead).toHaveBeenCalledWith('9');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull());
  });

  it('elsewhere it goes to Assignments with the pop-up open; a read item is not marked again', async () => {
    nav.pathname = '/calendar';
    render(<NotificationsMenu />);
    const menu = await openMenu();
    const read = within(menu).getByRole('list', { name: 'Read' });
    await userEvent.click(within(read).getByRole('button', { name: 'Title 99' }));
    expect(nav.push).toHaveBeenCalledWith('/assignments?task=207');
    expect(task.openTaskHere).not.toHaveBeenCalled();
    expect(api.markNotificationRead).not.toHaveBeenCalled();
  });

  it('items that link nowhere are not buttons', async () => {
    render(<NotificationsMenu />);
    const menu = await openMenu();
    expect(within(menu).queryByRole('button', { name: 'School notice' })).toBeNull();
    expect(within(menu).getByText('School notice')).toBeInTheDocument();
  });

  it('a behaviour record opens the Behaviour page and marks it read', async () => {
    const behaviour = { ...note('7', false, null, 3, 'Behaviour record'), target: 'behaviour' as const };
    serve({ unread: [behaviour] });
    nav.pathname = '/calendar';
    render(<NotificationsMenu />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: 'Behaviour record' }));
    expect(nav.push).toHaveBeenCalledWith('/behaviour');
    expect(api.markNotificationRead).toHaveBeenCalledWith('7');
    expect(task.openTaskHere).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull());
  });

  it('a behaviour record from before the months the page shows opens this month', async () => {
    const ancient = { ...note('5', true, null, 0, 'Behaviour record'), createdAt: 0, target: 'behaviour' as const };
    serve({ unread: [], read: [ancient], more: false });
    render(<NotificationsMenu />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: 'Behaviour record' }));
    expect(nav.push).toHaveBeenCalledWith('/behaviour');
  });

  it("an older behaviour record opens the month it was sent in (China time)", async () => {
    // Sep 30 23:30 China is still September, though UTC (and the test's host clock) say otherwise.
    const late = { ...note('6', true, null, 0, 'Behaviour record'), createdAt: Date.UTC(2026, 8, 30, 15, 30), target: 'behaviour' as const };
    serve({ unread: [], read: [late], more: false });
    render(<NotificationsMenu />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: 'Behaviour record' }));
    expect(nav.push).toHaveBeenCalledWith('/behaviour?month=2026-09');
    expect(api.markNotificationRead).not.toHaveBeenCalled();
  });

  it('loads 20 more read items at a time', async () => {
    render(<NotificationsMenu />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('button', { name: 'Load more' }));
    const read = within(menu).getByRole('list', { name: 'Read' });
    await waitFor(() => expect(within(read).getAllByRole('listitem')).toHaveLength(21));
    expect(api.fetchNotifications).toHaveBeenCalledWith(true, 2);
    expect(within(menu).queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('the app bar Refresh refreshes the count', async () => {
    render(<NotificationsMenu />);
    await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    api.fetchUnreadCount.mockResolvedValue(5);
    await act(async () => refresh.listener?.());
    expect(await screen.findByRole('button', { name: 'Notifications, 5 unread' })).toBeInTheDocument();
  });

  it('checks the count again every 5 minutes, only while the tab is visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    render(<NotificationsMenu />);
    await waitFor(() => expect(api.fetchUnreadCount).toHaveBeenCalledTimes(1));
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(2);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(3);
  });

  it('a failed count leaves the button usable without a dot', async () => {
    api.fetchUnreadCount.mockRejectedValue(new ApiError(502, 'down'));
    render(<NotificationsMenu />);
    await waitFor(() => expect(api.fetchUnreadCount).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeEnabled();
  });
});
