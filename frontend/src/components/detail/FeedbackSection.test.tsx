import { render, screen, within } from '../test-render';
import { describe, expect, it } from 'vitest';
import type { Feedback } from '@/lib/types';
import FeedbackSection from './FeedbackSection';

/** Tue Oct 20 16:08 China time. */
const UPDATED = Date.UTC(2026, 9, 20, 8, 8);

const full: Feedback = {
  score: '9/10',
  comment: 'Clear analysis.\nWell done on the diagram.',
  criteria: [
    { name: 'Analysis', result: 'Exemplary', description: 'Explains every link in the chain.' },
    { name: 'Evidence', result: 'Proficient' },
  ],
  updatedAt: UPDATED,
};

describe('FeedbackSection', () => {
  it('renders nothing without feedback', () => {
    const { container } = render(<FeedbackSection feedback={null} />);
    expect(container).toBeEmptyDOMElement();
    const again = render(<FeedbackSection feedback={undefined} />);
    expect(again.container).toBeEmptyDOMElement();
  });

  it('shows the score, when it was given (China time), the comment and each criterion', () => {
    render(<FeedbackSection feedback={full} />);
    const region = screen.getByRole('region', { name: 'Feedback' });
    expect(within(region).getByRole('heading', { level: 3, name: 'Feedback' })).toBeInTheDocument();
    expect(within(region).getByText('9/10')).toBeInTheDocument();
    expect(within(region).getByText('Graded Oct 20, 16:08')).toBeInTheDocument();
    // Line breaks in the teacher's text are kept.
    expect(within(region).getByText(/Clear analysis\.\s+Well done/)).toHaveStyle({ whiteSpace: 'pre-line' });
    const rows = within(within(region).getByRole('list', { name: 'Criteria' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'AnalysisExemplaryExplains every link in the chain.',
      'EvidenceProficient',
    ]);
  });

  it('names the score for assistive tech', () => {
    render(<FeedbackSection feedback={full} />);
    expect(screen.getByText('Score:')).toBeInTheDocument();
  });

  it('shows a comment alone when there is no score, and a level name as the score', () => {
    const { unmount } = render(<FeedbackSection feedback={{ score: '', comment: 'late submission.', criteria: [], updatedAt: null }} />);
    const region = screen.getByRole('region', { name: 'Feedback' });
    expect(within(region).queryByText('Score:')).toBeNull();
    expect(within(region).queryByText(/Graded/)).toBeNull();
    expect(within(region).getByText('late submission.')).toBeInTheDocument();
    expect(within(region).queryByRole('list')).toBeNull();
    unmount();
    render(<FeedbackSection feedback={{ score: 'Extraordinary [5]', comment: null, criteria: [], updatedAt: UPDATED }} />);
    expect(screen.getByText('Extraordinary [5]')).toBeInTheDocument();
  });
});
