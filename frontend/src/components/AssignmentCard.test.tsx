import { render, screen } from './test-render';
import { describe, expect, it } from 'vitest';
import AssignmentCard from './AssignmentCard';
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
});
