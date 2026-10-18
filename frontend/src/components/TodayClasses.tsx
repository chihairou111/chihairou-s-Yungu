import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { chinaClock } from '@/lib/time';
import type { ClassEvent } from '@/lib/types';

interface TodayClassesProps {
  events: ClassEvent[];
}

/** Today's classes in time order: name, time range, room. */
export default function TodayClasses({ events }: TodayClassesProps) {
  const classes = events.filter((e) => e.isClass).sort((a, b) => a.start - b.start);

  return (
    <Box component="section" aria-labelledby="today-classes">
      <Typography id="today-classes" variant="h3" component="h2" sx={{ mb: 1.5, minHeight: 28, display: 'flex', alignItems: 'center' }}>
        Today&apos;s classes
      </Typography>
      <Paper variant="outlined">
        {classes.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2.5 }}>
            No classes today
          </Typography>
        ) : (
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
        )}
      </Paper>
    </Box>
  );
}
