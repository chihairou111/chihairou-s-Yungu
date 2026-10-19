import { act, fireEvent, render, screen, waitFor, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassEvent, Course } from '@/lib/types';
import StyleProvider from './StyleProvider';
import TodayDrawer, { DOCK_QUERY, shouldRevealEdgeButton } from './TodayDrawer';

const HOUR = 3600_000;
const MIN = 60_000;
const MONDAY = Date.UTC(2026, 9, 18, 16, 0); // Mon Oct 19 00:00 China

const NOW = MONDAY + 10 * HOUR; // Mon Oct 19 10:00 China
const COURSES: Course[] = [
  { id: 1, name: 'Chinese I', color: 'Tomato' },
  { id: 4, name: 'H Physics I', color: 'Peacock' },
];

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
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    const button = screen.getByRole('button', { name: "Today's classes" });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("opens a titled drawer listing today's classes", async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    await openWithKeyboard();
    const drawer = screen.getByRole('dialog', { name: "Today's classes" });
    expect(within(drawer).getByRole('heading', { name: "Today's classes" })).toBeInTheDocument();
    const items = within(drawer).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Chinese I08:00–08:40 · D419', 'NextH Physics I12:30–13:10 · D508']);
  });

  it("dates the drawer under its title", async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    await openWithKeyboard();
    expect(within(screen.getByRole('dialog')).getByText('Mon, Oct 19')).toBeInTheDocument();
  });

  it('closes with its close button and with Escape', async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
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
    render(<TodayDrawer events={[]} now={NOW} courses={COURSES} />);
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

  it('with the panel open, reveals over the panel and just left of its edge, below the page header', () => {
    const reach = 344 + 28;
    expect(shouldRevealEdgeButton(1440 - 344 - 20, 400, 1440, 112, reach)).toBe(true);
    expect(shouldRevealEdgeButton(1430, 400, 1440, 112, reach)).toBe(true);
    expect(shouldRevealEdgeButton(1440 - 344 - 40, 400, 1440, 112, reach)).toBe(false); // the content
    expect(shouldRevealEdgeButton(1300, 100, 1440, 112, reach)).toBe(false); // the header band
  });
});

describe('TodayDrawer edge reveal', () => {
  afterEach(() => {
    // Drop the per-test stub so jsdom's own clientWidth getter applies again.
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });

  /** A classic scrollbar: the layout viewport is narrower than window.innerWidth. */
  function stubClientWidth(width: number) {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: width, configurable: true });
  }

  const nextFrame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
  const button = () => screen.getByRole('button', { name: "Today's classes" });

  it('renders only the button and the closed, inert panel (nothing overlays the page)', () => {
    const { container } = render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    expect(container.childElementCount).toBe(2);
    expect(container.firstElementChild).toBe(button());
    const panel = container.lastElementChild as HTMLElement;
    expect(panel.tagName).toBe('ASIDE');
    expect(panel).toHaveAttribute('data-open', 'false');
    expect(panel).toHaveAttribute('inert');
  });

  it('reveals the button when the pointer nears the right edge and hides it when it moves away or leaves', async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    expect(button()).toHaveAttribute('data-revealed', 'false');

    stubClientWidth(window.innerWidth);
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

  it('measures the zone from the layout viewport, not past a classic scrollbar', async () => {
    stubClientWidth(window.innerWidth - 17);
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    // 50px from the content edge, 67px from the window edge: inside the zone only if the scrollbar is excluded.
    fireEvent.pointerMove(window, { clientX: window.innerWidth - 17 - 50, clientY: 400 });
    await nextFrame();
    expect(button()).toHaveAttribute('data-revealed', 'true');
  });

  it('stays revealed while the pointer is over the button itself', async () => {
    stubClientWidth(window.innerWidth);
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    fireEvent.pointerMove(button(), { clientX: 0, clientY: 400 });
    await nextFrame();
    expect(button()).toHaveAttribute('data-revealed', 'true');
  });

  it('stays revealed while it has focus, e.g. after the drawer closes by mouse', async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    expect(button()).toHaveAttribute('data-focused', 'false');
    act(() => button().focus());
    expect(button()).toHaveAttribute('data-focused', 'true');
    act(() => button().blur());
    expect(button()).toHaveAttribute('data-focused', 'false');
  });

  it('does not reveal over the app bar', async () => {
    stubClientWidth(window.innerWidth);
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    fireEvent.pointerMove(window, { clientX: window.innerWidth - 20, clientY: 10 });
    await nextFrame();
    expect(button()).toHaveAttribute('data-revealed', 'false');
  });
});

/** Simulates the window width: docked panel from 900px, temporary drawer below. */
function stubWidth(docked: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === DOCK_QUERY ? docked : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function clearPanelCookie() {
  document.cookie = 'yl_today_panel=; Max-Age=0; Path=/';
}

describe('TodayDrawer docked panel (900px and up)', () => {
  beforeEach(() => {
    stubWidth(true);
    clearPanelCookie();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPanelCookie();
  });

  const toggle = () => screen.getByRole('button', { name: "Today's classes" });
  const panel = () => document.querySelector('aside') as HTMLElement;
  /** Keyboard, as the edge button only takes the pointer once revealed (jsdom applies no :hover/media). */
  async function press(button: HTMLElement) {
    act(() => button.focus());
    await userEvent.keyboard('{Enter}');
  }

  it('is a closed panel by default, controlled by the toggle', () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    expect(panel()).toHaveAttribute('data-open', 'false');
    expect(panel()).toHaveAttribute('inert');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveAttribute('aria-controls', panel().id);
  });

  it('renders open from the stored state as a labelled complementary region of the page', () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    const region = screen.getByRole('complementary', { name: "Today's classes" });
    expect(region).toBe(panel());
    expect(region).toHaveAttribute('data-open', 'true');
    expect(region).not.toHaveAttribute('inert');
    // No title row: the cards start at the top; the region keeps its accessible name.
    expect(within(region).queryByRole('heading', { name: "Today's classes" })).not.toBeInTheDocument();
    expect(within(region).queryByText('Mon, Oct 19')).not.toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
    expect(region.firstElementChild?.firstElementChild?.tagName).toBe('OL');
    expect(within(region).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Chinese I08:00–08:40 · D419',
      'NextH Physics I12:30–13:10 · D508',
    ]);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    // Part of the page: no dialog, no backdrop.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('server-renders the stored state, so a reload shows the panel without a flash', () => {
    const html = (open: boolean) =>
      renderToString(
        <StyleProvider initialStyle="expressive">
          <TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen={open} />
        </StyleProvider>,
      );
    const open = html(true);
    expect(open).toMatch(/<aside[^>]*data-open="true"/);
    expect(open).toMatch(/aria-label="Today&#x27;s classes"[^>]*aria-expanded="true"|aria-expanded="true"[^>]*aria-label="Today&#x27;s classes"/);
    expect(open).toContain('H Physics I');
    const closed = html(false);
    expect(closed).toMatch(/<aside[^>]*data-open="false"/);
    expect(closed).toMatch(/<aside[^>]*inert=""/);
  });

  it('the toggle opens the panel in place, keeps focus and stores open; again closes and stores closed', async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    await press(toggle());
    expect(panel()).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('complementary', { name: "Today's classes" })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveFocus();
    expect(document.cookie).toContain('yl_today_panel=open');

    await press(toggle());
    expect(panel()).toHaveAttribute('data-open', 'false');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.cookie).toContain('yl_today_panel=closed');
  });

  it('hovering the open panel reveals the edge button on its left edge, which closes it', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1440, configurable: true });
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    expect(toggle()).toHaveAttribute('data-revealed', 'false');
    fireEvent.pointerMove(window, { clientX: 1300, clientY: 400 });
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(toggle()).toHaveAttribute('data-revealed', 'true');
    await userEvent.click(toggle());
    expect(panel()).toHaveAttribute('data-open', 'false');
    expect(panel()).toHaveAttribute('inert');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.cookie).toContain('yl_today_panel=closed');
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });

});

describe('TodayDrawer below 900px', () => {
  beforeEach(() => {
    stubWidth(false);
    clearPanelCookie();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPanelCookie();
  });

  it('opens the temporary drawer even when the stored state is open, and leaves the cookie alone', async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    const button = screen.getByRole('button', { name: "Today's classes" });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    act(() => button.focus());
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: "Today's classes" })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.cookie).not.toContain('yl_today_panel');
  });
});
