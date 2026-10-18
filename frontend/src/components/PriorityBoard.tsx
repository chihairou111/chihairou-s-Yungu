import type SvgIcon from '@mui/material/SvgIcon';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import Schedule from '@mui/icons-material/Schedule';
import { groupTodo } from '@/lib/priority';
import type { Assignment, Priority } from '@/lib/types';
import AssignmentCard, { PRIORITY_TONE } from './AssignmentCard';

const COLUMNS: { priority: Priority; title: string; empty: string; Icon: typeof SvgIcon }[] = [
  { priority: 'overdue', title: 'Overdue', empty: 'Nothing overdue', Icon: ErrorOutline },
  { priority: 'nearly', title: 'Nearly overdue', empty: 'Nothing due soon', Icon: Schedule },
  { priority: 'upcoming', title: 'Upcoming', empty: 'Nothing upcoming', Icon: EventOutlined },
];

interface PriorityBoardProps {
  items: Assignment[];
  now: number;
}

/** To-do work in three columns by urgency; columns stack below 900px. */
export default function PriorityBoard({ items, now }: PriorityBoardProps) {
  const groups = groupTodo(items, now);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
        columnGap: 2,
        rowGap: 4,
        alignItems: 'start',
      }}
    >
      {COLUMNS.map(({ priority, title, empty, Icon }) => {
        const list = groups[priority];
        const tone = PRIORITY_TONE[priority];
        const headingId = `priority-${priority}`;
        return (
          <Box component="section" key={priority} aria-labelledby={headingId}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5, minHeight: 28 }}>
              <Icon aria-hidden sx={{ fontSize: 20, color: `${tone}.main` }} />
              <Typography id={headingId} variant="h3" component="h2">
                {title}
              </Typography>
              <Box
                component="span"
                sx={{
                  minWidth: 24,
                  height: 22,
                  px: 0.75,
                  borderRadius: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  bgcolor: `${tone}.light`,
                  color: `${tone}.dark`,
                }}
              >
                {list.length}
              </Box>
            </Stack>
            {list.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 2, py: 2.5, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1 }}
              >
                {empty}
              </Typography>
            ) : (
              <Stack sx={{ gap: 1.5 }}>
                {list.map((a) => (
                  <AssignmentCard key={a.id} assignment={a} now={now} variant={priority} />
                ))}
              </Stack>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
