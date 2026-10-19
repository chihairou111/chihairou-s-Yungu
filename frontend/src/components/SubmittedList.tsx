import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { submittedGroups } from '@/lib/due';
import type { Assignment } from '@/lib/types';
import SubmittedCard from './SubmittedCard';
import { VISUALLY_HIDDEN } from './visually-hidden';

interface SubmittedListProps {
  items: Assignment[];
  now: number;
}

/** Submitted work as small cards in one column, grouped by due date (This week / Last week / Earlier), newest first. */
export default function SubmittedList({ items, now }: SubmittedListProps) {
  const groups = submittedGroups(items, now);
  return (
    <Box component="section" aria-labelledby="submitted-heading" sx={{ maxWidth: 720 }}>
      {/* The tab already names this list on screen; the heading gives the group headings a parent. */}
      <Typography id="submitted-heading" variant="h3" component="h2" sx={VISUALLY_HIDDEN}>
        Submitted work
      </Typography>
      {groups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nothing submitted yet
        </Typography>
      ) : (
        <Stack sx={{ gap: 4 }}>
          {groups.map(({ label, items: list }) => {
            const headingId = `submitted-${label.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <Box component="section" key={label} aria-labelledby={headingId}>
                <Typography id={headingId} variant="body2" component="h3" color="text.secondary" sx={{ fontWeight: 500, mb: 1 }}>
                  {label}
                </Typography>
                <Stack sx={{ gap: 1.5 }}>
                  {list.map((a) => (
                    <SubmittedCard key={a.id} assignment={a} />
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
