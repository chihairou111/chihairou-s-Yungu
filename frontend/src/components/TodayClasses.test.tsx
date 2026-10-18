import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TodayClasses from './TodayClasses';
import type { ClassEvent } from '@/lib/types';

const HOUR = 3600_000;
const MIN = 60_000;
const MONDAY = Date.UTC(2026, 9, 18, 16, 0); // Mon Oct 19 00:00 China

const classes: ClassEvent[] = [
  { name: 'Chinese I', room: 'D419', start: MONDAY + 8 * HOUR, end: MONDAY + 8 * HOUR + 40 * MIN, isClass: true, courseId: 1 },
  { name: 'CL Business I', room: 'D405', start: MONDAY + 8.75 * HOUR, end: MONDAY + 9.25 * HOUR + 10 * MIN, isClass: true, courseId: 2 },
  { name: 'Self Study', room: null, start: MONDAY + 14 * HOUR + 55 * MIN, end: MONDAY + 15.5 * HOUR + 5 * MIN, isClass: true, courseId: 8 },
];

describe('TodayClasses', () => {
  it('lists each class in order with its China-time range and room', () => {
    render(<TodayClasses events={classes} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.querySelector('p')?.textContent)).toEqual(['Chinese I', 'CL Business I', 'Self Study']);
    expect(within(items[0]).getByText('Chinese I')).toBeInTheDocument();
    expect(within(items[0]).getByText('08:00–08:40 · D419')).toBeInTheDocument();
    expect(within(items[1]).getByText('08:45–09:25 · D405')).toBeInTheDocument();
  });

  it('omits the separator when a class has no room', () => {
    render(<TodayClasses events={classes} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    const line = within(items[2]).getByText(/^14:55–15:35/);
    expect(line.textContent).toBe('14:55–15:35');
    expect(line.textContent).not.toContain(' · ');
  });

  it('shows an empty state when there are no classes', () => {
    render(<TodayClasses events={[]} />);
    expect(screen.getByText('No classes today')).toBeInTheDocument();
  });
});
