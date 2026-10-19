import { render, screen } from './test-render';
import { describe, expect, it } from 'vitest';
import AssignmentCard from './AssignmentCard';
import { DAY, HOUR, NOW, submitted, todo } from './test-fixtures';

describe('AssignmentCard', () => {
  it('shows course, title, China-time due date and how late it is', () => {
    const a = todo('我的产品，为谁解决什么问题？', -2 * DAY, { course: 'EL-AI Create the Future' });
    render(<AssignmentCard assignment={a} now={NOW} variant="overdue" />);
    expect(screen.getByText('EL-AI Create the Future')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '我的产品，为谁解决什么问题？' })).toBeInTheDocument();
    expect(screen.getByText('Due Oct 16, 17:00')).toBeInTheDocument();
    expect(screen.getByText('2 days late')).toBeInTheDocument();
  });

  it('marks work submitted after its due time as late', () => {
    const a = submitted('第二单元复习卷', -3 * DAY, 20 * HOUR);
    render(<AssignmentCard assignment={a} now={NOW} variant="submitted" />);
    expect(screen.getByText('Submitted late')).toBeInTheDocument();
  });

  it('marks on-time work as submitted', () => {
    const a = submitted('Lab Report', -3 * DAY, -HOUR);
    render(<AssignmentCard assignment={a} now={NOW} variant="submitted" />);
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.queryByText('Submitted late')).not.toBeInTheDocument();
  });

  it('renders a long CJK title in full', () => {
    const title = '课后任务'.repeat(20);
    expect(title).toHaveLength(80);
    render(<AssignmentCard assignment={todo(title, 3 * DAY)} now={NOW} variant="upcoming" />);
    expect(screen.getByRole('heading')).toHaveTextContent(title);
  });
});
