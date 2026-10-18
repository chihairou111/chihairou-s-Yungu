import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell, { initials } from './AppShell';

const nav = vi.hoisted(() => ({ pathname: '/assignments', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  nav.replace.mockReset();
});

describe('initials', () => {
  it('takes first and last initials of Latin names', () => {
    expect(initials('Bruce Zheng')).toBe('BZ');
    expect(initials('  ada  lovelace byron ')).toBe('AB');
    expect(initials('Bruce')).toBe('B');
  });

  it('uses the first character of a CJK name', () => {
    expect(initials('郑博')).toBe('郑');
  });

  it('falls back to "?" for a blank name', () => {
    expect(initials('  ')).toBe('?');
  });
});

describe('AppShell', () => {
  it('titles the page after the current section', () => {
    nav.pathname = '/calendar';
    render(<AppShell userName="Bruce Zheng">content</AppShell>);
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  it('signs out through the avatar menu', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    render(<AppShell userName="Bruce Zheng">content</AppShell>);

    await userEvent.click(screen.getByRole('button', { name: 'Account: Bruce Zheng' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/session', { method: 'DELETE' });
    expect(nav.replace).toHaveBeenCalledWith('/login');
  });
});
