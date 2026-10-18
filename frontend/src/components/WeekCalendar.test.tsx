import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { data } from '@/lib/data';
import { parseWeekParam } from '@/lib/time';
import type { ClassEvent } from '@/lib/types';
import WeekCalendar, { layoutDay } from './WeekCalendar';
import { DAY, HOUR, NOW } from './test-fixtures';

const WEEK = parseWeekParam('2026-10-12', NOW); // Mon Oct 12 00:00 China
const WED_NOON = WEEK + 2 * DAY + 12 * HOUR;
const MIN = 60_000;

/** A class at China wall-clock `hh:mm` on weekday `d` (0 = Monday) of WEEK. */
function cls(name: string, d: number, startMin: number, endMin: number, room: string | null = 'D419'): ClassEvent {
  const day = WEEK + d * DAY;
  return { name, room, start: day + startMin * MIN, end: day + endMin * MIN, isClass: true };
}

async function renderFixtureWeek(now = NOW) {
  const events = await data.getWeek(WEEK);
  render(<WeekCalendar weekStart={WEEK} events={events} now={now} />);
}

describe('WeekCalendar', () => {
  it('shows each class under its day with only name, time range and room', async () => {
    await renderFixtureWeek();
    const monday = screen.getByRole('region', { name: 'Mon 12' });
    const block = within(monday)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Chinese I'));
    expect(block).toBeDefined();
    expect(within(block!).getByText('Chinese I')).toBeInTheDocument();
    expect(within(block!).getByText(/08:00–08:40/)).toBeInTheDocument();
    expect(block!.textContent).toBe('Chinese I08:00–08:40 · D419');
  });

  it('never renders routine items such as Wake-up or Lunch', async () => {
    await renderFixtureWeek();
    expect(screen.queryByText(/Wake-up/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lunch/)).not.toBeInTheDocument();
    // 8 classes a day, Mon–Fri.
    expect(screen.getAllByRole('listitem')).toHaveLength(40);
  });

  it('shows Mon–Fri always and omits Saturday and Sunday when they have no classes', async () => {
    await renderFixtureWeek();
    for (const day of ['Mon 12', 'Tue 13', 'Wed 14', 'Thu 15', 'Fri 16']) {
      expect(screen.getByRole('region', { name: day })).toBeInTheDocument();
    }
    expect(screen.queryByRole('region', { name: 'Sat 17' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sun 18' })).not.toBeInTheDocument();
  });

  it('shows a weekend day that has a class', () => {
    render(<WeekCalendar weekStart={WEEK} events={[cls('Make-up Lab', 5, 9 * 60, 10 * 60)]} now={NOW} />);
    expect(screen.getByRole('region', { name: 'Sat 17' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sun 18' })).not.toBeInTheDocument();
  });

  it('omits the room when it is missing', () => {
    render(<WeekCalendar weekStart={WEEK} events={[cls('Assembly', 0, 8 * 60, 9 * 60, null)]} now={NOW} />);
    expect(screen.getByRole('listitem').textContent).toBe('Assembly08:00–09:00');
  });

  it('links to the previous, next and current week', () => {
    render(<WeekCalendar weekStart={WEEK} events={[]} now={NOW} />);
    expect(screen.getByRole('link', { name: 'Next week' })).toHaveAttribute('href', '/calendar?week=2026-10-19');
    expect(screen.getByRole('link', { name: 'Previous week' })).toHaveAttribute('href', '/calendar?week=2026-10-05');
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/calendar');
  });

  it('shows the visible range', () => {
    render(<WeekCalendar weekStart={WEEK} events={[]} now={NOW} />);
    expect(screen.getByRole('heading', { name: 'Oct 12 – 18, 2026' })).toBeInTheDocument();
  });

  it("marks today's column header", async () => {
    await renderFixtureWeek(WED_NOON);
    const wednesday = screen.getByRole('region', { name: 'Wed 14' });
    expect(within(wednesday).getByRole('heading', { name: 'Wed 14' })).toHaveAttribute('aria-current', 'date');
    const monday = screen.getByRole('region', { name: 'Mon 12' });
    expect(within(monday).getByRole('heading', { name: 'Mon 12' })).not.toHaveAttribute('aria-current');
  });

  it('says so when the week has no classes', () => {
    render(<WeekCalendar weekStart={WEEK} events={[]} now={NOW} />);
    expect(screen.getByText('No classes this week')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});

describe('layoutDay', () => {
  it('puts overlapping classes side by side and keeps the rest full width', () => {
    const [a, b, c] = layoutDay([cls('A', 0, 480, 540), cls('B', 0, 500, 560), cls('C', 0, 600, 640)]);
    expect([a.lane, a.lanes]).toEqual([0, 2]);
    expect([b.lane, b.lanes]).toEqual([1, 2]);
    expect([c.lane, c.lanes]).toEqual([0, 1]);
  });

  it('reuses a free lane inside a cluster', () => {
    const laid = layoutDay([cls('A', 0, 480, 600), cls('B', 0, 490, 520), cls('C', 0, 530, 560)]);
    expect(laid.map((p) => [p.event.name, p.lane, p.lanes])).toEqual([
      ['A', 0, 2],
      ['B', 1, 2],
      ['C', 1, 2],
    ]);
  });
});
