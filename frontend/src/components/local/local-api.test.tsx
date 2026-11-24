import { render, screen } from '../test-render';
import { afterEach, describe, expect, it } from 'vitest';
import { useLocalState } from './local-api';
import { installFakeLocal, removeFakeLocal } from './test-local';

function Probe() {
  const s = useLocalState();
  return <span data-testid="state">{s === null ? 'none' : JSON.stringify(s)}</span>;
}

afterEach(removeFakeLocal);

describe('useLocalState', () => {
  it('is null without the desktop shell (the hosted web app)', () => {
    render(<Probe />);
    expect(screen.getByTestId('state')).toHaveTextContent('none');
  });

  it("follows the shell's state", async () => {
    const local = installFakeLocal({ suspension: true, allowedNetworks: [{ label: 'School', mac: '80:05:88:d0:83:e2' }] });
    render(<Probe />);
    expect(await screen.findByText(/"allowedNetworks":\[\{"label":"School","mac":"80:05:88:d0:83:e2"\}\]/)).toBeInTheDocument();
    local.emit({ suspended: true, reason: 'not-allowed', mac: 'cc:cc:cc:00:00:01' });
    expect(screen.getByTestId('state')).toHaveTextContent('"suspended":true');
    expect(screen.getByTestId('state')).toHaveTextContent('"mac":"cc:cc:cc:00:00:01"');
  });
});
