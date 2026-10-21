import { render, screen } from '@/components/test-render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { SessionEnded, YunguUnavailable, data } from '@/lib/data';

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/assignments',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  redirect: nav.redirect,
}));
vi.mock('next/cache', () => ({ io: async () => {} }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ name: 'Ada Lovelace', token: 't' })) }));

import AssignmentsPage from './assignments/page';
import BehaviourPage from './behaviour/page';
import CalendarPage from './calendar/page';
import DashboardLayout from './layout';

const UNAVAILABLE = "Can't reach Yungu right now. Try again.";
const PASSWORD_CHANGED = 'Sign in again — your Yungu password may have changed.';
const calendar = () => CalendarPage({ searchParams: Promise.resolve({}) });
const behaviour = (month?: string) => BehaviourPage({ searchParams: Promise.resolve(month === undefined ? {} : { month }) });

afterEach(() => {
  vi.restoreAllMocks();
  nav.redirect.mockClear();
});

describe('dashboard pages when Yungu is unreachable', () => {
  it('Assignments shows the message instead of crashing', async () => {
    vi.spyOn(data, 'getSubmitted').mockRejectedValue(new YunguUnavailable());
    render(await AssignmentsPage());
    expect(screen.getByRole('heading', { level: 2, name: UNAVAILABLE })).toBeVisible();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('Calendar shows the message instead of crashing', async () => {
    vi.spyOn(data, 'getWeek').mockRejectedValue(new YunguUnavailable());
    render(await calendar());
    expect(screen.getByRole('heading', { level: 2, name: UNAVAILABLE })).toBeVisible();
  });

  it('Behaviour shows the message instead of crashing', async () => {
    vi.spyOn(data, 'getBehaviour').mockRejectedValue(new YunguUnavailable());
    render(await behaviour());
    expect(screen.getByRole('heading', { level: 2, name: UNAVAILABLE })).toBeVisible();
    expect(screen.queryByRole('region', { name: /^凌云积分/ })).toBeNull();
  });

  it('shows the same message for any other service failure', async () => {
    vi.spyOn(data, 'getTodo').mockRejectedValue(new YunguUnavailable('Upstream said no'));
    render(await AssignmentsPage());
    expect(screen.getByRole('heading', { level: 2, name: 'Upstream said no' })).toBeVisible();
  });

  it('the layout keeps the shell (app bar, nav, page) and leaves out the classes panel', async () => {
    vi.spyOn(data, 'getCourses').mockRejectedValue(new YunguUnavailable());
    render(await DashboardLayout({ children: <p>page body</p> }));
    expect(screen.getByRole('button', { name: 'Account: Ada Lovelace' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('page body')).toBeVisible();
    expect(screen.queryByRole('button', { name: "Today's classes" })).toBeNull();
  });

  it('pages still render their data in mock mode', async () => {
    render(await AssignmentsPage());
    expect(screen.getAllByRole('tab').length).toBeGreaterThan(0);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });
});

describe('the Behaviour page', () => {
  const NOW = Date.UTC(2026, 9, 21, 1, 30); // Wed Oct 21, 09:30 China

  it('loads this month by default, in China time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 30, 16, 30)); // Oct 1 00:30 China; still Sep 30 in UTC
    const load = vi.spyOn(data, 'getBehaviour');
    render(await behaviour());
    expect(load).toHaveBeenCalledWith('2026-10');
    expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible();
  });

  it('loads the month in ?month, and keeps a future or malformed one to this month', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const load = vi.spyOn(data, 'getBehaviour');
    render(await behaviour('2026-09'));
    expect(load).toHaveBeenLastCalledWith('2026-09');
    expect(screen.getByRole('region', { name: /^凌云积分 \d+$/ })).toBeVisible();
    for (const month of ['2026-12', 'soon']) {
      await behaviour(month);
      expect(load).toHaveBeenLastCalledWith('2026-10');
    }
  });

  it('an empty month still shows Yungu\'s number', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    render(await behaviour('2026-07'));
    expect(screen.getByRole('region', { name: '凌云积分 100' })).toBeVisible();
    expect(screen.getByText('No records in July')).toBeVisible();
  });
});

describe('dashboard pages when the service ends the session', () => {
  it.each([
    ['Assignments', () => AssignmentsPage(), 'getTodo'],
    ['Calendar', calendar, 'getCourses'],
    ['Behaviour', () => behaviour(), 'getBehaviour'],
    ['the layout', () => DashboardLayout({ children: null }), 'getCourses'],
  ] as const)('%s sends the browser to clear the session, carrying the reason', async (_name, run, method) => {
    vi.spyOn(data, method).mockRejectedValue(new SessionEnded(PASSWORD_CHANGED));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(nav.redirect).toHaveBeenCalledWith('/api/session/ended?reason=password');
  });

  it('a plain 401 carries the plain reason', async () => {
    vi.spyOn(data, 'getSubmitted').mockRejectedValue(new SessionEnded());
    await expect(AssignmentsPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(nav.redirect).toHaveBeenCalledWith('/api/session/ended?reason=ended');
  });

  it('the layout still sends a visitor without a session cookie to sign in', async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    await expect(DashboardLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT');
    expect(nav.redirect).toHaveBeenCalledWith('/login');
  });
});
