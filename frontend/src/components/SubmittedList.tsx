import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Assignment } from '@/lib/types';
import AssignmentCard from './AssignmentCard';

interface SubmittedListProps {
  items: Assignment[];
  now: number;
}

/** Submitted work in one column, most recently due first. */
export default function SubmittedList({ items, now }: SubmittedListProps) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing submitted yet
      </Typography>
    );
  }

  const sorted = [...items].sort((a, b) => b.dueAt - a.dueAt);
  return (
    <Stack sx={{ gap: 1.5, maxWidth: 720 }}>
      {sorted.map((a) => (
        <AssignmentCard key={a.id} assignment={a} now={now} variant="submitted" />
      ))}
    </Stack>
  );
}
