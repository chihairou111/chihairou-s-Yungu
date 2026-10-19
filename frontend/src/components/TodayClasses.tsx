'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { COURSE_COLORS, courseColorHex } from '@/lib/colors';
import { classTimeline, type ClassTiming } from '@/lib/schedule';
import { chinaClock } from '@/lib/time';
import type { ClassEvent, Course } from '@/lib/types';

const LABEL: Partial<Record<ClassTiming, string>> = { now: 'Now', next: 'Next' };
/** Dot (8) plus its gap (12): lines under the name start where the name does. */
const TEXT_INSET = 2.5;

interface TodayClassesProps {
  events: ClassEvent[];
  /** Decides which class is in progress, which is next and which have ended. */
  now: number;
  /** For each class's course-color dot. */
  courses: Course[];
}

/**
 * Today's classes as given (select and order them with `todaysClasses`): a course-color dot and the
 * name, then "HH:MM–HH:MM · room". The class in progress is labelled Now and the next one Next, and
 * the list opens scrolled to that row; ended classes recede. The surrounding surface (the drawer)
 * supplies the title.
 */
export default function TodayClasses({ events: classes, now, courses }: TodayClassesProps) {
  const timing = classTimeline(classes, now);
  const focus = timing.includes('now') ? timing.indexOf('now') : timing.indexOf('next');
  const focusRef = useRef<HTMLLIElement>(null);

  // Once, when the list opens: bring the class that matters now into view.
  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  if (classes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2.5 }}>
        No classes today
      </Typography>
    );
  }

  const colorOf = (e: ClassEvent) => {
    const course = courses.find((c) => c.id === e.courseId);
    return course ? courseColorHex(course.color) : COURSE_COLORS.Peacock;
  };

  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {classes.map((c, i) => {
        const ended = timing[i] === 'ended';
        const label = LABEL[timing[i]];
        return (
          <Box
            component="li"
            key={`${c.start}-${c.name}`}
            ref={i === focus ? focusRef : undefined}
            data-timing={timing[i]}
            style={{ '--course': colorOf(c) } as CSSProperties}
            sx={{
              px: 2,
              py: 1.5,
              minHeight: 64,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              '& + &': { borderTop: 1, borderColor: 'divider' },
            }}
          >
            {label && (
              <Typography
                component="span"
                sx={{ pl: TEXT_INSET, fontSize: '0.75rem', lineHeight: '16px', fontWeight: 600, color: 'primary.main' }}
              >
                {label}
              </Typography>
            )}
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
              <Box
                aria-hidden
                sx={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--course)', opacity: ended ? 0.5 : 1 }}
              />
              <Typography
                variant="body2"
                component="h3"
                sx={{ fontWeight: 600, overflowWrap: 'anywhere', color: ended ? 'text.secondary' : 'text.primary' }}
              >
                {c.name}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ pl: TEXT_INSET, overflowWrap: 'anywhere' }}>
              {[`${chinaClock(c.start)}–${chinaClock(c.end)}`, c.room].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
