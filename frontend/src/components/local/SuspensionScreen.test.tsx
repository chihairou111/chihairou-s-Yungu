import { render, screen, waitFor } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SuspensionScreen, { LocalSuspension } from './SuspensionScreen';
import { installFakeLocal, removeFakeLocal } from './test-local';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, replace: vi.fn() }) }));

afterEach(() => {
  removeFakeLocal();
  nav.refresh.mockReset();
});

describe('SuspensionScreen', () => {
  it('says it is not sending on this network and offers to turn Suspension Mode off, with focus on the button', () => {
    const onTurnOff = vi.fn();
    render(<SuspensionScreen reason="not-allowed" onTurnOff={onTurnOff} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Suspension Mode' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Not sending anything to Yungu on this network.');
    expect(screen.getByRole('button', { name: 'Turn off Suspension Mode' })).toHaveFocus();
  });

  it("says when it can't tell the network (also for a reason it does not know)", () => {
    const { unmount } = render(<SuspensionScreen reason="unknown" onTurnOff={() => undefined} />);
    expect(screen.getByText("Can't tell which network this is.")).toBeInTheDocument();
    expect(screen.queryByText(/Not sending anything/)).not.toBeInTheDocument();
    unmount();
    render(<SuspensionScreen reason="something-new" onTurnOff={() => undefined} />);
    expect(screen.getByText("Can't tell which network this is.")).toBeInTheDocument();
    expect(screen.queryByText(/Not sending anything/)).not.toBeInTheDocument();
  });

  it('is not dismissed by Escape, and keeps Tab inside it', async () => {
    const onTurnOff = vi.fn();
    render(
      <>
        <button>Page button</button>
        <SuspensionScreen reason="unknown" onTurnOff={onTurnOff} />
      </>,
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onTurnOff).not.toHaveBeenCalled();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Turn off Suspension Mode' })).toHaveFocus();
  });
});

describe('LocalSuspension', () => {
  it('shows nothing without the desktop shell', () => {
    render(<LocalSuspension />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the screen while suspended, turns Suspension Mode off from it, and reloads the page data once it goes', async () => {
    const local = installFakeLocal({
      suspension: true,
      allowedNetworks: [{ label: 'School', mac: '80:05:88:d0:83:e2' }],
      suspended: true,
      reason: 'not-allowed',
      mac: 'aa:bb:cc:dd:ee:01',
    });
    render(<LocalSuspension />);
    expect(await screen.findByText('Not sending anything to Yungu on this network.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off Suspension Mode' }));
    expect(local.api.setSuspension).toHaveBeenCalledWith(false);
    expect(nav.refresh).not.toHaveBeenCalled();

    local.emit({ suspension: false, suspended: false, reason: undefined });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('goes away by itself on an allowed network', async () => {
    const school = { label: 'School', mac: '80:05:88:d0:83:e2' };
    const local = installFakeLocal({ suspension: true, allowedNetworks: [school], suspended: true, reason: 'unknown' });
    render(<LocalSuspension />);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    local.emit({ suspended: false, reason: undefined, mac: school.mac });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});
