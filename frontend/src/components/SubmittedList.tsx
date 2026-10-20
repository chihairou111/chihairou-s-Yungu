import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { submittedGroups } from '@/lib/due';
import type { Assignment } from '@/lib/types';
import SubmittedCard from './SubmittedCard';
import { VISUALLY_HIDDEN } from './visually-hidden';

interface SubmittedListProps {
  items: Assignment[];
  now: number;
  /** The course to show, or null for all of them. A course with no submitted work here shows all. */
  courseId: number | null;
  onCourseChange(courseId: number | null): void;
}

const ALL = 'all';

/** The courses in the list, by name, each with how many of its assignments are in it. */
function coursesIn(items: Assignment[]): { id: number; name: string; count: number }[] {
  const byId = new Map<number, { id: number; name: string; count: number }>();
  for (const a of items) {
    const entry = byId.get(a.courseId) ?? { id: a.courseId, name: a.course, count: 0 };
    entry.count += 1;
    byId.set(a.courseId, entry);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Submitted work as small cards in one column, grouped by when it was handed in (This week / Last week / Earlier),
 * newest hand-in first.
 * When the work spans more than one course, a Course menu narrows the list to one of them.
 */
export default function SubmittedList({ items, now, courseId, onCourseChange }: SubmittedListProps) {
  const courses = coursesIn(items);
  const chosen = courses.some((c) => c.id === courseId) ? courseId : null;
  const shown = chosen === null ? items : items.filter((a) => a.courseId === chosen);
  const groups = submittedGroups(shown, now);
  return (
    <Box component="section" aria-labelledby="submitted-heading" sx={{ maxWidth: 720 }}>
      {/* The tab already names this list on screen; the heading gives the group headings a parent. */}
      <Typography id="submitted-heading" variant="h3" component="h2" sx={VISUALLY_HIDDEN}>
        Submitted work
      </Typography>
      {courses.length > 1 && (
        <TextField
          select
          size="small"
          label="Course"
          value={chosen === null ? ALL : String(chosen)}
          onChange={(event) => onCourseChange(event.target.value === ALL ? null : Number(event.target.value))}
          sx={{ mb: 3, width: { xs: '100%', sm: 320 } }}
        >
          <MenuItem value={ALL}>All courses ({items.length})</MenuItem>
          {courses.map((c) => (
            <MenuItem key={c.id} value={String(c.id)}>
              {c.name} ({c.count})
            </MenuItem>
          ))}
        </TextField>
      )}
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
