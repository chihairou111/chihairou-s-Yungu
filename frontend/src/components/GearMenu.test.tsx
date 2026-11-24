import { render, screen, waitFor, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import MenuItem from '@mui/material/MenuItem';
import GearMenu, { useCloseGearMenu } from './GearMenu';

function ClosingItem() {
  const close = useCloseGearMenu();
  return <MenuItem onClick={close}>Opens a dialog</MenuItem>;
}

describe('GearMenu', () => {
  it('lets an item close the whole menu (useCloseGearMenu)', async () => {
    const user = userEvent.setup();
    render(
      <GearMenu>
        <ClosingItem />
      </GearMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('menuitem', { name: 'Opens a dialog' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('is a Settings button that opens a menu with Appearance first, then what it is given', async () => {
    const user = userEvent.setup();
    render(
      <GearMenu>
        <MenuItem>Suspension Mode</MenuItem>
      </GearMenu>,
    );
    const gear = screen.getByRole('button', { name: 'Settings' });
    expect(gear).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(gear);
    expect(gear).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Settings' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Appearance', 'Suspension Mode']);
    expect(within(menu).getByRole('menuitem', { name: 'Appearance' })).toHaveFocus();
  });

  it('holds only Appearance on its own (the hosted site)', async () => {
    const user = userEvent.setup();
    render(<GearMenu />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(within(screen.getByRole('menu', { name: 'Settings' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Appearance',
    ]);
  });

  it('closes on Escape, back on the gear', async () => {
    const user = userEvent.setup();
    render(<GearMenu />);
    const gear = screen.getByRole('button', { name: 'Settings' });
    await user.click(gear);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(gear).toHaveFocus();
  });
});
