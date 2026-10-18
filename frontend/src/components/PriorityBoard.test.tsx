import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PriorityBoard from './PriorityBoard';
import { DAY, HOUR, NOW, todo } from './test-fixtures';

describe('PriorityBoard', () => {
  it('puts each assignment in its priority column', () => {
    const items = [todo('Late essay', -2 * DAY), todo('Lab due tonight', 5 * HOUR)];
    render(<PriorityBoard items={items} now={NOW} />);

    const overdue = screen.getByRole('region', { name: 'Overdue' });
    const nearly = screen.getByRole('region', { name: 'Nearly overdue' });
    const upcoming = screen.getByRole('region', { name: 'Upcoming' });

    expect(within(overdue).getByText('Late essay')).toBeInTheDocument();
    expect(within(overdue).queryByText('Lab due tonight')).not.toBeInTheDocument();
    expect(within(nearly).getByText('Lab due tonight')).toBeInTheDocument();
    expect(within(upcoming).getByText('Nothing upcoming')).toBeInTheDocument();
  });

  it('labels each column by its title and shows its count', () => {
    render(<PriorityBoard items={[todo('Late essay', -2 * DAY)]} now={NOW} />);
    for (const name of ['Overdue', 'Nearly overdue', 'Upcoming']) {
      const region = screen.getByRole('region', { name });
      expect(within(region).getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Nearly overdue' })).getByText('Nothing due soon')).toBeInTheDocument();
  });

  it('shows "Nothing overdue" when no work is late', () => {
    render(<PriorityBoard items={[todo('Later', 3 * DAY)]} now={NOW} />);
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('Nothing overdue')).toBeInTheDocument();
  });
});
