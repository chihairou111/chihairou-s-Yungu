import { render, screen, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentAccessDialog from './AgentAccessDialog';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }) }));

const NOW = Date.now();
const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const fetchMock = vi.fn((url: string, init: RequestInit = {}) => Promise.resolve(handler(url, init)));
const calls = (method: string, url?: string) =>
  fetchMock.mock.calls.filter(([u, init = {}]) => (init.method ?? 'GET') === method && (url === undefined || u === url));

let access: { personal: unknown[]; clients: unknown[] };
const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  access = {
    personal: [{ id: 't1', name: 'Laptop script', createdAt: NOW - 3 * 60_000, lastUsedAt: null }],
    clients: [{ id: 'g1', name: 'Claude', connectedAt: NOW - 3_600_000, lastUsedAt: NOW - 5 * 60_000 }],
  };
  handler = (url, init) => {
    const method = init.method ?? 'GET';
    if (url === '/api/agent/tokens' && method === 'GET') return json(200, access);
    if (url === '/api/agent/tokens' && method === 'POST') {
      const { name } = JSON.parse(String(init.body));
      access = { ...access, personal: [...access.personal, { id: 't2', name, createdAt: NOW, lastUsedAt: null }] };
      return json(201, { id: 't2', name, token: 'ylp_secret_value' });
    }
    if (method === 'DELETE') return json(204, undefined);
    return json(404, { error: 'Not found.' });
  };
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  fetchMock.mockClear();
  writeText.mockClear();
  nav.replace.mockReset();
  vi.unstubAllGlobals();
});

const dialog = () => screen.getByRole('dialog', { name: 'Agent access' });

async function openDialog() {
  const onClose = vi.fn();
  const view = render(<AgentAccessDialog open onClose={onClose} />);
  await screen.findByText('Laptop script');
  return { onClose, ...view };
}

describe('AgentAccessDialog', () => {
  it('says what agents can and cannot do, and gives the server URL to copy', async () => {
    await openDialog();
    expect(dialog()).toHaveTextContent('can’t hand in, comment or change anything');
    expect(within(dialog()).getByText('https://yungu.chihairou.dev/mcp')).toBeVisible();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Copy server URL' }));
    expect(writeText).toHaveBeenCalledWith('https://yungu.chihairou.dev/mcp');
    expect(await within(dialog()).findByRole('status')).toHaveTextContent('Server URL copied');
  });

  it('lists connected agents and personal tokens with when they were last used', async () => {
    await openDialog();
    const agents = within(dialog()).getByRole('list', { name: 'Connected agents' });
    expect(within(agents).getByText('Claude')).toBeVisible();
    expect(agents).toHaveTextContent('Last used 5 min ago');
    const tokens = within(dialog()).getByRole('list', { name: 'Personal tokens' });
    expect(tokens).toHaveTextContent('Laptop script');
    expect(tokens).toHaveTextContent('Created 3 min ago · Never used');
  });

  it('creates a named token and shows it once, to copy', async () => {
    await openDialog();
    await userEvent.type(within(dialog()).getByLabelText('Token name'), 'Desktop');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Create token' }));
    expect(JSON.parse(String(calls('POST', '/api/agent/tokens')[0][1]?.body))).toEqual({ name: 'Desktop' });
    const reveal = await within(dialog()).findByRole('region', { name: 'New token: Desktop' });
    expect(reveal).toHaveTextContent('ylp_secret_value');
    expect(reveal).toHaveTextContent('you won’t see it again');
    await userEvent.click(within(reveal).getByRole('button', { name: 'Copy token' }));
    expect(writeText).toHaveBeenCalledWith('ylp_secret_value');
    expect(await within(dialog()).findByRole('status')).toHaveTextContent('Token copied');
    // The list now holds it (by name; the secret only in the reveal).
    await vi.waitFor(() => expect(within(dialog()).getByRole('list', { name: 'Personal tokens' })).toHaveTextContent('Desktop'));
    expect(within(dialog()).getByRole('list', { name: 'Personal tokens' })).not.toHaveTextContent('ylp_secret_value');
    await userEvent.click(within(reveal).getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(dialog()).not.toHaveTextContent('ylp_secret_value'));
  });

  it("shows the service's refusal of a name (or the cap) by the field", async () => {
    handler = (url, init) =>
      (init.method ?? 'GET') === 'POST' ? json(400, { error: 'You can have up to 20 tokens. Revoke one first.' }) : json(200, access);
    await openDialog();
    await userEvent.type(within(dialog()).getByLabelText('Token name'), 'x');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Create token' }));
    expect(await within(dialog()).findByText('You can have up to 20 tokens. Revoke one first.')).toBeVisible();
    expect(within(dialog()).queryByRole('region', { name: /New token/ })).toBeNull();
  });

  it('revokes a token after asking, and the list loses it', async () => {
    await openDialog();
    const tokens = within(dialog()).getByRole('list', { name: 'Personal tokens' });
    await userEvent.click(within(tokens).getByRole('button', { name: 'Revoke Laptop script' }));
    expect(calls('DELETE')).toHaveLength(0);
    expect(tokens).toHaveTextContent('Agents using it stop working at once.');
    // Changing one's mind keeps it.
    await userEvent.click(within(tokens).getByRole('button', { name: 'Cancel' }));
    expect(calls('DELETE')).toHaveLength(0);
    await userEvent.click(within(tokens).getByRole('button', { name: 'Revoke Laptop script' }));
    access = { ...access, personal: [] };
    await userEvent.click(within(tokens).getByRole('button', { name: 'Revoke' }));
    expect(calls('DELETE', '/api/agent/tokens/t1')).toHaveLength(1);
    await vi.waitFor(() => expect(within(dialog()).queryByText('Laptop script')).toBeNull());
    expect(within(dialog()).getByText('No tokens yet.')).toBeVisible();
  });

  it('disconnects an agent', async () => {
    await openDialog();
    access = { ...access, clients: [] };
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Disconnect Claude' }));
    expect(calls('DELETE', '/api/agent/clients/g1')).toHaveLength(1);
    expect(await within(dialog()).findByText('No agents connected yet.')).toBeVisible();
  });

  it('says when it could not load, and tries again', async () => {
    let fail = true;
    handler = () => (fail ? json(502, { error: "Can't reach Yungu right now. Try again." }) : json(200, access));
    render(<AgentAccessDialog open onClose={vi.fn()} />);
    expect(await within(dialog()).findByText('Couldn’t load agent access.')).toBeVisible();
    fail = false;
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog()).findByText('Laptop script')).toBeVisible();
  });

  it('goes to sign in when the session ended', async () => {
    handler = () => json(401, { error: 'Sign in again.' });
    render(<AgentAccessDialog open onClose={vi.fn()} />);
    await vi.waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'));
  });

  it('closes from its ✕', async () => {
    const { onClose } = await openDialog();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
