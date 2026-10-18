import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { isSubmittedLate, relativeDue } from '@/lib/priority';
import { chinaDueLabel } from '@/lib/time';
import type { Assignment, Priority } from '@/lib/types';

export type CardVariant = Priority | 'submitted';
type Tone = 'error' | 'warning' | 'primary' | 'neutral';

/** Palette used for each priority wherever it is shown (chip, column header). */
export const PRIORITY_TONE: Record<Priority, Exclude<Tone, 'neutral'>> = {
  overdue: 'error',
  nearly: 'warning',
  upcoming: 'primary',
};

interface AssignmentCardProps {
  assignment: Assignment;
  now: number;
  variant: CardVariant;
}

function chipFor(assignment: Assignment, now: number, variant: CardVariant): { label: string; tone: Tone } {
  if (variant !== 'submitted') return { label: relativeDue(assignment.dueAt, now), tone: PRIORITY_TONE[variant] };
  return isSubmittedLate(assignment) ? { label: 'Submitted late', tone: 'warning' } : { label: 'Submitted', tone: 'neutral' };
}

/** One assignment: course, title, due time (China time) and a status chip. */
export default function AssignmentCard({ assignment, now, variant }: AssignmentCardProps) {
  const chip = chipFor(assignment, now, variant);

  return (
    <Card variant="outlined" component="article" sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
        {assignment.course}
      </Typography>
      <Typography
        variant="h3"
        sx={{ mt: 0.5, fontSize: '0.9375rem', lineHeight: 1.5, overflowWrap: 'anywhere', textWrap: 'pretty' }}
      >
        {assignment.title}
      </Typography>
      <Stack direction="row" sx={{ mt: 1.5, alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          {`Due ${chinaDueLabel(assignment.dueAt)}`}
        </Typography>
        <Chip
          size="small"
          label={chip.label}
          sx={{
            fontWeight: 600,
            ...(chip.tone === 'neutral'
              ? { bgcolor: 'grey.100', color: 'text.secondary' }
              : { bgcolor: `${chip.tone}.light`, color: `${chip.tone}.dark` }),
          }}
        />
      </Stack>
    </Card>
  );
}
