'use client';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { chinaClock, chinaDateLabel, dayIndex, formatWeekParam, shiftWeek, weekRangeLabel } from '@/lib/time';
import type { ClassEvent } from '@/lib/types';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Height of one hour in the grid, in px. A 40-minute class gets 48px: two lines of text. */
const HOUR_PX = 72;
const HEADER_PX = 56;
const AXIS_PX = 56;
/** Space above the first hour line so its axis label is not clipped. */
const TOP_PAD = 8;
/** The grid needs the `md` breakpoint (900px); below it the same markup reads as a per-day list. */
const MD_UP = '@media (min-width: 900px)';
const MD_DOWN = '@media (max-width: 899.95px)';

export interface PlacedEvent {
  event: ClassEvent;
  /** Column inside its overlap cluster (0-based). */
  lane: number;
  /** Number of columns its overlap cluster needs. */
  lanes: number;
}

/** Splits one day's classes into side-by-side lanes so overlapping classes share the column width. */
export function layoutDay(events: ClassEvent[]): PlacedEvent[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: PlacedEvent[] = [];
  let cluster: PlacedEvent[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const event of sorted) {
    if (event.start >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= event.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = event.end;
    clusterEnd = cluster.length === 0 ? event.end : Math.max(clusterEnd, event.end);
    const p = { event, lane, lanes: 1 };
    cluster.push(p);
    placed.push(p);
  }
  closeCluster();
  return placed;
}

/** Minutes since China midnight of the event's day. */
function minuteOfDay(ms: number, weekStart: number): number {
  return (ms - weekStart - dayIndex(ms, weekStart) * DAY) / MIN;
}

interface WeekCalendarProps {
  /** Monday 00:00 China time of the week shown. */
  weekStart: number;
  events: ClassEvent[];
  /** Server time; decides which column is today. */
  now: number;
}

/**
 * One week of classes (China time): days across, time down. Mon–Fri always show,
 * Sat/Sun only when they have classes. Below 900px the same markup reflows into a
 * per-day list.
 */
export default function WeekCalendar({ weekStart, events, now }: WeekCalendarProps) {
  const classes = events.filter((e) => e.isClass && dayIndex(e.start, weekStart) >= 0 && dayIndex(e.start, weekStart) < 7);
  const days = [0, 1, 2, 3, 4, 5, 6]
    .map((d) => ({ d, placed: layoutDay(classes.filter((e) => dayIndex(e.start, weekStart) === d)) }))
    .filter(({ d, placed }) => d < 5 || placed.length > 0);
  const today = dayIndex(now, weekStart);

  const firstHour = Math.floor(Math.min(...classes.map((e) => minuteOfDay(e.start, weekStart))) / 60);
  const lastHour = Math.ceil(Math.max(...classes.map((e) => minuteOfDay(e.end, weekStart))) / 60);
  const hours = classes.length > 0 ? Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i) : [];
  const bodyPx = hours.length * HOUR_PX;

  return (
    <>
      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 1, mb: 2.5 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <Button component={Link} href="/calendar" variant="outlined" color="inherit" size="small" sx={{ mr: 1, borderColor: 'divider' }}>
            Today
          </Button>
          <IconButton component={Link} href={`/calendar?week=${formatWeekParam(shiftWeek(weekStart, -1))}`} aria-label="Previous week">
            <ChevronLeft />
          </IconButton>
          <IconButton component={Link} href={`/calendar?week=${formatWeekParam(shiftWeek(weekStart, 1))}`} aria-label="Next week">
            <ChevronRight />
          </IconButton>
        </Stack>
        <Typography variant="h2" sx={{ whiteSpace: 'nowrap' }}>
          {weekRangeLabel(weekStart)}
        </Typography>
      </Stack>

      {classes.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ px: 2, py: 2.5, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1 }}
        >
          No classes this week
        </Typography>
      ) : (
        <Box
          sx={{
            display: { xs: 'flex', md: 'grid' },
            flexDirection: 'column',
            gap: { xs: 3, md: 0 },
            gridTemplateColumns: `${AXIS_PX}px repeat(${days.length}, minmax(0, 1fr))`,
            [MD_UP]: {
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
            },
          }}
        >
          {/* Time axis (grid only). */}
          <Box aria-hidden sx={{ display: { xs: 'none', md: 'block' }, pt: `${HEADER_PX + TOP_PAD}px`, pb: 1 }}>
            <Box sx={{ position: 'relative', height: bodyPx }}>
              {hours.map((h, i) => (
                <Typography
                  key={h}
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    position: 'absolute',
                    top: i * HOUR_PX,
                    right: 8,
                    transform: 'translateY(-50%)',
                    lineHeight: 1,
                  }}
                >
                  {`${String(h).padStart(2, '0')}:00`}
                </Typography>
              ))}
            </Box>
          </Box>

          {days.map(({ d, placed }) => {
            const dayStart = weekStart + d * DAY;
            const [weekday, date] = chinaDateLabel(dayStart).split(' ');
            const isToday = d === today;
            const headingId = `day-${d}`;
            return (
              <Box
                component="section"
                key={d}
                aria-labelledby={headingId}
                sx={{ minWidth: 0, [MD_UP]: { borderLeft: 1, borderColor: 'divider' } }}
              >
                <Typography
                  id={headingId}
                  variant="h3"
                  aria-current={isToday ? 'date' : undefined}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: { xs: 1.5, md: 0 },
                    [MD_UP]: {
                      height: HEADER_PX,
                      justifyContent: 'center',
                      borderBottom: 1,
                      borderColor: 'divider',
                    },
                  }}
                >
                  <Box component="span" sx={{ color: isToday ? 'primary.main' : 'text.secondary', fontWeight: 500 }}>
                    {weekday}
                  </Box>{' '}
                  <Box
                    component="span"
                    sx={{
                      minWidth: 30,
                      height: 30,
                      px: 0.5,
                      borderRadius: 15,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...(isToday && { bgcolor: 'primary.main', color: 'primary.contrastText' }),
                    }}
                  >
                    {date}
                  </Box>
                </Typography>

                <Box
                  sx={{
                    [MD_UP]: {
                      position: 'relative',
                      height: bodyPx,
                      mt: `${TOP_PAD}px`,
                      mb: 1,
                      // A line at every inner hour; the header's border already marks the top...
                      backgroundImage: (t) =>
                        `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, ${t.palette.divider} ${HOUR_PX - 1}px ${HOUR_PX}px)`,
                      // ...and none at the last hour's end, which would double the frame's bottom border.
                      backgroundSize: `100% ${bodyPx - HOUR_PX}px`,
                      backgroundRepeat: 'no-repeat',
                    },
                  }}
                >
                  {placed.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5, [MD_UP]: { display: 'none' } }}>
                      No classes
                    </Typography>
                  ) : (
                    <Box
                      component="ol"
                      sx={{
                        m: 0,
                        p: 0,
                        listStyle: 'none',
                        [MD_DOWN]: {
                          bgcolor: 'background.paper',
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          '& > li:not(:first-of-type)': { borderTop: 1, borderColor: 'divider' },
                        },
                      }}
                    >
                      {placed.map((p, i) => (
                        // Same name and start can repeat (e.g. split study halls), so the index disambiguates.
                        <ClassBlock key={`${p.event.start}-${p.event.name}-${i}`} placed={p} weekStart={weekStart} firstHour={firstHour} />
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </>
  );
}

interface ClassBlockProps {
  placed: PlacedEvent;
  weekStart: number;
  firstHour: number;
}

/** A class: name, then "08:00–08:40 · D419". Positioned by time in the grid; a plain row in the list. */
function ClassBlock({ placed: { event, lane, lanes }, weekStart, firstHour }: ClassBlockProps) {
  const top = ((minuteOfDay(event.start, weekStart) - firstHour * 60) / 60) * HOUR_PX;
  const height = ((event.end - event.start) / MIN / 60) * HOUR_PX;
  const meta = [`${chinaClock(event.start)}–${chinaClock(event.end)}`, event.room].filter(Boolean).join(' · ');
  // Grid geometry travels as custom properties so one shared style rule serves every block.
  const geometry = {
    '--top': `${top}px`,
    '--height': `${height}px`,
    '--left': `${(lane / lanes) * 100}%`,
    '--width': `${100 / lanes}%`,
  } as CSSProperties;

  return (
    <Box
      component="li"
      title={`${event.name}\n${meta}`}
      style={geometry}
      sx={{
        [MD_DOWN]: { px: 2, py: 1.5 },
        [MD_UP]: {
          position: 'absolute',
          top: 'calc(var(--top) + 1px)',
          height: 'calc(var(--height) - 2px)',
          left: 'calc(var(--left) + 4px)',
          width: 'calc(var(--width) - 8px)',
          px: 1,
          py: 0.5,
          overflow: 'hidden',
          borderRadius: 1,
          border: 1,
          borderColor: 'color-mix(in srgb, var(--mui-palette-primary-main) 22%, transparent)',
          bgcolor: 'primary.light',
          '& > *': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          overflowWrap: 'anywhere',
          [MD_UP]: { fontSize: '0.8125rem', lineHeight: 1.4, color: 'primary.dark' },
        }}
      >
        {event.name}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          overflowWrap: 'anywhere',
          [MD_UP]: { fontSize: '0.75rem', lineHeight: 1.4, color: 'primary.main' },
        }}
      >
        {meta}
      </Typography>
    </Box>
  );
}
