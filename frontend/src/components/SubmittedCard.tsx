import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { isSubmittedLate } from '@/lib/priority';
import { chinaMonthDay } from '@/lib/time';
import type { Assignment } from '@/lib/types';

const META_SX = { fontSize: '0.8125rem', lineHeight: '18px' } as const;

/**
 * A compact submitted-work card: course and due date on one line, the title on the next. Only work
 * handed in after its due time gets a chip ("Late"); on-time work needs no status in this list.
 */
export default function SubmittedCard({ assignment }: { assignment: Assignment }) {
  const headingId = `submitted-${assignment.id}`;
  return (
    <Card variant="outlined" component="article" aria-labelledby={headingId} sx={{ px: 2, py: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 2 }}>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ ...META_SX, flex: 1, minWidth: 0 }}>
          {assignment.course}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ...META_SX, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {chinaMonthDay(assignment.dueAt)}
        </Typography>
      </Stack>
      <Stack direction="row" sx={{ mt: 0.5, minHeight: 24, alignItems: 'center', gap: 1 }}>
        <Typography
          id={headingId}
          variant="h3"
          component="h4"
          noWrap
          title={assignment.title}
          sx={{ flex: 1, minWidth: 0, fontSize: '0.9375rem', lineHeight: '22px' }}
        >
          {assignment.title}
        </Typography>
        {isSubmittedLate(assignment) && (
          <Chip size="small" label="Late" sx={{ flexShrink: 0, fontWeight: 600, bgcolor: 'warning.light', color: 'warning.dark' }} />
        )}
      </Stack>
    </Card>
  );
}
