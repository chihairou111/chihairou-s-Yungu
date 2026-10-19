import { render, screen } from './test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SubmittedCard from './SubmittedCard';
import { OpenTaskContext } from './detail/useTaskParam';
import { DAY, HOUR, submitted } from './test-fixtures';

describe('SubmittedCard', () => {
  it('shows course, due date and title, with no chip for on-time work', () => {
    const a = submitted('Lab Report', -2 * DAY, -HOUR);
    render(<SubmittedCard assignment={a} />);
    expect(screen.getByRole('article', { name: 'Lab Report' })).toBeInTheDocument();
    expect(screen.getByText('Product Design I')).toBeInTheDocument();
    expect(screen.getByText('Oct 16')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lab Report' })).toHaveAttribute('title', 'Lab Report');
    expect(screen.queryByText(/Submitted/)).not.toBeInTheDocument();
    expect(screen.queryByText('Late')).not.toBeInTheDocument();
  });

  it('flags work handed in after its due time with a Late chip', () => {
    render(<SubmittedCard assignment={submitted('第二单元复习卷', -3 * DAY, 20 * HOUR)} />);
    expect(screen.getByText('Late')).toBeInTheDocument();
  });

  it('opens the assignment from its title button', async () => {
    const open = vi.fn();
    const a = submitted('Lab Report', -2 * DAY);
    render(
      <OpenTaskContext.Provider value={open}>
        <SubmittedCard assignment={a} />
      </OpenTaskContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lab Report' }));
    expect(open).toHaveBeenCalledWith(a.id);
  });
});
