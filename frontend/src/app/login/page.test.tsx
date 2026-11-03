import { render, screen } from '@/components/test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({ notice: undefined as string | undefined }));
const nav = vi.hoisted(() => ({ replace: vi.fn(), assign: vi.fn() }));
vi.mock('@/lib/assign-location', () => ({ assignLocation: nav.assign }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'yl_signin_notice' && jar.notice ? { name, value: jar.notice } : undefined) }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }) }));
vi.mock('next/cache', () => ({ io: async () => {} }));

import LoginPage from './page';

const page = (query: Record<string, string | string[]> = {}) => ({ searchParams: Promise.resolve(query) });

async function signIn() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  await userEvent.type(screen.getByLabelText('Student ID'), 's123');
  await userEvent.type(screen.getByLabelText('Password'), 'pw');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('the sign-in page', () => {
  it('says why the last session ended', async () => {
    jar.notice = 'password';
    render(await LoginPage(page()));
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in again — your Yungu password may have changed.');
    jar.notice = 'ended';
    render(await LoginPage(page()));
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent(/^Sign in again\.$/);
  });

  it('shows no notice without one, or for a value that is not ours', async () => {
    for (const notice of [undefined, 'Call 555 now']) {
      jar.notice = notice;
      const { unmount } = render(await LoginPage(page()));
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      unmount();
    }
  });

  it('starts a fresh form on every visit, though the router keeps the last one mounted', async () => {
    // Signed in from here before: the router shows the same instance again on the next visit.
    jar.notice = undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { rerender } = render(await LoginPage(page()));
    await userEvent.type(screen.getByLabelText('Student ID'), 's123');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    jar.notice = 'password';
    rerender(await LoginPage(page()));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByLabelText('Student ID')).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in again — your Yungu password may have changed.');
    vi.unstubAllGlobals();
  });
});

describe('coming back after signing in', () => {
  it('returns to a safe relative next', async () => {
    jar.notice = undefined;
    render(await LoginPage(page({ next: '/oauth/authorize?client_id=ylc_1&state=s' })));
    await signIn();
    await vi.waitFor(() => expect(nav.assign).toHaveBeenCalledWith('/oauth/authorize?client_id=ylc_1&state=s'));
    vi.unstubAllGlobals();
  });

  it.each([['https://evil.example/x'], ['//evil.example'], ['/\\evil.example'], ['javascript:alert(1)'], [['/a', '/b']]])(
    'goes to Assignments instead of %s',
    async (next) => {
      nav.replace.mockReset();
      render(await LoginPage(page({ next })));
      await signIn();
      await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/assignments'));
      vi.unstubAllGlobals();
    },
  );
});
