import { render, screen } from './test-render';
import { describe, expect, it, vi } from 'vitest';
import NavRail from './NavRail';

const pathname = vi.hoisted(() => ({ current: '/calendar' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

describe('NavRail', () => {
  it('lists Assignments, Calendar then Behaviour with correct hrefs', () => {
    render(<NavRail />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Assignments', 'Calendar', 'Behaviour']);
    expect(screen.getByRole('link', { name: 'Assignments' })).toHaveAttribute('href', '/assignments');
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/calendar');
    expect(screen.getByRole('link', { name: 'Behaviour' })).toHaveAttribute('href', '/behaviour');
  });

  it('marks Behaviour active on its page, with the filled icon', () => {
    pathname.current = '/behaviour';
    render(<NavRail />);
    const link = screen.getByRole('link', { name: 'Behaviour' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.querySelector('[data-testid="StarIcon"]')).not.toBeNull();
    pathname.current = '/calendar';
  });

  it('marks only the active route with aria-current="page"', () => {
    pathname.current = '/calendar';
    render(<NavRail />);
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Assignments' })).not.toHaveAttribute('aria-current');
  });

  it('treats nested paths as part of their section', () => {
    pathname.current = '/assignments/submitted';
    render(<NavRail />);
    expect(screen.getByRole('link', { name: 'Assignments' })).toHaveAttribute('aria-current', 'page');
  });

  it('is a labelled navigation landmark', () => {
    render(<NavRail />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});
