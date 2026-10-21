import { act, fireEvent, render, screen, waitFor, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassEvent, Course } from '@/lib/types';
import ThemeRegistry from './ThemeRegistry';
import { DOCK_MIN_PX } from './PageHeader';
import TodayDrawer, { DOCK_QUERY, shouldRevealEdgeButton } from './TodayDrawer';

// These scenarios pass their moment as `now`; following the device clock is useNow's own test.
vi.mock('./useNow', () => ({ useNow: (initial: number) => initial }));

const nav = vi.hoisted(() => ({ pathname: '/assignments' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

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

/** Simulates the window width: docked panel from 1200px, temporary drawer below. */
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

describe('TodayDrawer docked panel (1200px and up)', () => {
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

  it('decelerates in and accelerates out, leaving a little faster than it arrives', () => {
    const { unmount } = render(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    // Emphasized decelerate (fast start): the panel answers the click at once rather than easing in.
    const curve = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
    // Leaving uses emphasized accelerate, so the panel is gone about when the content reclaims the space.
    const out = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
    expect(getComputedStyle(panel()).transition).toBe(`transform 225ms ${curve}`);
    unmount();
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    expect(getComputedStyle(panel()).transition).toMatch(new RegExp(`^transform 195ms ${out.replace(/[()]/g, "\\$&")}, ?visibility 0s linear 195ms$`));
  });

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
    // The title and date live inside the panel's scrolling body, above the cards (no separate title bar).
    const heading = within(region).getByRole('heading', { name: "Today's classes" });
    expect(region).toHaveAttribute('aria-labelledby', heading.id);
    expect(within(region).getByText('Mon, Oct 19')).toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
    expect(heading.closest('[data-today-panel-body]')).not.toBeNull();
    expect(within(region).getByRole('list').closest('[data-today-panel-body]')).toBe(heading.closest('[data-today-panel-body]'));
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
        <ThemeRegistry>
          <TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen={open} />
        </ThemeRegistry>,
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

  it('takes its space from the content at once when opening, and gives it back only once it has slid out', async () => {
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} />);
    expect(panel()).toHaveAttribute('data-takes-space', 'false');
    await press(toggle());
    expect(panel()).toHaveAttribute('data-takes-space', 'true');

    await press(toggle());
    expect(panel()).toHaveAttribute('data-open', 'false');
    expect(panel()).toHaveAttribute('data-takes-space', 'true');
    fireEvent.transitionEnd(panel(), { propertyName: 'transform' });
    expect(panel()).toHaveAttribute('data-takes-space', 'false');
  });

  it('gives the space back at once when motion is reduced (no slide, so no transitionend)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === DOCK_QUERY || query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    expect(panel()).toHaveAttribute('data-takes-space', 'true');
    await press(toggle());
    expect(panel()).toHaveAttribute('data-takes-space', 'false');
  });
});

describe('TodayDrawer after the last class', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tuesday: ClassEvent = { ...classes[0], name: 'Algebra II', start: classes[0].start + 24 * HOUR, end: classes[0].end + 24 * HOUR };

  it("shows the next school day's classes once today's are over", async () => {
    render(<TodayDrawer events={[...classes, tuesday]} now={MONDAY + 21 * HOUR} courses={COURSES} />);
    await openWithKeyboard();
    const drawer = screen.getByRole('dialog', { name: "Today's classes" });
    // The title says the day is done where it dated today; the next day's date heads its list.
    expect(within(drawer).getByText('Done for today')).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: 'Tomorrow · Tue, Oct 20' })).toBeInTheDocument();
    expect(within(drawer).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['NextAlgebra II08:00–08:40 · D419']);
  });

  it("says the day is done in place of today's date once it shows another day, so only the shown day is dated", async () => {
    stubWidth(true);
    render(<TodayDrawer events={[...classes, tuesday]} now={MONDAY + 21 * HOUR} courses={COURSES} initialPanelOpen />);
    const panel = screen.getByRole('complementary');
    expect(within(panel).queryByText('Mon, Oct 19')).not.toBeInTheDocument();
    expect(within(panel).getByText('Done for today')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Tomorrow · Tue, Oct 20' })).toBeInTheDocument();
  });

  it('in the drawer, too', async () => {
    render(<TodayDrawer events={[...classes, tuesday]} now={MONDAY + 21 * HOUR} courses={COURSES} />);
    await openWithKeyboard();
    expect(within(screen.getByRole('dialog')).queryByText('Mon, Oct 19')).not.toBeInTheDocument();
  });

  it('on a day without classes, says "No classes today" above the next school day', async () => {
    render(<TodayDrawer events={[tuesday]} now={MONDAY + 21 * HOUR} courses={COURSES} />);
    await openWithKeyboard();
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('No classes today')).toBeInTheDocument();
    expect(within(drawer).queryByText('Done for today')).not.toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: 'Tomorrow · Tue, Oct 20' })).toBeInTheDocument();
  });

  it("lists only today's classes during the day", async () => {
    render(<TodayDrawer events={[...classes, tuesday]} now={NOW} courses={COURSES} />);
    await openWithKeyboard();
    expect(within(screen.getByRole('dialog')).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('TodayDrawer on the calendar', () => {
  afterEach(() => {
    nav.pathname = '/assignments';
    document.cookie = 'yl_today_panel=; Max-Age=0; Path=/';
  });

  it('renders neither the panel nor its button on /calendar, and leaves the stored state for other pages', () => {
    stubWidth(true);
    document.cookie = 'yl_today_panel=open; Path=/';
    nav.pathname = '/calendar';
    const { container, rerender } = render(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: "Today's classes" })).not.toBeInTheDocument();
    expect(document.cookie).toContain('yl_today_panel=open');

    nav.pathname = '/assignments';
    rerender(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    expect(screen.getByRole('complementary', { name: "Today's classes" })).toHaveAttribute('data-open', 'true');
    vi.unstubAllGlobals();
  });
  it('does not leave the content narrowed when the calendar opens mid slide-out', async () => {
    stubWidth(true);
    const { rerender } = render(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    act(() => screen.getByRole('button', { name: "Today's classes" }).focus());
    await userEvent.keyboard('{Enter}');
    expect(document.querySelector('aside')).toHaveAttribute('data-takes-space', 'true');
    nav.pathname = '/calendar';
    rerender(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    nav.pathname = '/assignments';
    rerender(<TodayDrawer events={classes} now={NOW} courses={COURSES} initialPanelOpen />);
    expect(document.querySelector('aside')).toHaveAttribute('data-open', 'false');
    expect(document.querySelector('aside')).toHaveAttribute('data-takes-space', 'false');
    vi.unstubAllGlobals();
  });
});

describe('TodayDrawer dock breakpoint', () => {
  it('docks from 1200px', () => {
    expect(DOCK_MIN_PX).toBe(1200);
    expect(DOCK_QUERY).toBe('(min-width: 1200px)');
  });
});

describe('TodayDrawer below 1200px', () => {
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
