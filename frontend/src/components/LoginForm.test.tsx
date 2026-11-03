import { render, screen } from './test-render';
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

  it('goes back to the page that sent it here (an agent\'s consent page) when given one', async () => {
    stubFetch(200, { name: 'Bruce Zheng' });
    render(<LoginForm next="/oauth/authorize?client_id=ylc_1" />);
    await userEvent.type(screen.getByLabelText('Student ID'), 's123');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/oauth/authorize?client_id=ylc_1'));
  });

  it('explains a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection/i);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("shows Yungu being unreachable as a sign-in error", async () => {
    stubFetch(401, { error: "Can't reach Yungu right now. Try again." });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText('Student ID'), 's123');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Yungu right now. Try again.");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('shows why the last session ended, without marking the empty fields as wrong', () => {
    render(<LoginForm notice="Sign in again — your Yungu password may have changed." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in again — your Yungu password may have changed.');
    expect(screen.getByLabelText('Student ID')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'false');
  });

  it('replaces the notice with the outcome of the next attempt', async () => {
    stubFetch(401, { error: 'Wrong student ID or password.' });
    render(<LoginForm notice="Sign in again." />);
    await userEvent.type(screen.getByLabelText('Student ID'), 's123');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wrong student ID or password.'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText('Sign in again.')).toBeNull();
  });
});
