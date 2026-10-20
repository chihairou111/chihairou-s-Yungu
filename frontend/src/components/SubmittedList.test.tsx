import { render, screen, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SubmittedList from './SubmittedList';
import { DAY, HOUR, NOW, submitted } from './test-fixtures';

describe('SubmittedList', () => {
  it('groups work by due date, This week / Last week / Earlier, most recently due first', () => {
    // NOW is Sun Oct 18.
    const items = [submitted('Oldest', -20 * DAY), submitted('Newest', -1 * DAY), submitted('Middle', -9 * DAY), submitted('Mon', -6 * DAY)];
    render(<SubmittedList items={items} now={NOW} courseId={null} onCourseChange={() => {}} />);
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual(['This week', 'Last week', 'Earlier']);
    const thisWeek = screen.getByRole('region', { name: 'This week' });
    expect(within(thisWeek).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Newest', 'Mon']);
    expect(within(screen.getByRole('region', { name: 'Last week' })).getByText('Middle')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Earlier' })).getByText('Oldest')).toBeInTheDocument();
  });

  it('heads the list so group headings sit under a section heading', () => {
    render(<SubmittedList items={[submitted('Essay', -DAY)]} now={NOW} courseId={null} onCourseChange={() => {}} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Submitted work' })).toBeInTheDocument();
  });

  it('says so when nothing has been submitted', () => {
    render(<SubmittedList items={[]} now={NOW} courseId={null} onCourseChange={() => {}} />);
    expect(screen.getByText('Nothing submitted yet')).toBeInTheDocument();
  });

  describe('course filter', () => {
    const mixed = () => [
      submitted('Essay', -DAY, -HOUR),
      submitted('Quiz', -2 * DAY),
      submitted('Poster', -3 * DAY),
    ].map((a, i) => (i === 1 ? { ...a, course: 'Business', courseId: 20 } : a));

    it('lists All courses plus each course in the list, by name, with counts', async () => {
      render(<SubmittedList items={mixed()} now={NOW} courseId={null} onCourseChange={() => {}} />);
      await userEvent.click(screen.getByRole('combobox', { name: /^Course/ }));
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'All courses (3)',
        'Business (1)',
        'Product Design I (2)',
      ]);
    });

    it('shows only the chosen course', () => {
      render(<SubmittedList items={mixed()} now={NOW} courseId={20} onCourseChange={() => {}} />);
      expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Quiz']);
      expect(screen.getByRole('combobox', { name: /^Course/ })).toHaveTextContent('Business (1)');
    });

    it('reports the choice, and null for All courses', async () => {
      const onCourseChange = vi.fn();
      const { rerender } = render(<SubmittedList items={mixed()} now={NOW} courseId={null} onCourseChange={onCourseChange} />);
      await userEvent.click(screen.getByRole('combobox', { name: /^Course/ }));
      await userEvent.click(screen.getByRole('option', { name: 'Business (1)' }));
      expect(onCourseChange).toHaveBeenLastCalledWith(20);
      rerender(<SubmittedList items={mixed()} now={NOW} courseId={20} onCourseChange={onCourseChange} />);
      await userEvent.click(screen.getByRole('combobox', { name: /^Course/ }));
      await userEvent.click(screen.getByRole('option', { name: 'All courses (3)' }));
      expect(onCourseChange).toHaveBeenLastCalledWith(null);
    });

    it('falls back to all courses when the chosen course has no submitted work', () => {
      render(<SubmittedList items={mixed()} now={NOW} courseId={999} onCourseChange={() => {}} />);
      expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(3);
      expect(screen.getByRole('combobox', { name: /^Course/ })).toHaveTextContent('All courses (3)');
    });

    it('has no filter when all work is from one course', () => {
      render(<SubmittedList items={[submitted('Essay', -DAY)]} now={NOW} courseId={null} onCourseChange={() => {}} />);
      expect(screen.queryByRole('combobox', { name: /^Course/ })).not.toBeInTheDocument();
    });
  });
});
