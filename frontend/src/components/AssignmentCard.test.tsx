import { render, screen } from './test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AssignmentCard from './AssignmentCard';
import { OpenTaskContext } from './detail/useTaskParam';
import { DAY, HOUR, NOW, todo } from './test-fixtures';

describe('AssignmentCard', () => {
  it('shows course, title, the China due day and how late it is', () => {
    const a = todo('我的产品，为谁解决什么问题？', -2 * DAY, { course: 'EL-AI Create the Future' });
    render(<AssignmentCard assignment={a} now={NOW} variant="overdue" />);
    expect(screen.getByText('EL-AI Create the Future')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '我的产品，为谁解决什么问题？' })).toBeInTheDocument();
    expect(screen.getByText('Due Fri, Oct 16')).toBeInTheDocument();
    expect(screen.getByText('2 days late')).toBeInTheDocument();
  });

  it('uses the same due wording as the course view, with the time while not late', () => {
    render(<AssignmentCard assignment={todo('Lab', 5 * HOUR)} now={NOW} variant="nearly" />);
    expect(screen.getByText('Due today · 22:00')).toBeInTheDocument();
    expect(screen.getByText('in 5 h')).toBeInTheDocument();
  });

  it('work returned for revision shows a "Returned" chip, never how late its old deadline is', () => {
    const a = todo('Revise your essay', -10 * DAY, { revision: true });
    render(<AssignmentCard assignment={a} now={NOW} variant="nearly" />);
    const chip = screen.getByText('Returned').closest('.MuiChip-root')!;
    expect(chip).toHaveTextContent('Returned for revision');               // the rest for screen readers
    expect(screen.queryByText(/late/)).not.toBeInTheDocument();
    expect(screen.getByText('Due Thu, Oct 8')).toBeInTheDocument();
  });

  it('a returned card whose deadline is still ahead also reads "Returned"', () => {
    render(<AssignmentCard assignment={todo('Fix the lab', 3 * DAY, { revision: true })} now={NOW} variant="nearly" />);
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.queryByText('in 3 days')).not.toBeInTheDocument();
  });

  it('renders a long CJK title in full and offers it as a tooltip when clamped', () => {
    const title = '课后任务'.repeat(20);
    expect(title).toHaveLength(80);
    render(<AssignmentCard assignment={todo(title, 3 * DAY)} now={NOW} variant="upcoming" />);
    expect(screen.getByRole('heading')).toHaveTextContent(title);
    expect(screen.getByRole('heading')).toHaveAttribute('title', title);
  });

  it('can title the card one level lower when it sits under a sub-heading', () => {
    render(<AssignmentCard assignment={todo('Essay', 3 * DAY)} now={NOW} variant="upcoming" headingLevel={4} />);
    expect(screen.getByRole('heading', { level: 4, name: 'Essay' })).toBeInTheDocument();
  });

  it('opens the assignment from its title button, by click, Enter or Space', async () => {
    const open = vi.fn();
    const a = todo('Observation task', 3 * DAY);
    render(
      <OpenTaskContext.Provider value={open}>
        <AssignmentCard assignment={a} now={NOW} variant="upcoming" />
      </OpenTaskContext.Provider>,
    );
    const button = screen.getByRole('button', { name: 'Observation task' });
    await userEvent.click(button);
    expect(open).toHaveBeenLastCalledWith(a.id);
    button.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(open).toHaveBeenCalledTimes(3);
  });
});
