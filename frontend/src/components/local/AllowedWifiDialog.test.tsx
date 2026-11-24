import { render, screen, within } from '../test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AllowedWifiDialog from './AllowedWifiDialog';

function setUp(props: { allowedWifi?: string[]; ssid?: string } = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<AllowedWifiDialog open allowedWifi={props.allowedWifi ?? []} ssid={props.ssid} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose, dialog: screen.getByRole('dialog', { name: 'Allowed Wi-Fi' }) };
}

describe('AllowedWifiDialog', () => {
  it('lists the allowed names, each with a Remove button', async () => {
    const { onChange, dialog } = setUp({ allowedWifi: ['School', 'Home'] });
    const items = within(dialog).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['School', 'Home']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove School' }));
    expect(onChange).toHaveBeenCalledWith(['Home']);
  });

  it('adds a typed name (trimmed), with the button or Enter, and clears the field', async () => {
    const { onChange, dialog } = setUp({ allowedWifi: ['School'] });
    const field = within(dialog).getByLabelText('Wi-Fi name');
    const add = within(dialog).getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    await userEvent.type(field, '  Library 5G ');
    await userEvent.click(add);
    expect(onChange).toHaveBeenLastCalledWith(['School', 'Library 5G']);
    expect(field).toHaveValue('');
    await userEvent.type(field, 'Cafe{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['School', 'Cafe']);
  });

  it('does not add a name already listed', async () => {
    const { onChange, dialog } = setUp({ allowedWifi: ['School'] });
    await userEvent.type(within(dialog).getByLabelText('Wi-Fi name'), 'School');
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers "Add current Wi-Fi" only on a named Wi-Fi not yet listed', async () => {
    const first = setUp({ allowedWifi: ['School'], ssid: 'Home' });
    await userEvent.click(within(first.dialog).getByRole('button', { name: 'Add current Wi-Fi' }));
    expect(first.onChange).toHaveBeenCalledWith(['School', 'Home']);
  });

  it('hides "Add current Wi-Fi" when the current Wi-Fi is listed or unknown', () => {
    const { unmount } = render(<AllowedWifiDialog open allowedWifi={['School']} ssid="School" onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add current Wi-Fi' })).not.toBeInTheDocument();
    unmount();
    render(<AllowedWifiDialog open allowedWifi={['School']} onChange={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Add current Wi-Fi' })).not.toBeInTheDocument();
  });

  it('closes with Done', async () => {
    const { onClose, dialog } = setUp();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
