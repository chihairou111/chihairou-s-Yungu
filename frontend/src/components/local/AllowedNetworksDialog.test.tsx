import { render, screen, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AllowedNetworksDialog, { type AllowedNetwork } from './AllowedNetworksDialog';

const SCHOOL: AllowedNetwork = { label: 'School', mac: '80:05:88:d0:83:e2' };
const HOME: AllowedNetwork = { label: 'Home', mac: 'aa:bb:cc:dd:ee:01' };
const CAFE_MAC = 'cc:cc:cc:00:00:01';

function setUp(props: { allowedNetworks?: AllowedNetwork[]; mac?: string } = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <AllowedNetworksDialog open allowedNetworks={props.allowedNetworks ?? []} mac={props.mac} onChange={onChange} onClose={onClose} />,
  );
  return { onChange, onClose, dialog: screen.getByRole('dialog', { name: 'Allowed networks' }) };
}

describe('AllowedNetworksDialog', () => {
  it('lists the allowed networks by label, each with a Remove button', async () => {
    const { onChange, dialog } = setUp({ allowedNetworks: [SCHOOL, HOME] });
    const items = within(dialog).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('School')).toBeInTheDocument();
    expect(within(items[1]).getByText('Home')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove School' }));
    expect(onChange).toHaveBeenCalledWith([HOME]);
  });

  it('says when nothing is allowed yet', () => {
    const { dialog } = setUp();
    expect(within(dialog).getByText('No networks allowed yet.')).toBeInTheDocument();
  });

  it('adds the current network with a label (trimmed), by the button or Enter, and clears the field', async () => {
    const { onChange, dialog } = setUp({ allowedNetworks: [SCHOOL], mac: CAFE_MAC });
    const field = within(dialog).getByLabelText('Label');
    const add = within(dialog).getByRole('button', { name: 'Add current network' });
    expect(add).toBeDisabled(); // a label is needed
    await userEvent.type(field, '   ');
    expect(add).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '  Library café ');
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(onChange).toHaveBeenLastCalledWith([SCHOOL, { label: 'Library café', mac: CAFE_MAC }]);
    expect(field).toHaveValue('');
  });

  it('adds with Enter too', async () => {
    const { onChange, dialog } = setUp({ mac: CAFE_MAC });
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Cafe{Enter}');
    expect(onChange).toHaveBeenCalledWith([{ label: 'Cafe', mac: CAFE_MAC }]);
  });

  it('cannot add when the current network is unknown (no router read)', async () => {
    const { onChange, dialog } = setUp({ allowedNetworks: [SCHOOL] });
    expect(within(dialog).getByLabelText('Label')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Add current network' })).toBeDisabled();
    expect(within(dialog).getByText(/Connect to the Wi-Fi you want to allow/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says which label the current network has when it is already allowed, and offers no add', () => {
    const { dialog } = setUp({ allowedNetworks: [SCHOOL, HOME], mac: HOME.mac });
    expect(within(dialog).getByText('This network is allowed as “Home”.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Add current network' })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Label')).not.toBeInTheDocument();
  });

  it('closes with Done', async () => {
    const { onClose, dialog } = setUp();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
