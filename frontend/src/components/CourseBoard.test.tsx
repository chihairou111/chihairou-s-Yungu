import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Course } from '@/lib/types';
import CourseBoard from './CourseBoard';
import { DAY, HOUR, NOW, todo } from './test-fixtures';

const COURSES: Course[] = [
  { id: 1, name: 'Chinese I', color: 'Tomato' },
  { id: 9, name: 'EL-AI Create the Future', color: 'Flamingo' },
  { id: 10, name: 'Product Design I', color: 'Banana' },
  { id: 5, name: 'H Algebra 2 I', color: 'Blueberry' },
];

// NOW is Sun Oct 18 17:00 China.
const items = [
  todo('Unit 4 Problem Set', 3 * DAY + 5 * HOUR, { courseId: 5, course: 'H Algebra 2 I' }), // Wed Oct 21 22:00
  todo('Task 3：开始第一次观察', 5 * HOUR, { courseId: 10 }), // today 22:00
  todo('我的产品，为谁解决什么问题？', -2 * DAY, { courseId: 9, course: 'EL-AI Create the Future' }),
  todo('Write-up', DAY + 5 * HOUR, { courseId: 10 }), // tomorrow 22:00
];

const cardNames = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole('article')
    .map((a) => within(a).getByRole('heading').textContent);

describe('CourseBoard', () => {
  it('orders courses with work by their most urgent item, then lists the rest under "No work due"', () => {
    render(<CourseBoard courses={COURSES} items={items} now={NOW} />);
    const due = screen.getByRole('region', { name: 'Courses with work due' });
    expect(cardNames(due)).toEqual(['EL-AI Create the Future', 'Product Design I', 'H Algebra 2 I']);
    const none = screen.getByRole('region', { name: 'No work due' });
    expect(cardNames(none)).toEqual(['Chinese I']);
    expect(within(none).getByRole('article', { name: 'Chinese I' })).toHaveTextContent('No work due');
  });

  it('labels each item by China date and lists it most urgent first', () => {
    render(<CourseBoard courses={COURSES} items={items} now={NOW} />);
    const design = screen.getByRole('article', { name: 'Product Design I' });
    const lines = within(design).getAllByRole('listitem');
    expect(within(lines[0]).getByText('Due today')).toBeInTheDocument();
    expect(lines[0]).toHaveTextContent('Task 3：开始第一次观察');
    expect(within(lines[1]).getByText('Due tomorrow')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'EL-AI Create the Future' })).getByText('2 days late')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'H Algebra 2 I' })).getByText('Due Wed, Oct 21')).toBeInTheDocument();
  });

  it('fills the header band with the course color and readable text', () => {
    render(<CourseBoard courses={COURSES} items={items} now={NOW} />);
    const banana = within(screen.getByRole('article', { name: 'Product Design I' })).getByRole('heading').parentElement!;
    expect(banana.style.getPropertyValue('--course-bg')).toBe('#F6BF26');
    expect(banana.style.getPropertyValue('--course-fg')).toBe('rgba(0,0,0,0.87)');
    const blueberry = within(screen.getByRole('article', { name: 'H Algebra 2 I' })).getByRole('heading').parentElement!;
    expect(blueberry.style.getPropertyValue('--course-bg')).toBe('#3F51B5');
    expect(blueberry.style.getPropertyValue('--course-fg')).toBe('#fff');
  });

  it('omits the "No work due" section when every course has work', () => {
    render(<CourseBoard courses={COURSES.slice(1, 3)} items={items.slice(1, 3)} now={NOW} />);
    expect(screen.queryByRole('region', { name: 'No work due' })).not.toBeInTheDocument();
  });

  it('says so when there are no courses at all', () => {
    render(<CourseBoard courses={[]} items={[]} now={NOW} />);
    expect(screen.getByText('No courses')).toBeInTheDocument();
  });
});
