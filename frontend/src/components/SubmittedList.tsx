import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Assignment } from '@/lib/types';
import AssignmentCard from './AssignmentCard';

/** Screen-reader-only text (MUI's sizing would read a bare 1 as 100%). */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  m: '-1px',
  p: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

interface SubmittedListProps {
  items: Assignment[];
  now: number;
}

/** Submitted work in one column, most recently due first. */
export default function SubmittedList({ items, now }: SubmittedListProps) {
  const sorted = [...items].sort((a, b) => b.dueAt - a.dueAt);
  return (
    <Box component="section" aria-labelledby="submitted-heading">
      {/* The tab already names this list on screen; the heading gives card titles (h3) a parent. */}
      <Typography id="submitted-heading" variant="h3" component="h2" sx={VISUALLY_HIDDEN}>
        Submitted work
      </Typography>
      {sorted.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nothing submitted yet
        </Typography>
      ) : (
        <Stack sx={{ gap: 1.5, maxWidth: 720 }}>
          {sorted.map((a) => (
            <AssignmentCard key={a.id} assignment={a} now={now} variant="submitted" />
          ))}
        </Stack>
      )}
    </Box>
  );
}
