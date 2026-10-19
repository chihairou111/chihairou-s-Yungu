import { render, screen } from './test-render';
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

function renderView(panelOpen = false) {
  return render(
    <AssignmentsView
      todo={[todo('Observation task', 2 * DAY)]}
      submitted={[]}
      courses={COURSES}
      todayClasses={[]}
      now={NOW}
      initialPanelOpen={panelOpen}
    />,
  );
}

describe('AssignmentsView', () => {
  it('points only the selected tab at the panel that is rendered', () => {
    renderView();
    const panel = screen.getByRole('tabpanel');
    expect(screen.getByRole('tab', { name: 'To-do' })).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByRole('tab', { name: 'Submitted' })).not.toHaveAttribute('aria-controls');
  });

  it('shows the priority columns directly on To-do, with no grouping switch', () => {
    renderView();
    expect(screen.getByRole('region', { name: 'Overdue' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Group to-do work' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'By course' })).not.toBeInTheDocument();
  });

  it('ignores a stale ?view=course and still shows the priority columns', () => {
    nav.search = 'view=course';
    renderView();
    expect(screen.getByRole('region', { name: 'Overdue' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Product Design I' })).not.toBeInTheDocument();
  });

  it('keeps only ?tab in the URL when switching tabs', async () => {
    nav.search = 'view=course';
    const replace = vi.spyOn(window.history, 'replaceState');
    renderView();
    await userEvent.click(screen.getByRole('tab', { name: 'Submitted' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments?tab=submitted');
  });

  it('drops the query when going back to To-do', async () => {
    nav.search = 'tab=submitted&view=course';
    const replace = vi.spyOn(window.history, 'replaceState');
    renderView();
    await userEvent.click(screen.getByRole('tab', { name: 'To-do' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments');
  });

  it("offers today's classes on both tabs", () => {
    renderView();
    expect(screen.getByRole('button', { name: "Today's classes" })).toBeInTheDocument();
    nav.search = 'tab=submitted';
    renderView();
    expect(screen.getAllByRole('button', { name: "Today's classes" })).toHaveLength(2);
  });

  it("renders the Today's classes panel in its stored state, beside the tab panel", () => {
    const { unmount } = renderView(true);
    const panel = screen.getByRole('complementary', { name: "Today's classes" });
    expect(panel).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('tabpanel').contains(panel)).toBe(false);
    unmount();
    renderView(false);
    expect(document.querySelector('aside')).toHaveAttribute('data-open', 'false');
  });
});
