import { render, screen, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@mui/material/styles';
import AppShell, { initials } from './AppShell';
import PageHeader from './PageHeader';
import StyleProvider from './StyleProvider';

const nav = vi.hoisted(() => ({ pathname: '/assignments', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace }),
}));

afterEach(() => {
  document.cookie = 'yl_style=; Max-Age=0; Path=/';
  vi.unstubAllGlobals();
  nav.replace.mockReset();
});

describe('initials', () => {
  it('takes first and last initials of Latin names', () => {
    expect(initials('Bruce Zheng')).toBe('BZ');
    expect(initials('  ada  lovelace byron ')).toBe('AB');
    expect(initials('Bruce')).toBe('B');
  });

  it('uses the first character of a CJK name', () => {
    expect(initials('郑博')).toBe('郑');
  });

  it('falls back to "?" for a blank name', () => {
    expect(initials('  ')).toBe('?');
  });
});

describe('AppShell', () => {
  it('titles the page after the current section', () => {
    nav.pathname = '/calendar';
    render(<AppShell userName="Bruce Zheng">content</AppShell>);
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  it('hosts the Today\'s classes panel on every page, beside the content rather than inside it', () => {
    for (const pathname of ['/assignments', '/calendar']) {
      nav.pathname = pathname;
      const { unmount } = render(
        <AppShell userName="Bruce Zheng" panel={<aside aria-label="Today's classes" data-today-panel="" data-open="true" />}>
          content
        </AppShell>,
      );
      const panel = screen.getByRole('complementary', { name: "Today's classes" });
      expect(screen.getByRole('main').contains(panel)).toBe(false);
      unmount();
    }
    nav.pathname = '/assignments';
  });

  it('never animates the content, header or toolbar padding and margins as the panel slides (they change once)', () => {
    render(
      <AppShell userName="Bruce Zheng">
        <PageHeader>tabs</PageHeader>
      </AppShell>,
    );
    const header = document.querySelector('[data-page-header]') as HTMLElement;
    const animated = [screen.getByRole('main'), header, screen.getByRole('banner').firstElementChild as HTMLElement];
    for (const el of animated) {
      const { transition } = getComputedStyle(el);
      expect(transition).toBeDefined();
      expect(transition).not.toMatch(/margin|padding/);
    }
  });

  /** The CSS emotion generated for `el`'s classes, so media-query rules (which jsdom does not apply) can be read. */
  function rulesFor(el: HTMLElement): string {
    const css = Array.from(document.querySelectorAll('style'), (s) => s.textContent ?? '').join('\n');
    const classes = Array.from(el.classList).filter((c) => c.startsWith('css-'));
    return css
      .split('}')
      .filter((rule) => classes.some((c) => rule.includes(`.${c}`)))
      .join('}');
  }

  it("reserves room under the content for the bottom-right Today's classes button only where the button shows", () => {
    nav.pathname = '/assignments';
    const { unmount } = render(<AppShell userName="Bruce Zheng">content</AppShell>);
    expect(rulesFor(screen.getByRole('main'))).toMatch(/padding-bottom:calc\(9 \* var\(--mui-spacing\)\)/);
    unmount();

    // The calendar shows neither the panel nor its button.
    nav.pathname = '/calendar';
    render(<AppShell userName="Bruce Zheng">content</AppShell>);
    expect(rulesFor(screen.getByRole('main'))).not.toMatch(/padding-bottom:calc\(9 \* var\(--mui-spacing\)\)/);
    nav.pathname = '/assignments';
  });

  it('signs out through the avatar menu', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    render(<AppShell userName="Bruce Zheng">content</AppShell>);

    await userEvent.click(screen.getByRole('button', { name: 'Account: Bruce Zheng' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/session', { method: 'DELETE' });
    expect(nav.replace).toHaveBeenCalledWith('/login');
  });

  it('keeps the account name outside the menu and links the button to it', async () => {
    render(<AppShell userName="Bruce Zheng">content</AppShell>);
    const button = screen.getByRole('button', { name: 'Account: Bruce Zheng' });
    await userEvent.click(button);

    const menu = screen.getByRole('menu');
    expect(button).toHaveAttribute('aria-controls', menu.id);
    expect(screen.getByText('Signed in as')).toBeVisible();
    expect(within(menu).queryByText('Signed in as')).not.toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
  });
});

/** Shows which theme is in effect. */
function ThemeProbe() {
  return <span data-testid="theme-style">{useTheme().yungu.style}</span>;
}

describe('Settings menu', () => {
  function renderStyled(initialStyle: 'classic' | 'expressive') {
    return render(
      <StyleProvider initialStyle={initialStyle}>
        <AppShell userName="Bruce Zheng">
          <ThemeProbe />
        </AppShell>
      </StyleProvider>,
    );
  }

  it('sits left of the avatar as a labelled menu button', () => {
    renderStyled('expressive');
    const buttons = within(screen.getByRole('banner')).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Settings', 'Account: Bruce Zheng']);
    expect(buttons[0]).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('lists both styles under "Style" with the current one checked', async () => {
    renderStyled('classic');
    const button = screen.getByRole('button', { name: 'Settings' });
    await userEvent.click(button);

    const menu = screen.getByRole('menu', { name: 'Style' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', menu.id);
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['Classic (Material 2)', 'Rounded (Material 3)']);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('switches the whole app to the chosen style at once and remembers it in a cookie', async () => {
    renderStyled('classic');
    expect(screen.getByTestId('theme-style')).toHaveTextContent('classic');

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Rounded (Material 3)' }));

    expect(screen.getByTestId('theme-style')).toHaveTextContent('expressive');
    expect(document.cookie).toContain('yl_style=expressive');
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('menuitemradio', { name: 'Rounded (Material 3)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Classic (Material 2)' })).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Classic (Material 2)' }));
    expect(screen.getByTestId('theme-style')).toHaveTextContent('classic');
    expect(document.cookie).toContain('yl_style=classic');
  });
});
