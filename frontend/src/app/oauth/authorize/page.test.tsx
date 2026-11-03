import { render, screen } from '@/components/test-render';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { SessionEnded, YunguUnavailable, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  }),
}));
vi.mock('next/navigation', () => ({ redirect: nav.redirect }));

import AuthorizePage from './page';

const QUERY = {
  response_type: 'code',
  client_id: 'ylc_mock_claude',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  state: 'st',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  resource: 'https://yungu.chihairou.dev/mcp',
};
const page = (query: Record<string, string | string[]> = QUERY) => AuthorizePage({ searchParams: Promise.resolve(query) });

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => null,
    (e: { to?: string }) => e,
  );
  return error?.to ?? '';
}

beforeEach(() => {
  vi.restoreAllMocks();
  nav.redirect.mockClear();
  vi.mocked(getSession).mockResolvedValue({ name: 'Bruce Zheng', token: 't' });
});

describe('the consent page', () => {
  it('signed out: to the sign-in page, which comes back here with the whole request', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const to = await redirectOf(page());
    expect(to.startsWith('/login?next=')).toBe(true);
    const back = decodeURIComponent(to.slice('/login?next='.length));
    expect(back.startsWith('/oauth/authorize?')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(back.split('?')[1]))).toEqual(QUERY);
  });

  it('valid: the exact question, the agent, the return host; response_type passed on', async () => {
    const check = vi.spyOn(data, 'checkAuthorize');
    render(await page());
    expect(check).toHaveBeenCalledWith({ ...QUERY, scope: '' });
    expect(screen.getByRole('heading', { name: 'Connect Claude' })).toBeVisible();
    expect(screen.getByText('claude.ai')).toBeVisible();
    expect(
      screen.getByText("Allow Claude to read your Yungu assignments, schedule, feedback, points and notifications? It can't hand in, comment or change anything."),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeVisible();
  });

  it('an unknown agent: a plain error card with no way back to an unchecked address', async () => {
    render(await page({ ...QUERY, client_id: 'ylc_unknown' }));
    expect(screen.getByRole('heading', { name: 'Can’t connect this agent' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Return to/ })).toBeNull();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/assignments']);
  });

  it('a return address that is not registered: the same, never a redirect', async () => {
    render(await page({ ...QUERY, redirect_uri: 'https://evil.example/cb' }));
    expect(screen.queryByRole('link', { name: /Return to/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain('evil.example');
  });

  it('a request the service refuses with a redirect: the reason and the way back', async () => {
    render(await page({ ...QUERY, code_challenge_method: 'plain' }));
    const back = screen.getByRole('link', { name: 'Return to claude.ai' });
    const url = new URL(back.getAttribute('href')!);
    expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('error')).toBe('invalid_request');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('a field given twice is refused here, without asking the service', async () => {
    const check = vi.spyOn(data, 'checkAuthorize');
    render(await page({ ...QUERY, client_id: ['ylc_mock_claude', 'ylc_other'] }));
    expect(check).not.toHaveBeenCalled();
    expect(screen.getByText(/request isn’t valid/)).toBeVisible();
    expect(screen.queryByRole('link', { name: /Return to/ })).toBeNull();
  });

  it('the session ended on the service: sign in again, coming back here', async () => {
    vi.spyOn(data, 'checkAuthorize').mockRejectedValue(new SessionEnded());
    const to = await redirectOf(page());
    expect(to.startsWith('/api/session/ended?reason=ended&next=%2Foauth%2Fauthorize%3F')).toBe(true);
  });

  it('Yungu or the service down: says so, with no consent to give', async () => {
    vi.spyOn(data, 'checkAuthorize').mockRejectedValue(new YunguUnavailable());
    render(await page());
    expect(screen.getByRole('heading', { name: 'Can’t check this agent right now' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });
});
