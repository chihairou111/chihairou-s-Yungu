import { render, screen } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConsentCard, { AuthorizeProblem } from './ConsentCard';

const PARAMS = {
  response_type: 'code',
  client_id: 'ylc_1',
  redirect_uri: 'https://claude.ai/cb',
  state: 's',
  code_challenge: 'c'.repeat(43),
  code_challenge_method: 'S256',
  scope: '',
  resource: 'https://yungu.chihairou.dev/mcp',
};
const COPY =
  "Allow Claude to read your Yungu assignments, schedule, feedback, points and notifications? It can't hand in, comment or change anything.";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderCard(navigate = vi.fn()) {
  render(<ConsentCard params={PARAMS} client={{ name: 'Claude', redirectHost: 'claude.ai' }} userName="Bruce Zheng" here="/oauth/authorize?x=1" navigate={navigate} />);
  return navigate;
}

describe('ConsentCard', () => {
  it('asks the exact question, names the agent and the host the browser returns to', () => {
    renderCard();
    expect(screen.getByText(COPY)).toBeVisible();
    expect(screen.getByRole('heading', { name: /Claude/ })).toBeVisible();
    expect(screen.getByText('claude.ai')).toBeVisible();
    expect(screen.getByText(/Bruce Zheng/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('Allow sends the request on with the decision and goes where the service says', async () => {
    const fetchMock = stubFetch(200, { redirect: 'https://claude.ai/cb?code=c&state=s' });
    const navigate = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/oauth/approve', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ...PARAMS, decision: 'allow' }) }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://claude.ai/cb?code=c&state=s'));
    expect(screen.getByRole('status')).toHaveTextContent('Returning to claude.ai…');
  });

  it('Deny goes back to the agent with the denial', async () => {
    const fetchMock = stubFetch(200, { redirect: 'https://claude.ai/cb?error=access_denied&state=s' });
    const navigate = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).decision).toBe('deny');
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied&state=s'));
  });

  it('never follows a redirect to a host other than the one it showed', async () => {
    stubFetch(200, { redirect: 'https://evil.example/cb?code=c' });
    const navigate = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });

  it('shows a refusal without a redirect in place, with nowhere to go', async () => {
    stubFetch(400, { error: 'You can connect up to 20 agents. Disconnect one in Agent access first.' });
    const navigate = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You can connect up to 20 agents.');
    expect(screen.queryByRole('link', { name: /Return to/ })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers the way back for a refusal the service gave a redirect for', async () => {
    stubFetch(400, { error: 'No PKCE.', redirect: 'https://claude.ai/cb?error=invalid_request' });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('link', { name: 'Return to claude.ai' })).toHaveAttribute('href', 'https://claude.ai/cb?error=invalid_request');
  });

  it('signs in again (coming back here) when the session ended', async () => {
    stubFetch(401, { error: 'Sign in again.' });
    const navigate = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/api/session/ended?reason=ended&next=${encodeURIComponent('/oauth/authorize?x=1')}`),
    );
  });

  it('says so when the connection drops, and lets the person try again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection. Try again.');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  });
});

describe('AuthorizeProblem', () => {
  it('without a redirect: the reason and a way into the dashboard, never back to the agent', () => {
    render(<AuthorizeProblem error="This agent isn't registered here." />);
    expect(screen.getByRole('heading', { name: 'Can’t connect this agent' })).toBeVisible();
    expect(screen.getByText('This agent isn’t registered here.')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Return to/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Assignments' })).toHaveAttribute('href', '/assignments');
  });

  it('with the service’s redirect: the way back to the agent, naming its host', () => {
    render(<AuthorizeProblem error="No PKCE." redirect="https://claude.ai/cb?error=invalid_request&state=s" />);
    expect(screen.getByRole('link', { name: 'Return to claude.ai' })).toHaveAttribute('href', 'https://claude.ai/cb?error=invalid_request&state=s');
  });

  it('a redirect that is not http(s) is never offered', () => {
    render(<AuthorizeProblem error="No." redirect="javascript:alert(1)" />);
    expect(screen.queryByRole('link', { name: /Return to/ })).toBeNull();
  });
});
