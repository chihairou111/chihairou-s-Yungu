'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
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
/** A px length as rem, so the grid's rows, axis and headers grow with the reader's text size. */
const rem = (px: number) => `${px / 16}rem`;
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
/**
 * The grid needs 592px of content width (a 720px window beside the rail); below it the same markup
 * reads as a per-day list. Up to 772px (a 900px window) the grid is the narrow one. These are
 * container queries on the content column, so the grid also reflows when the docked Today's classes
 * panel takes its space.
 */
const GRID_MIN_PX = 592;
const WIDE_GRID_MIN_PX = 772;
const GRID = `@container (min-width: ${GRID_MIN_PX}px)`;
const LIST = `@container (max-width: ${GRID_MIN_PX - 0.05}px)`;
const NARROW_GRID = `@container (min-width: ${GRID_MIN_PX}px) and (max-width: ${WIDE_GRID_MIN_PX - 0.05}px)`;
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
 * column. Mon–Fri always show, Sat/Sun only when they have classes. In a content column under 592px
 * (a phone, or a narrow window beside the docked panel) the same markup reflows into a per-day list
 * that opens at today.
 */
export default function WeekCalendar({ weekStart, events, courses, now: serverNow }: WeekCalendarProps) {
  const now = useNow(serverNow);
  const theme = useTheme();
  const surface = theme.palette.background.paper;
  const todayRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // In the grid a block may cut its name or room short, so each opens its full details; the list shows all of it.
  const [isGrid, setIsGrid] = useState(false);
  const [details, setDetails] = useState<{ anchor: HTMLElement; event: ClassEvent; open: boolean } | null>(null);
  const classes = events.filter((e) => e.isClass && dayIndex(e.start, weekStart) >= 0 && dayIndex(e.start, weekStart) < 7);
  const days = [0, 1, 2, 3, 4, 5, 6]
    .map((d) => ({ d, placed: layoutDay(classes.filter((e) => dayIndex(e.start, weekStart) === d)) }))
    .filter(({ d, placed }) => d < 5 || placed.length > 0);
  const today = dayIndex(now, weekStart);
  // The header range runs Monday to the last shown column.
  const shownDays = days[days.length - 1].d + 1;

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

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setIsGrid(body.clientWidth >= GRID_MIN_PX));
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  // The list opens at today (once, on arrival), so a Thursday does not start on Monday.
  useEffect(() => {
    const width = bodyRef.current?.clientWidth ?? 0;
    if (scrollToToday && width > 0 && width < GRID_MIN_PX) todayRef.current?.scrollIntoView?.({ block: 'start' });
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
          sx={{ whiteSpace: 'nowrap', py: 1, [theme.breakpoints.down('sm')]: { ml: 'auto', fontSize: '1rem', lineHeight: 1.5, fontWeight: 500 } }}
        >
          <Box component="span" sx={{ [theme.breakpoints.down('sm')]: VISUALLY_HIDDEN }}>
            {weekRangeLabel(weekStart, shownDays)}
          </Box>
          <Box component="span" aria-hidden="true" sx={{ display: { xs: 'inline', sm: 'none' } }}>
            {weekRangeShortLabel(weekStart, shownDays)}
          </Box>
        </Typography>
      </PageHeader>

      {/* A size container: grid or list follows the content width, not the window. */}
      <Box ref={bodyRef} sx={{ containerType: 'inline-size' }}>
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
              '--hour': rem(HOUR_PX),
              '--axis': rem(AXIS_PX),
              [NARROW_GRID]: { '--hour': rem(HOUR_NARROW_PX), '--axis': rem(AXIS_NARROW_PX) },
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
            <Box aria-hidden sx={{ display: 'none', [GRID]: { display: 'block' }, pt: `calc(${rem(HEADER_PX)} + ${TOP_PAD}px)`, pb: 1 }}>
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
                      [LIST]: { mb: 1, fontSize: '1rem', lineHeight: 1.5, fontWeight: 500 },
                      [GRID]: {
                        height: rem(HEADER_PX),
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
                        minWidth: rem(30),
                        height: rem(30),
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
                            onOpen={isGrid ? (anchor) => setDetails({ anchor, event: p.event, open: true }) : undefined}
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
      </Box>

      <Popover
        open={details?.open ?? false}
        anchorEl={details?.anchor}
        onClose={() => setDetails((d) => d && { ...d, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': details?.event.name,
            sx: (theme) => ({ mt: 0.5, px: 2, py: 1.5, maxWidth: 320, borderRadius: `${theme.yungu.shape.medium}px` }),
          },
        }}
      >
        {details && (
          <>
            <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
              {details.event.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {`${chinaClock(details.event.start)}–${chinaClock(details.event.end)}`}
            </Typography>
            {details.event.room && (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {details.event.room}
              </Typography>
            )}
          </>
        )}
      </Popover>
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
  /** Opens the class's full details from this block (grid only, where a block may cut its text short). */
  onOpen?: (anchor: HTMLElement) => void;
}

/**
 * A class in Google Calendar's light event style: a light tint of its course color, with name and
 * "08:00–08:40 · D419" in a dark shade of the same hue. Positioned by time in the grid; a full-width
 * row in the list. In the grid the room outranks the time, which the block's position already shows:
 * the narrow grid drops the end time, and a line still too long gives up the time rather than the room.
 */
function ClassBlock({ placed: { event, lane, lanes }, color, surface, weekStart, firstHour, onOpen }: ClassBlockProps) {
  const top = (minuteOfDay(event.start, weekStart) - firstHour * 60) / 60;
  const duration = (event.end - event.start) / MIN / 60;
  const { bg, fg } = lightEventColors(color, surface);
  // Grid geometry (in hours; the grid sets the length of an hour) travels as custom properties so one shared style rule serves every block.
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
      style={geometry}
      data-short={duration * HOUR_NARROW_PX < TWO_LINES_PX ? '' : undefined}
      sx={(theme) => ({
        bgcolor: 'var(--course-bg)',
        color: 'var(--course-fg)',
        borderRadius: `${theme.yungu.shape.small}px`,
        '& > .class-body': {
          display: 'block',
          width: '100%',
          m: 0,
          border: 0,
          borderRadius: 'inherit',
          bgcolor: 'transparent',
          color: 'inherit',
          font: 'inherit',
          letterSpacing: 'inherit',
          textAlign: 'start',
        },
        '& > button.class-body': {
          cursor: 'pointer',
          '@media (hover: hover)': { '&:hover': { bgcolor: 'color-mix(in srgb, currentColor 8%, transparent)' } },
          '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
        },
        [LIST]: { '& > .class-body': { px: 1.5, py: 1 } },
        [GRID]: {
          position: 'absolute',
          top: 'calc(var(--top) * var(--hour) + 1px)',
          height: 'calc(var(--duration) * var(--hour) - 2px)',
          left: 'calc(var(--left) + 4px)',
          width: 'calc(var(--width) - 8px)',
          '& > .class-body': { height: '100%', px: 1, py: 0.5, overflow: 'hidden' },
          '& .class-name': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          // One line: when time and room do not fit side by side the room wraps onto the line kept in view.
          '& .class-meta': { display: 'flex', flexWrap: 'wrap-reverse', alignContent: 'flex-end', height: '1.4em', overflow: 'hidden' },
          '& .class-time': { flex: 'none', whiteSpace: 'pre' },
          '& .class-room': { minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        },
        [NARROW_GRID]: {
          '& > .class-body': { px: 0.75 },
          '& .class-meta': { height: '1rem' },
          '& .class-end': { display: 'none' },
          '&[data-short] .class-meta': { display: 'none' },
        },
      })}
    >
      <Box
        className="class-body"
        {...(onOpen
          ? { component: 'button', type: 'button', 'aria-haspopup': 'dialog', onClick: (e: { currentTarget: HTMLElement }) => onOpen(e.currentTarget) }
          : {})}
      >
        <Typography
          className="class-name"
          variant="body2"
          sx={{
            color: 'inherit',
            fontWeight: 600,
            overflowWrap: 'anywhere',
            [LIST]: { lineHeight: 20 / 14 },
            [GRID]: { fontSize: '0.8125rem', lineHeight: 1.4 },
            [NARROW_GRID]: { fontSize: '0.75rem', lineHeight: '1rem' },
          }}
        >
          {event.name}
        </Typography>
        <Typography
          className="class-meta"
          variant="body2"
          sx={{
            color: 'inherit',
            overflowWrap: 'anywhere',
            [LIST]: { fontSize: '0.8125rem', lineHeight: 18 / 13 },
            [GRID]: { fontSize: '0.75rem', lineHeight: 1.4 },
            [NARROW_GRID]: { lineHeight: '1rem' },
          }}
        >
          <span className="class-time">
            {chinaClock(event.start)}
            <span className="class-end">–{chinaClock(event.end)}</span>
            {event.room ? ' · ' : ''}
          </span>
          {event.room && <span className="class-room">{event.room}</span>}
        </Typography>
      </Box>
    </Box>
  );
}
