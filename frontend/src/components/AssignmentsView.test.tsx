import { render, screen } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function renderView() {
  return render(<AssignmentsView todo={[todo('Observation task', 2 * DAY)]} submitted={[]} now={NOW} />);
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

  it('opens a card as the detail pop-up by pushing ?task=ID, keeping the tab', async () => {
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const task = todo('Observation task', 2 * DAY, { id: 94616 });
    render(<AssignmentsView todo={[task]} submitted={[]} now={NOW} />);
    await userEvent.click(screen.getByRole('button', { name: 'Observation task' }));
    expect(push).toHaveBeenCalledWith({ ylTask: true }, '', '/assignments?task=94616');
  });

  it("leaves Today's classes to the dashboard shell (shared with Calendar)", () => {
    renderView();
    expect(screen.queryByRole('button', { name: "Today's classes" })).not.toBeInTheDocument();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('keeps the Submitted course filter in the URL', async () => {
    nav.search = 'tab=submitted';
    const replace = vi.spyOn(window.history, 'replaceState');
    const items = [
      { ...todo('Essay', -DAY), status: 'Submitted' as const, submittedAt: NOW - 2 * DAY },
      { ...todo('Quiz', -DAY), status: 'Submitted' as const, submittedAt: NOW - 2 * DAY, course: 'Business', courseId: 20 },
    ];
    const { rerender } = render(<AssignmentsView todo={[]} submitted={items} now={NOW} />);
    await userEvent.click(screen.getByRole('combobox', { name: /^Course/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Business (1)' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments?tab=submitted&course=20');
    nav.search = 'tab=submitted&course=20';
    rerender(<AssignmentsView todo={[]} submitted={items} now={NOW} />);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Quiz']);
  });

  it('drops the course filter when switching to To-do', async () => {
    nav.search = 'tab=submitted&course=20';
    const replace = vi.spyOn(window.history, 'replaceState');
    renderView();
    await userEvent.click(screen.getByRole('tab', { name: 'To-do' }));
    expect(replace).toHaveBeenLastCalledWith(null, '', '/assignments');
  });
});
