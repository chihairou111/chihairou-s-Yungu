import type { CSSProperties, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { courseColorHex, readableTextOn } from '@/lib/colors';
import { dueStatus, groupByCourse, type DueTone } from '@/lib/courses';
import { chinaClock } from '@/lib/time';
import type { Assignment, Course } from '@/lib/types';
import { VISUALLY_HIDDEN } from './visually-hidden';

const TONE_COLOR: Record<DueTone, string> = {
  error: 'error.main',
  warning: 'warning.dark',
  neutral: 'text.secondary',
};

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 288px), 1fr))',
  gap: 3,
  alignItems: 'stretch',
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
          <Box sx={GRID_SX}>
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
          <Box sx={GRID_SX}>
            {noWork.map((course) => (
              <CourseCard key={course.id} course={course}>
                <Typography variant="body2" color="text.secondary">
                  No work due
                </Typography>
              </CourseCard>
            ))}
          </Box>
        </Box>
      )}
    </>
  );
}

/** MD2 card: a header band in the course color with the course name, then a body. */
function CourseCard({ course, children }: { course: Course; children: ReactNode }) {
  const bg = courseColorHex(course.color);
  const headingId = `course-${course.id}`;
  return (
    <Card component="article" elevation={1} aria-labelledby={headingId} sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box
        style={{ '--course-bg': bg, '--course-fg': readableTextOn(bg) } as CSSProperties}
        sx={{ bgcolor: 'var(--course-bg)', color: 'var(--course-fg)', height: 96, px: 2, pt: 1.75 }}
      >
        <Typography
          id={headingId}
          variant="h3"
          sx={{
            color: 'inherit',
            fontSize: '1.25rem',
            fontWeight: 500,
            lineHeight: 1.35,
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {course.name}
        </Typography>
      </Box>
      <Box sx={{ px: 2, py: 2, minHeight: 88, flexGrow: 1 }}>{children}</Box>
    </Card>
  );
}

/** "Due today · 22:00" (no time once late) then the title. The label's words carry the urgency; color only reinforces it. */
function WorkLine({ assignment, now }: { assignment: Assignment; now: number }) {
  const status = dueStatus(assignment.dueAt, now);
  return (
    <li>
      <Typography variant="body2" sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>
        <Box component="span" sx={{ fontWeight: 600, color: TONE_COLOR[status.tone] }}>
          {status.label}
        </Box>
        {assignment.dueAt >= now && (
          <Box component="span" sx={{ color: 'text.secondary' }}>{` · ${chinaClock(assignment.dueAt)}`}</Box>
        )}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25, overflowWrap: 'anywhere', textWrap: 'pretty' }}>
        {assignment.title}
      </Typography>
    </li>
  );
}
