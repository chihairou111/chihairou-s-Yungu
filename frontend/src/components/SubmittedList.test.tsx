import { render, screen, within } from './test-render';
import { describe, expect, it } from 'vitest';
import SubmittedList from './SubmittedList';
import { DAY, NOW, submitted } from './test-fixtures';

describe('SubmittedList', () => {
  it('groups work by due date, This week / Last week / Earlier, most recently due first', () => {
    // NOW is Sun Oct 18.
    const items = [submitted('Oldest', -20 * DAY), submitted('Newest', -1 * DAY), submitted('Middle', -9 * DAY), submitted('Mon', -6 * DAY)];
    render(<SubmittedList items={items} now={NOW} />);
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual(['This week', 'Last week', 'Earlier']);
    const thisWeek = screen.getByRole('region', { name: 'This week' });
    expect(within(thisWeek).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Newest', 'Mon']);
    expect(within(screen.getByRole('region', { name: 'Last week' })).getByText('Middle')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Earlier' })).getByText('Oldest')).toBeInTheDocument();
  });

  it('heads the list so group headings sit under a section heading', () => {
    render(<SubmittedList items={[submitted('Essay', -DAY)]} now={NOW} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Submitted work' })).toBeInTheDocument();
  });

  it('says so when nothing has been submitted', () => {
    render(<SubmittedList items={[]} now={NOW} />);
    expect(screen.getByText('Nothing submitted yet')).toBeInTheDocument();
  });
});
