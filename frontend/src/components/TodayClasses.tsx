import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { chinaClock } from '@/lib/time';
import type { ClassEvent } from '@/lib/types';

interface TodayClassesProps {
  events: ClassEvent[];
}

/**
 * Today's classes as given (select and order them with `todaysClasses`): name, then
 * "HH:MM–HH:MM · room". The surrounding surface (the drawer) supplies the title.
 */
export default function TodayClasses({ events: classes }: TodayClassesProps) {
  if (classes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2.5 }}>
        No classes today
      </Typography>
    );
  }
  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {classes.map((c) => (
        <Box
          component="li"
          key={`${c.start}-${c.name}`}
          sx={{ px: 2, py: 1.5, '& + &': { borderTop: 1, borderColor: 'divider' } }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {c.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {[`${chinaClock(c.start)}–${chinaClock(c.end)}`, c.room].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
