import { render, screen, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '@/lib/types';
import AssignmentsView from './AssignmentsView';
import { DAY, NOW, todo } from './test-fixtures';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/assignments',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

afterEach(() => {
  nav.search = '';
  vi.restoreAllMocks();
});

const COURSES: Course[] = [
  { id: 10, name: 'Product Design I', color: 'Banana' },
  { id: 1, name: 'Chinese I', color: 'Tomato' },
];

function renderView() {
  return render(
    <AssignmentsView todo={[todo('Observation task', 2 * DAY)]} submitted={[]} courses={COURSES} todayClasses={[]} now={NOW} />,
  );
}

describe('AssignmentsView', () => {
  it('points only the selected tab at the panel that is rendered', () => {
    renderView();
    const panel = screen.getByRole('tabpanel');
    expect(screen.getByRole('tab', { name: 'To-do' })).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByRole('tab', { name: 'Submitted' })).not.toHaveAttribute('aria-controls');
  });

  it('shows the priority board by default', () => {
    renderView();
    expect(screen.getByRole('button', { name: 'By priority' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'By course' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region', { name: 'Overdue' })).toBeInTheDocument();
  });

  it('stores the course view in ?view=course', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'By course' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments?view=course');
  });

  it('drops ?view when going back to By priority; switching tabs keeps ?view', async () => {
    nav.search = 'view=course';
    const replace = vi.spyOn(window.history, 'replaceState');
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'By priority' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments');
    await userEvent.click(screen.getByRole('tab', { name: 'Submitted' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments?tab=submitted&view=course');
  });

  it('renders course cards for ?view=course', () => {
    nav.search = 'view=course';
    renderView();
    expect(screen.getByRole('button', { name: 'By course' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('article', { name: 'Product Design I' })).toHaveTextContent('Observation task');
    expect(screen.getByRole('article', { name: 'Chinese I' })).toHaveTextContent('No work due');
    expect(screen.queryByRole('region', { name: 'Overdue' })).not.toBeInTheDocument();
  });

  it("offers today's classes on both tabs and hides the view toggle on Submitted", () => {
    renderView();
    expect(screen.getByRole('button', { name: "Today's classes" })).toBeInTheDocument();
    nav.search = 'tab=submitted&view=course';
    renderView();
    expect(screen.getAllByRole('button', { name: "Today's classes" })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'By course' })).toHaveLength(1);
  });

  it('puts the view switch in the tab row of the page header, on To-do only', () => {
    const { unmount } = renderView();
    const header = screen.getByRole('tablist').closest('[data-page-header]');
    expect(header).not.toBeNull();
    const views = within(header as HTMLElement).getByRole('group', { name: 'Group to-do work' });
    expect(within(views).getByRole('button', { name: 'By priority' })).toBeInTheDocument();
    // The content below the header holds no controls of its own.
    expect(within(screen.getByRole('tabpanel')).queryByRole('group')).not.toBeInTheDocument();
    unmount();

    nav.search = 'tab=submitted';
    renderView();
    expect(screen.getByRole('tablist').closest('[data-page-header]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Group to-do work' })).not.toBeInTheDocument();
  });
});
