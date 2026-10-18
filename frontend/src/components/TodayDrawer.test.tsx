import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ClassEvent } from '@/lib/types';
import TodayDrawer, { shouldRevealEdgeButton } from './TodayDrawer';

const HOUR = 3600_000;
const MIN = 60_000;
const MONDAY = Date.UTC(2026, 9, 18, 16, 0); // Mon Oct 19 00:00 China

const classes: ClassEvent[] = [
  { name: 'Chinese I', room: 'D419', start: MONDAY + 8 * HOUR, end: MONDAY + 8 * HOUR + 40 * MIN, isClass: true, courseId: 1 },
  { name: 'H Physics I', room: 'D508', start: MONDAY + 12.5 * HOUR, end: MONDAY + 13 * HOUR + 10 * MIN, isClass: true, courseId: 4 },
];

/** Keyboard focus reveals the edge button (pointer users reveal it by hovering the edge). */
async function openWithKeyboard() {
  await userEvent.tab();
  expect(screen.getByRole('button', { name: "Today's classes" })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
}

describe('TodayDrawer', () => {
  it('starts closed behind a "Today\'s classes" button', () => {
    render(<TodayDrawer events={classes} />);
    const button = screen.getByRole('button', { name: "Today's classes" });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("opens a titled drawer listing today's classes", async () => {
    render(<TodayDrawer events={classes} />);
    await openWithKeyboard();
    const drawer = screen.getByRole('dialog', { name: "Today's classes" });
    expect(within(drawer).getByRole('heading', { name: "Today's classes" })).toBeInTheDocument();
    const items = within(drawer).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Chinese I08:00–08:40 · D419', 'H Physics I12:30–13:10 · D508']);
  });

  it('closes with its close button and with Escape', async () => {
    render(<TodayDrawer events={classes} />);
    const button = screen.getByRole('button', { name: "Today's classes" });
    await openWithKeyboard();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the empty state inside the drawer', async () => {
    render(<TodayDrawer events={[]} />);
    await openWithKeyboard();
    expect(within(screen.getByRole('dialog')).getByText('No classes today')).toBeInTheDocument();
  });
});

describe('shouldRevealEdgeButton', () => {
  it('reveals only within 56px of the right edge and below the app bar', () => {
    expect(shouldRevealEdgeButton(1440 - 56, 400, 1440, 64)).toBe(true);
    expect(shouldRevealEdgeButton(1439, 64, 1440, 64)).toBe(true);
    expect(shouldRevealEdgeButton(1440 - 57, 400, 1440, 64)).toBe(false);
    expect(shouldRevealEdgeButton(1430, 63, 1440, 64)).toBe(false); // over the app bar (account button)
  });
});

describe('TodayDrawer edge reveal', () => {
  const nextFrame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
  const button = () => screen.getByRole('button', { name: "Today's classes" });

  it('renders no element other than the button (nothing overlays the page)', () => {
    const { container } = render(<TodayDrawer events={classes} />);
    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild).toBe(button());
  });

  it('reveals the button when the pointer nears the right edge and hides it when it moves away or leaves', async () => {
    render(<TodayDrawer events={classes} />);
    expect(button()).toHaveAttribute('data-revealed', 'false');

    fireEvent.pointerMove(window, { clientX: window.innerWidth - 20, clientY: 400 });
    await nextFrame();
    expect(button()).toHaveAttribute('data-revealed', 'true');

    fireEvent.pointerMove(window, { clientX: 100, clientY: 400 });
    await nextFrame();
    expect(button()).toHaveAttribute('data-revealed', 'false');

    fireEvent.pointerMove(window, { clientX: window.innerWidth - 20, clientY: 400 });
    await nextFrame();
    fireEvent.pointerLeave(document.documentElement);
    expect(button()).toHaveAttribute('data-revealed', 'false');
  });

  it('does not reveal over the app bar', async () => {
    render(<TodayDrawer events={classes} />);
    fireEvent.pointerMove(window, { clientX: window.innerWidth - 20, clientY: 10 });
    await nextFrame();
    expect(button()).toHaveAttribute('data-revealed', 'false');
  });
});
