import { act, render, screen, waitFor, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appearance } from '@/lib/appearance';
import GearMenu from './GearMenu';
import { HOVER_CLOSE_MS, HOVER_OPEN_MS } from './AppearanceMenu';

const state = vi.hoisted(() => ({ appearance: 'auto' as Appearance, setAppearance: vi.fn() }));
vi.mock('@/lib/useAppearance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/useAppearance')>()),
  useAppearance: () => state,
}));

/** Puts the gear menu's paper at `left` (px from the viewport's left edge), `width` wide, in a `viewport`-wide window. */
function placeMenu(left: number, width: number, viewport = 1024) {
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('MuiPaper-root') ? left : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('MuiPaper-root') ? width : 0;
  });
  vi.stubGlobal('innerWidth', viewport);
}

async function openGear() {
  const user = userEvent.setup();
  render(<GearMenu />);
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const menu = screen.getByRole('menu', { name: 'Settings' });
  const item = within(menu).getByRole('menuitem', { name: 'Appearance' });
  return { user, menu, item };
}

const submenu = () => screen.queryByRole('menu', { name: 'Appearance' });
const popperOf = (el: HTMLElement) => el.closest('[data-popper-placement]');

beforeEach(() => {
  state.appearance = 'auto';
  state.setAppearance.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AppearanceMenu', () => {
  it('opens on hover, after a short pause, with the three choices and the current one checked', async () => {
    state.appearance = 'light';
    const { user, item } = await openGear();
    expect(item).toHaveAttribute('aria-haspopup', 'menu');
    expect(item).toHaveAttribute('aria-expanded', 'false');
    await user.hover(item);
    // Not at once: passing over the item on the way elsewhere does not flash the submenu.
    expect(submenu()).not.toBeInTheDocument();
    const sub = await screen.findByRole('menu', { name: 'Appearance' });
    expect(item).toHaveAttribute('aria-expanded', 'true');
    const options = within(sub).getAllByRole('menuitemradio');
    expect(options.map((o) => o.textContent)).toEqual(['Automatic', 'Light', 'Dark']);
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    // Opened by the pointer, focus stays on the parent item.
    expect(item).toHaveFocus();
    expect(HOVER_OPEN_MS).toBeGreaterThanOrEqual(100);
    expect(HOVER_OPEN_MS).toBeLessThanOrEqual(150);
  });

  it('opens to the left near the right edge: ArrowLeft in, ArrowRight and Escape back to Appearance', async () => {
    placeMenu(780, 220);
    state.appearance = 'dark';
    const { user, item, menu } = await openGear();
    expect(item).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    const sub = await screen.findByRole('menu', { name: 'Appearance' });
    expect(popperOf(sub)).toHaveAttribute('data-popper-placement', expect.stringMatching(/^left/));
    await waitFor(() => expect(within(sub).getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus());
    await user.keyboard('{ArrowUp}');
    expect(within(sub).getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(submenu()).not.toBeInTheDocument());
    expect(item).toHaveFocus();

    await user.keyboard('{Enter}');
    await screen.findByRole('menu', { name: 'Appearance' });
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(submenu()).not.toBeInTheDocument());
    // Escape leaves only the submenu: the gear menu stays open on Appearance.
    expect(menu).toBeInTheDocument();
    expect(item).toHaveFocus();
  });

  it('opens to the right when there is no room on the left: ArrowRight in, ArrowLeft back', async () => {
    placeMenu(8, 220);
    const { user, item } = await openGear();
    await user.keyboard('{ArrowLeft}');
    expect(submenu()).not.toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    const sub = await screen.findByRole('menu', { name: 'Appearance' });
    expect(popperOf(sub)).toHaveAttribute('data-popper-placement', expect.stringMatching(/^right/));
    await waitFor(() => expect(within(sub).getByRole('menuitemradio', { name: 'Automatic' })).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(submenu()).not.toBeInTheDocument());
    expect(item).toHaveFocus();
  });

  it('opens below Appearance on a phone, where neither side has room', async () => {
    placeMenu(150, 220, 390);
    const { user } = await openGear();
    await user.keyboard('{Enter}');
    const sub = await screen.findByRole('menu', { name: 'Appearance' });
    expect(popperOf(sub)).toHaveAttribute('data-popper-placement', expect.stringMatching(/^bottom/));
  });

  it('choosing Dark sets it and closes both menus', async () => {
    const { user, item } = await openGear();
    await user.hover(item);
    const sub = await screen.findByRole('menu', { name: 'Appearance' });
    await user.click(within(sub).getByRole('menuitemradio', { name: 'Dark' }));
    expect(state.setAppearance).toHaveBeenCalledWith('dark');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('a tap toggles the submenu (touch has no hover)', async () => {
    const { user, item } = await openGear();
    await user.pointer({ keys: '[TouchA]', target: item });
    await screen.findByRole('menu', { name: 'Appearance' });
    await user.pointer({ keys: '[TouchA]', target: item });
    await waitFor(() => expect(submenu()).not.toBeInTheDocument());
  });

  it('a click opens it and keeps it open (a mouse that already opened it by hovering)', async () => {
    const { user, item } = await openGear();
    await user.hover(item);
    await screen.findByRole('menu', { name: 'Appearance' });
    await user.click(item);
    await act(() => new Promise((r) => setTimeout(r, HOVER_CLOSE_MS + 50)));
    expect(submenu()).toBeInTheDocument();
  });

  it('stays open while the pointer crosses to it (even over another item) and closes once the pointer stays away', async () => {
    const user = userEvent.setup();
    render(
      <GearMenu>
        <li role="menuitem" tabIndex={-1}>
          Other
        </li>
      </GearMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const item = screen.getByRole('menuitem', { name: 'Appearance' });
    await user.hover(item);
    const sub = await screen.findByRole('menu', { name: 'Appearance' });
    // A diagonal path: off Appearance, across the next item, into the submenu.
    await user.hover(screen.getByRole('menuitem', { name: 'Other' }));
    await user.hover(within(sub).getByRole('menuitemradio', { name: 'Light' }));
    await act(() => new Promise((r) => setTimeout(r, HOVER_CLOSE_MS + 50)));
    expect(submenu()).toBeInTheDocument();
    // Off the submenu onto another item, and staying there: it closes.
    await user.hover(screen.getByRole('menuitem', { name: 'Other' }));
    await waitFor(() => expect(submenu()).not.toBeInTheDocument());
    expect(screen.getByRole('menu', { name: 'Settings' })).toBeInTheDocument();
  });
});
