import { render, screen, within } from './test-render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TodayClasses from './TodayClasses';
import type { ClassEvent, Course } from '@/lib/types';

const HOUR = 3600_000;
const MIN = 60_000;
const MONDAY = Date.UTC(2026, 9, 18, 16, 0); // Mon Oct 19 00:00 China

const classes: ClassEvent[] = [
  { name: 'Chinese I', room: 'D419', start: MONDAY + 8 * HOUR, end: MONDAY + 8 * HOUR + 40 * MIN, isClass: true, courseId: 1 },
  { name: 'CL Business I', room: 'D405', start: MONDAY + 8.75 * HOUR, end: MONDAY + 9.25 * HOUR + 10 * MIN, isClass: true, courseId: 2 },
  { name: 'Self Study', room: null, start: MONDAY + 14 * HOUR + 55 * MIN, end: MONDAY + 15.5 * HOUR + 5 * MIN, isClass: true, courseId: 8 },
];

const COURSES: Course[] = [
  { id: 1, name: 'Chinese I', color: 'Tomato' },
  { id: 2, name: 'CL Business with Personal Finance I', color: 'Tangerine' },
];
const EARLY = MONDAY + 7 * HOUR;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TodayClasses', () => {
  it('lists each class in order with its China-time range and room', () => {
    render(<TodayClasses events={classes} now={EARLY} courses={COURSES} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((li) => within(li).getByRole('heading').textContent)).toEqual(['Chinese I', 'CL Business I', 'Self Study']);
    expect(within(items[0]).getByText('Chinese I')).toBeInTheDocument();
    expect(within(items[0]).getByText('08:00–08:40 · D419')).toBeInTheDocument();
    expect(within(items[1]).getByText('08:45–09:25 · D405')).toBeInTheDocument();
  });

  it('omits the separator when a class has no room', () => {
    render(<TodayClasses events={classes} now={EARLY} courses={COURSES} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    const line = within(items[2]).getByText(/^14:55–15:35/);
    expect(line.textContent).toBe('14:55–15:35');
    expect(line.textContent).not.toContain(' · ');
  });

  it('renders each class as its own card, with no divider lines between them', () => {
    render(<TodayClasses events={classes} now={EARLY} courses={COURSES} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    for (const li of items) expect(li).toHaveClass('MuiCard-root');
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    // The old list drew a top border on every row after the first.
    expect(getComputedStyle(items[1]).borderTopColor).toBe(getComputedStyle(items[0]).borderTopColor);
  });

  it('shows an empty state when there are no classes', () => {
    render(<TodayClasses events={[]} now={EARLY} courses={COURSES} />);
    expect(screen.getByText('No classes today')).toBeInTheDocument();
  });
});

describe('TodayClasses timing', () => {
  it('labels the class in progress Now and the following one Next, and marks ended classes', () => {
    // 08:50: Chinese ended, Business runs 08:45–09:35, Self Study is next.
    render(<TodayClasses events={classes} now={MONDAY + 8 * HOUR + 50 * MIN} courses={COURSES} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.dataset.timing)).toEqual(['ended', 'now', 'next']);
    expect(within(items[1]).getByText('Now')).toBeInTheDocument();
    expect(within(items[2]).getByText('Next')).toBeInTheDocument();
    expect(within(items[0]).queryByText(/^(Now|Next)$/)).not.toBeInTheDocument();
  });

  it('dots each class with its course color (Peacock when the course is unknown)', () => {
    render(<TodayClasses events={classes} now={EARLY} courses={COURSES} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0].style.getPropertyValue('--course')).toBe('#D50000');
    expect(items[1].style.getPropertyValue('--course')).toBe('#F4511E');
    expect(items[2].style.getPropertyValue('--course')).toBe('#039BE5');
  });

  it('scrolls the class in progress (or else the next one) into view', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<TodayClasses events={classes} now={MONDAY + 8 * HOUR + 50 * MIN} courses={COURSES} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toHaveTextContent('CL Business I');
  });
});

describe('TodayClasses after the last class', () => {
  const DAY = 24 * HOUR;
  const tomorrow: ClassEvent[] = classes.map((c) => ({ ...c, start: c.start + DAY, end: c.end + DAY }));

  it('names the next school day over its list and marks its first class Next', () => {
    render(<TodayClasses events={tomorrow} now={MONDAY + 21 * HOUR} courses={COURSES} nextDay="Tomorrow · Tue, Oct 20" />);
    expect(screen.getByRole('heading', { name: 'Tomorrow · Tue, Oct 20' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tomorrow · Tue, Oct 20' }).tagName).toBe('H3');
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Chinese I', 'CL Business I', 'Self Study']);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.dataset.timing)).toEqual(['next', 'later', 'later']);
    expect(within(items[0]).getByText('Next')).toBeInTheDocument();
  });

  it('shows no such heading during the day', () => {
    render(<TodayClasses events={classes} now={EARLY} courses={COURSES} />);
    expect(screen.queryAllByRole('heading').map((h) => h.textContent)).toEqual(['Chinese I', 'CL Business I', 'Self Study']);
    expect(screen.getAllByRole('heading').every((h) => h.tagName === 'H3')).toBe(true);
  });
});
