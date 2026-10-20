import type SvgIcon from '@mui/material/SvgIcon';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import Schedule from '@mui/icons-material/Schedule';
import { upcomingGroups } from '@/lib/due';
import { groupTodo } from '@/lib/priority';
import type { Assignment, Priority } from '@/lib/types';
import AssignmentCard, { PRIORITY_TONE } from './AssignmentCard';

const COLUMNS: { priority: Priority; title: string; empty: string; Icon: typeof SvgIcon }[] = [
  { priority: 'overdue', title: 'Overdue', empty: 'Nothing overdue', Icon: ErrorOutline },
  { priority: 'nearly', title: 'Nearly overdue', empty: 'Nothing due soon', Icon: Schedule },
  { priority: 'upcoming', title: 'Upcoming', empty: 'Nothing upcoming', Icon: EventOutlined },
];

/** Upcoming gets date sub-groups from this many items; shorter lists read fine flat. */
const SUB_GROUP_FROM = 4;

interface PriorityBoardProps {
  items: Assignment[];
  now: number;
}

/**
 * To-do work in three columns by urgency when the content area is at least 760px wide (from a 900px
 * window, or a wider one while the Today's classes panel is docked); one column, at most 720 wide,
 * below that. Columns with work come first, the empty ones after, each group in urgency order. Measured on the nearest size container (the tab panel), falling back to one column.
 */
export default function PriorityBoard({ items, now }: PriorityBoardProps) {
  const groups = groupTodo(items, now);
  if (COLUMNS.every(({ priority }) => groups[priority].length === 0)) return <AllClear />;
  // Columns with work first, then the empty ones, each group in the fixed urgency order. The DOM order is
  // the visual order in the three-column grid and the stacked one alike.
  const columns = [...COLUMNS.filter((c) => groups[c.priority].length > 0), ...COLUMNS.filter((c) => groups[c.priority].length === 0)];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        maxWidth: 720,
        '@container (min-width: 760px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', maxWidth: 'none' },
        columnGap: 3,
        rowGap: 4,
        alignItems: 'start',
      }}
    >
      {columns.map(({ priority, title, empty, Icon }) => {
        const list = groups[priority];
        const tone = PRIORITY_TONE[priority];
        const headingId = `priority-${priority}`;
        const dated = priority === 'upcoming' && list.length >= SUB_GROUP_FROM ? upcomingGroups(list, now) : null;
        return (
          <Box component="section" key={priority} aria-labelledby={headingId}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5, minHeight: 28 }}>
              <Icon aria-hidden sx={{ fontSize: 20, color: `${tone}.main` }} />
              <Typography id={headingId} variant="h3" component="h2">
                {title}
              </Typography>
              <Box
                component="span"
                sx={(theme) => ({
                  minWidth: 24,
                  height: 22,
                  px: 0.75,
                  borderRadius: `${theme.yungu.shape.full}px`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  bgcolor: `${tone}.light`,
                  color: `${tone}.dark`,
                })}
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
            ) : dated ? (
              dated.map((group, i) => {
                const groupId = `upcoming-${i}`;
                return (
                  <Box component="section" key={group.label} aria-labelledby={groupId} sx={{ mt: i === 0 ? 0 : 2 }}>
                    <Typography
                      id={groupId}
                      variant="body2"
                      component="h3"
                      color="text.secondary"
                      sx={{ fontSize: '0.8125rem', lineHeight: '18px', fontWeight: 500, mb: 1 }}
                    >
                      {group.label}
                    </Typography>
                    <Cards items={group.items} now={now} priority={priority} headingLevel={4} />
                  </Box>
                );
              })
            ) : (
              <Cards items={list} now={now} priority={priority} headingLevel={3} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function Cards({ items, now, priority, headingLevel }: { items: Assignment[]; now: number; priority: Priority; headingLevel: 3 | 4 }) {
  return (
    <Stack sx={{ gap: 1.5 }}>
      {items.map((a) => (
        <AssignmentCard key={a.id} assignment={a} now={now} variant={priority} headingLevel={headingLevel} />
      ))}
    </Stack>
  );
}

/** Nothing due at all: one calm message instead of three empty columns. */
function AllClear() {
  return (
    <Stack sx={{ alignItems: 'center', textAlign: 'center', py: 6, mx: 'auto', maxWidth: 360 }}>
      <CheckCircleOutline aria-hidden sx={{ fontSize: 40, color: 'success.main', mb: 1.5 }} />
      <Typography variant="h3" component="h2">
        Nothing to do
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        New work from task.yungu.org will appear here.
      </Typography>
    </Stack>
  );
}
