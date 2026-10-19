import type { CSSProperties, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { courseColorHex, readableTextOn } from '@/lib/colors';
import { dueStatus, groupByCourse, type DueTone } from '@/lib/courses';
import { dueParts } from '@/lib/due';
import type { Assignment, Course } from '@/lib/types';
import { VISUALLY_HIDDEN } from './visually-hidden';

const TONE_COLOR: Record<DueTone, string> = {
  error: 'error.main',
  warning: 'warning.dark',
  neutral: 'text.secondary',
};

/** Courses with work: about 288 wide, 4 across at 1280. */
const WORK_GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 288px), 1fr))',
  gap: { xs: 2, sm: 3 },
  alignItems: 'stretch',
} as const;

/** Courses without work: name-only cards, 5–6 across at 1280. */
const IDLE_GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
  gap: 2,
} as const;

interface CourseBoardProps {
  courses: Course[];
  /** To-do work; submitted items are ignored. */
  items: Assignment[];
  now: number;
}

/**
 * Google-Classroom-style course cards: courses with unsubmitted work first (most urgent first),
 * then, below a quiet divider, every other course marked "No work due".
 */
export default function CourseBoard({ courses, items, now }: CourseBoardProps) {
  const { withWork, noWork } = groupByCourse(courses, items, now);

  if (withWork.length === 0 && noWork.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No courses
      </Typography>
    );
  }

  return (
    <>
      {withWork.length > 0 && (
        <Box component="section" aria-labelledby="courses-with-work">
          <Typography id="courses-with-work" variant="h3" component="h2" sx={VISUALLY_HIDDEN}>
            Courses with work due
          </Typography>
          <Box sx={WORK_GRID_SX}>
            {withWork.map(({ course, items: work }) => (
              <CourseCard key={course.id} course={course}>
                <Stack component="ol" sx={{ m: 0, p: 0, listStyle: 'none', gap: 1.5 }}>
                  {work.map((a) => (
                    <WorkLine key={a.id} assignment={a} now={now} />
                  ))}
                </Stack>
              </CourseCard>
            ))}
          </Box>
        </Box>
      )}

      {noWork.length > 0 && (
        <Box component="section" aria-labelledby="courses-no-work" sx={{ mt: withWork.length > 0 ? 5 : 0 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mb: 2 }}>
            <Typography id="courses-no-work" variant="overline" component="h2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              No work due
            </Typography>
            <Divider sx={{ flexGrow: 1 }} />
          </Stack>
          <Box sx={IDLE_GRID_SX}>
            {noWork.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </Box>
        </Box>
      )}
    </>
  );
}

const CLAMP_2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const;

/**
 * Classroom-style card: a header band in the course color with the course name, then the work.
 * Without children it is the band alone, one line high: a quiet card for a course with no work due.
 */
function CourseCard({ course, children }: { course: Course; children?: ReactNode }) {
  const bg = courseColorHex(course.color);
  const headingId = `course-${course.id}`;
  const compact = children === undefined;
  return (
    <Card component="article" elevation={1} aria-labelledby={headingId} sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box
        style={{ '--course-bg': bg, '--course-fg': readableTextOn(bg) } as CSSProperties}
        sx={{
          bgcolor: 'var(--course-bg)',
          color: 'var(--course-fg)',
          px: 2,
          ...(compact
            ? { height: { xs: 48, sm: 56 }, display: 'flex', alignItems: 'center' }
            : { height: { xs: 64, sm: 72 }, pt: 1 }),
        }}
      >
        <Typography
          id={headingId}
          variant="h3"
          title={compact ? course.name : undefined}
          noWrap={compact}
          sx={{
            color: 'inherit',
            fontWeight: 500,
            minWidth: 0,
            ...(compact
              ? { fontSize: '1rem', lineHeight: '24px' }
              : {
                  fontSize: { xs: '1.125rem', sm: '1.25rem' },
                  lineHeight: { xs: '24px', sm: '28px' },
                  overflowWrap: 'anywhere',
                  ...CLAMP_2,
                }),
          }}
        >
          {course.name}
        </Typography>
      </Box>
      {!compact && <Box sx={{ p: 2, flexGrow: 1 }}>{children}</Box>}
    </Card>
  );
}

/**
 * The due line, then the title. Late work: "2 days late · Due Fri, Oct 16"; otherwise
 * "Due today · 22:00". The words carry the urgency; color only reinforces it.
 */
function WorkLine({ assignment, now }: { assignment: Assignment; now: number }) {
  const status = dueStatus(assignment.dueAt, now);
  const { day, time } = dueParts(assignment.dueAt, now);
  const [lead, rest] = time === null ? [status.label, day] : [day, time];
  return (
    <li>
      <Typography variant="body2" sx={{ fontSize: '0.8125rem', lineHeight: '18px' }}>
        <Box component="span" sx={{ fontWeight: 600, color: TONE_COLOR[status.tone] }}>
          {lead}
        </Box>
        <Box component="span" sx={{ color: 'text.secondary' }}>{` · ${rest}`}</Box>
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere', textWrap: 'pretty' }}>
        {assignment.title}
      </Typography>
    </li>
  );
}
