import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { dueLabel } from '@/lib/due';
import { relativeDue } from '@/lib/priority';
import type { Assignment, Priority } from '@/lib/types';
import CardOpener, { openerHostSx } from './CardOpener';
import { VISUALLY_HIDDEN } from './visually-hidden';

/** Palette used for each priority wherever it is shown (chip, column header). */
export const PRIORITY_TONE: Record<Priority, 'error' | 'warning' | 'primary'> = {
  overdue: 'error',
  nearly: 'warning',
  upcoming: 'primary',
};

interface AssignmentCardProps {
  assignment: Assignment;
  now: number;
  variant: Priority;
  /** Heading level of the title: 3 under a column heading, 4 under a date sub-heading. */
  headingLevel?: 3 | 4;
}

/**
 * One to-do assignment, opening its detail when clicked: course, title (two lines at most), due day and
 * time (China time) and a relative-time chip; work returned for revision says "Returned" there instead,
 * since its deadline is the original one.
 */
export default function AssignmentCard({ assignment, now, variant, headingLevel = 3 }: AssignmentCardProps) {
  const tone = PRIORITY_TONE[variant];

  return (
    <Card variant="outlined" component="article" sx={[{ p: 2 }, openerHostSx]}>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', lineHeight: '1.125rem', overflowWrap: 'anywhere' }}>
        {assignment.course}
      </Typography>
      <Typography
        variant="h3"
        component={`h${headingLevel}`}
        title={assignment.title}
        sx={{
          mt: 0.5,
          fontSize: '0.9375rem',
          lineHeight: '1.375rem',
          overflowWrap: 'anywhere',
          textWrap: 'pretty',
        }}
      >
        <CardOpener taskId={assignment.id} lines={2}>
          {assignment.title}
        </CardOpener>
      </Typography>
      <Stack direction="row" sx={{ mt: 1.5, alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          {dueLabel(assignment.dueAt, now)}
        </Typography>
        <Chip
          size="small"
          label={
            assignment.revision ? (
              <>
                Returned
                <Box component="span" sx={VISUALLY_HIDDEN}>
                  {' '}for revision
                </Box>
              </>
            ) : (
              relativeDue(assignment.dueAt, now)
            )
          }
          sx={{ fontWeight: 600, bgcolor: `${tone}.light`, color: `${tone}.dark` }}
        />
      </Stack>
    </Card>
  );
}
