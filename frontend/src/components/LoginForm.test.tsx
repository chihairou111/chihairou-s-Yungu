import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginForm from './LoginForm';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  nav.replace.mockReset();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LoginForm', () => {
  it('shows the server error for blank fields and stays on the page', async () => {
    stubFetch(400, { error: 'Enter your student ID and password.' });
    render(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your student ID and password.');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('posts the credentials and goes to Assignments on success', async () => {
    const fetchMock = stubFetch(200, { name: 'Bruce Zheng' });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Student ID'), 's123');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ loginId: 's123', password: 'pw' }) }),
    );
    await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/assignments'));
  });

  it('explains a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
