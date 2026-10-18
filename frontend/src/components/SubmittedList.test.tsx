import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SubmittedList from './SubmittedList';
import { DAY, NOW, submitted } from './test-fixtures';

describe('SubmittedList', () => {
  it('lists the most recently due work first', () => {
    const items = [submitted('Oldest', -10 * DAY), submitted('Newest', -1 * DAY), submitted('Middle', -5 * DAY)];
    render(<SubmittedList items={items} now={NOW} />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest']);
  });

  it('says so when nothing has been submitted', () => {
    render(<SubmittedList items={[]} now={NOW} />);
    expect(screen.getByText('Nothing submitted yet')).toBeInTheDocument();
  });
});
