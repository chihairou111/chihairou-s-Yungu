import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AssignmentsView from './AssignmentsView';
import { NOW } from './test-fixtures';

vi.mock('next/navigation', () => ({
  usePathname: () => '/assignments',
  useSearchParams: () => new URLSearchParams(),
}));

describe('AssignmentsView', () => {
  it('points only the selected tab at the panel that is rendered', () => {
    render(<AssignmentsView todo={[]} submitted={[]} todayClasses={[]} now={NOW} />);
    const panel = screen.getByRole('tabpanel');
    expect(screen.getByRole('tab', { name: 'To-do' })).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByRole('tab', { name: 'Submitted' })).not.toHaveAttribute('aria-controls');
  });
});
