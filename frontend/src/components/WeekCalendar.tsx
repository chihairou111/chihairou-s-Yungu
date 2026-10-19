'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { alpha, useTheme } from '@mui/material/styles';
import { chinaClock, chinaDateLabel, dayIndex, formatWeekParam, shiftWeek, weekRangeLabel, weekRangeShortLabel } from '@/lib/time';
import { COURSE_COLORS, courseColorHex, lightEventColors } from '@/lib/colors';
import { nowLineHours } from '@/lib/schedule';
import type { ClassEvent, Course } from '@/lib/types';
import PageHeader from './PageHeader';
import { useNow } from './useNow';
import { VISUALLY_HIDDEN } from './visually-hidden';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** One hour of the grid: 72px (a 40-minute class gets 48px, two lines); 64px in the narrow grid. */
const HOUR_PX = 72;
const HOUR_NARROW_PX = 64;
/** Time axis width: 56px; 48px in the narrow grid. */
const AXIS_PX = 56;
const AXIS_NARROW_PX = 48;
const HEADER_PX = 56;
/** Space above the first hour line so its axis label is not clipped. */
const TOP_PAD = 8;
/** A block shorter than this (px, in the narrow grid) shows its name only. */
const TWO_LINES_PX = 40;
/** The grid needs 720px; below it the same markup reads as a per-day list. */
const LIST_QUERY = '(max-width: 719.95px)';
const GRID = '@media (min-width: 720px)';
const LIST = `@media ${LIST_QUERY}`;
const NARROW_GRID = '@media (min-width: 720px) and (max-width: 899.95px)';
/** Google Calendar's default event color, for a class whose course is unknown. */
const DEFAULT_COLOR = 'Peacock';

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
  /** Courses, for each class's color. */
  courses: Course[];
  /** Server time; decides which column is today. */
  now: number;
}

/**
 * One week of classes (China time): days across, time down, with a current-time line on today's
 * column. Mon–Fri always show, Sat/Sun only when they have classes. Below 720px the same markup
 * reflows into a per-day list that opens at today.
 */
export default function WeekCalendar({ weekStart, events, courses, now: serverNow }: WeekCalendarProps) {
  const now = useNow(serverNow);
  const theme = useTheme();
  const surface = theme.palette.background.paper;
  const todayRef = useRef<HTMLElement>(null);
  const classes = events.filter((e) => e.isClass && dayIndex(e.start, weekStart) >= 0 && dayIndex(e.start, weekStart) < 7);
  const days = [0, 1, 2, 3, 4, 5, 6]
    .map((d) => ({ d, placed: layoutDay(classes.filter((e) => dayIndex(e.start, weekStart) === d)) }))
    .filter(({ d, placed }) => d < 5 || placed.length > 0);
  const today = dayIndex(now, weekStart);

  const firstHour = Math.floor(Math.min(...classes.map((e) => minuteOfDay(e.start, weekStart))) / 60);
  const lastHour = Math.ceil(Math.max(...classes.map((e) => minuteOfDay(e.end, weekStart))) / 60);
  const hours = classes.length > 0 ? Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i) : [];
  const bodyHeight = `calc(${hours.length} * var(--hour))`;
  const colorOf = (e: ClassEvent) => {
    const course = courses.find((c) => c.id === e.courseId);
    return course ? courseColorHex(course.color) : COURSE_COLORS[DEFAULT_COLOR];
  };
  const nowLine = classes.length > 0 ? nowLineHours(now, weekStart, firstHour, hours.length) : null;
  const scrollToToday = days.some(({ d }) => d === today) && days[0].d !== today;

  // On a phone the list opens at today (once, on arrival), so a Thursday does not start on Monday.
  useEffect(() => {
    if (scrollToToday && window.matchMedia?.(LIST_QUERY).matches) todayRef.current?.scrollIntoView?.({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on arrival, not on every clock tick
  }, [weekStart]);

  return (
    <>
      {/* Week navigation on the app bar's surface, like the Assignments tabs. */}
      <PageHeader>
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
        {/* One row on phones: the range moves to the right end in its short form; the heading keeps the full range. */}
        <Typography
          variant="h2"
          sx={{ whiteSpace: 'nowrap', py: 1, [theme.breakpoints.down('sm')]: { ml: 'auto', fontSize: '1rem', lineHeight: '24px', fontWeight: 500 } }}
        >
          <Box component="span" sx={{ [theme.breakpoints.down('sm')]: VISUALLY_HIDDEN }}>
            {weekRangeLabel(weekStart)}
          </Box>
          <Box component="span" aria-hidden="true" sx={{ display: { xs: 'inline', sm: 'none' } }}>
            {weekRangeShortLabel(weekStart)}
          </Box>
        </Typography>
      </PageHeader>

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
            '--hour': `${HOUR_PX}px`,
            '--axis': `${AXIS_PX}px`,
            [NARROW_GRID]: { '--hour': `${HOUR_NARROW_PX}px`, '--axis': `${AXIS_NARROW_PX}px` },
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            [GRID]: {
              display: 'grid',
              gap: 0,
              gridTemplateColumns: `var(--axis) repeat(${days.length}, minmax(0, 1fr))`,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
            },
          }}
        >
          {/* Time axis (grid only). */}
          <Box aria-hidden sx={{ display: 'none', [GRID]: { display: 'block' }, pt: `${HEADER_PX + TOP_PAD}px`, pb: 1 }}>
            <Box sx={{ position: 'relative', height: bodyHeight }}>
              {hours.map((h, i) => (
                <Typography
                  key={h}
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    position: 'absolute',
                    top: `calc(${i} * var(--hour))`,
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
                ref={isToday ? todayRef : undefined}
                aria-labelledby={headingId}
                sx={{ minWidth: 0, [LIST]: { scrollMarginTop: { xs: 112, sm: 120 } }, [GRID]: { borderLeft: 1, borderColor: 'divider' } }}
              >
                <Typography
                  id={headingId}
                  variant="h3"
                  aria-current={isToday ? 'date' : undefined}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    [LIST]: { mb: 1, fontSize: '1rem', lineHeight: '24px', fontWeight: 500 },
                    [GRID]: {
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
                    sx={(theme) => ({
                      minWidth: 30,
                      height: 30,
                      px: 0.5,
                      borderRadius: `${theme.yungu.shape.full}px`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...(isToday && { bgcolor: 'primary.main', color: 'primary.contrastText' }),
                    })}
                  >
                    {date}
                  </Box>
                </Typography>

                <Box
                  sx={{
                    [GRID]: {
                      position: 'relative',
                      height: bodyHeight,
                      mt: `${TOP_PAD}px`,
                      mb: 1,
                      // Today's column is faintly tinted, besides its filled date.
                      bgcolor: isToday ? alpha(theme.palette.primary.main, 0.04) : undefined,
                      // A line at every inner hour; the header's border already marks the top...
                      backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 calc(var(--hour) - 1px), ${theme.palette.divider} calc(var(--hour) - 1px) var(--hour))`,
                      // ...and none at the last hour's end, which would double the frame's bottom border.
                      backgroundSize: `100% calc(${hours.length - 1} * var(--hour))`,
                      backgroundRepeat: 'no-repeat',
                    },
                  }}
                >
                  {nowLine?.day === d && <NowLine hours={nowLine.hours} />}
                  {placed.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1, [GRID]: { display: 'none' } }}>
                      No classes
                    </Typography>
                  ) : (
                    <Box
                      component="ol"
                      sx={{
                        m: 0,
                        p: 0,
                        listStyle: 'none',
                        [LIST]: { display: 'flex', flexDirection: 'column', gap: 0.5 },
                      }}
                    >
                      {placed.map((p, i) => (
                        // Same name and start can repeat (e.g. split study halls), so the index disambiguates.
                        <ClassBlock
                          key={`${p.event.start}-${p.event.name}-${i}`}
                          placed={p}
                          color={colorOf(p.event)}
                          surface={surface}
                          weekStart={weekStart}
                          firstHour={firstHour}
                        />
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

/** The current-time line across today's column: a 2px red line with a dot at the column's left edge. */
function NowLine({ hours }: { hours: number }) {
  return (
    <Box
      aria-hidden
      data-now-line=""
      style={{ '--now': String(hours) } as CSSProperties}
      sx={{
        display: 'none',
        [GRID]: {
          display: 'block',
          position: 'absolute',
          zIndex: 2,
          pointerEvents: 'none',
          left: 0,
          right: 0,
          top: 'calc(var(--now) * var(--hour) - 1px)',
          height: 2,
          bgcolor: 'error.main',
          '&::before': {
            content: '""',
            position: 'absolute',
            left: -6,
            top: -5,
            width: 12,
            height: 12,
            borderRadius: '50%',
            bgcolor: 'error.main',
          },
        },
      }}
    />
  );
}

interface ClassBlockProps {
  placed: PlacedEvent;
  /** Course color (hex): tinted for the fill, darkened for the text. */
  color: string;
  /** The surface the tint is laid over. */
  surface: string;
  weekStart: number;
  firstHour: number;
}

/**
 * A class in Google Calendar's light event style: a light tint of its course color, with name and
 * "08:00–08:40 · D419" in a dark shade of the same hue. Positioned by time in the grid; a full-width
 * row in the list.
 */
function ClassBlock({ placed: { event, lane, lanes }, color, surface, weekStart, firstHour }: ClassBlockProps) {
  const top = (minuteOfDay(event.start, weekStart) - firstHour * 60) / 60;
  const duration = (event.end - event.start) / MIN / 60;
  const meta = [`${chinaClock(event.start)}–${chinaClock(event.end)}`, event.room].filter(Boolean).join(' · ');
  const { bg, fg } = lightEventColors(color, surface);
  // Grid geometry (in hours; the grid sets px per hour) travels as custom properties so one shared style rule serves every block.
  const geometry = {
    '--course': color,
    '--course-bg': bg,
    '--course-fg': fg,
    '--top': String(top),
    '--duration': String(duration),
    '--left': `${(lane / lanes) * 100}%`,
    '--width': `${100 / lanes}%`,
  } as CSSProperties;

  return (
    <Box
      component="li"
      title={`${event.name}\n${meta}`}
      style={geometry}
      data-short={duration * HOUR_NARROW_PX < TWO_LINES_PX ? '' : undefined}
      sx={(theme) => ({
        bgcolor: 'var(--course-bg)',
        color: 'var(--course-fg)',
        borderRadius: `${theme.yungu.shape.small}px`,
        [LIST]: { px: 1.5, py: 1 },
        [GRID]: {
          position: 'absolute',
          top: 'calc(var(--top) * var(--hour) + 1px)',
          height: 'calc(var(--duration) * var(--hour) - 2px)',
          left: 'calc(var(--left) + 4px)',
          width: 'calc(var(--width) - 8px)',
          px: 1,
          py: 0.5,
          overflow: 'hidden',
          '& > *': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        },
        [NARROW_GRID]: { px: 0.75, '&[data-short] > :nth-of-type(2)': { display: 'none' } },
      })}
    >
      <Typography
        variant="body2"
        sx={{
          color: 'inherit',
          fontWeight: 600,
          overflowWrap: 'anywhere',
          [LIST]: { lineHeight: '20px' },
          [GRID]: { fontSize: '0.8125rem', lineHeight: 1.4 },
          [NARROW_GRID]: { fontSize: '0.75rem', lineHeight: '16px' },
        }}
      >
        {event.name}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: 'inherit',
          overflowWrap: 'anywhere',
          [LIST]: { fontSize: '0.8125rem', lineHeight: '18px' },
          [GRID]: { fontSize: '0.75rem', lineHeight: 1.4 },
          [NARROW_GRID]: { fontSize: '0.6875rem', lineHeight: '14px' },
        }}
      >
        {meta}
      </Typography>
    </Box>
  );
}
