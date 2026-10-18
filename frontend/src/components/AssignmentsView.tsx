'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import type { Assignment, ClassEvent, Course } from '@/lib/types';
import CourseBoard from './CourseBoard';
import PriorityBoard from './PriorityBoard';
import SubmittedList from './SubmittedList';
import TodayDrawer, { BOTTOM_FAB_MEDIA } from './TodayDrawer';

type TabKey = 'todo' | 'submitted';
type ViewKey = 'priority' | 'course';

interface AssignmentsViewProps {
  todo: Assignment[];
  submitted: Assignment[];
  courses: Course[];
  todayClasses: ClassEvent[];
  /** Server time, shared by every card so relative times agree. */
  now: number;
}

/**
 * To-do | Submitted tabs, and on To-do a By priority | By course view. Both choices live in the URL
 * (`?tab=submitted`, `?view=course`) so they survive reloads.
 */
export default function AssignmentsView({ todo, submitted, courses, todayClasses, now }: AssignmentsViewProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: TabKey = params.get('tab') === 'submitted' ? 'submitted' : 'todo';
  const view: ViewKey = params.get('view') === 'course' ? 'course' : 'priority';

  function go(nextTab: TabKey, nextView: ViewKey) {
    const query = new URLSearchParams();
    if (nextTab === 'submitted') query.set('tab', 'submitted');
    if (nextView === 'course') query.set('view', 'course');
    const qs = query.toString();
    // The native History API keeps useSearchParams in sync without a server round trip.
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <Tabs
        value={tab}
        onChange={(_, next: TabKey) => go(next, view)}
        aria-label="Assignment lists"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        {/* Only the open tab's panel is mounted, so only that tab may point at it. */}
        <Tab value="todo" label="To-do" id="tab-todo" aria-controls={tab === 'todo' ? 'panel-todo' : undefined} />
        <Tab
          value="submitted"
          label="Submitted"
          id="tab-submitted"
          aria-controls={tab === 'submitted' ? 'panel-submitted' : undefined}
        />
      </Tabs>
      {/* Room below the last card for the bottom-right button (40px + 16px inset + margin). */}
      <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} sx={{ [BOTTOM_FAB_MEDIA]: { pb: 9 } }}>
        {tab === 'todo' ? (
          <>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={view}
              onChange={(_, next: ViewKey | null) => next && go(tab, next)}
              aria-label="Group to-do work"
              sx={{ mb: 3 }}
            >
              <ToggleButton value="priority" sx={{ px: 2 }}>
                By priority
              </ToggleButton>
              <ToggleButton value="course" sx={{ px: 2 }}>
                By course
              </ToggleButton>
            </ToggleButtonGroup>
            {view === 'course' ? (
              <CourseBoard courses={courses} items={todo} now={now} />
            ) : (
              <PriorityBoard items={todo} now={now} />
            )}
          </>
        ) : (
          <SubmittedList items={submitted} now={now} />
        )}
      </Box>
      <TodayDrawer events={todayClasses} />
    </>
  );
}
