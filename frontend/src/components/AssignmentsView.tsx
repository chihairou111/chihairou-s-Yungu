'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import Check from '@mui/icons-material/Check';
import type { Assignment, ClassEvent, Course } from '@/lib/types';
import CourseBoard from './CourseBoard';
import PageHeader from './PageHeader';
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
 * To-do | Submitted tabs attached to the app bar, and on To-do a By priority | By course switch at the
 * right end of the tab row. Both choices live in the URL
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
      <PageHeader>
        <Tabs value={tab} onChange={(_, next: TabKey) => go(next, view)} aria-label="Assignment lists">
          {/* Only the open tab's panel is mounted, so only that tab may point at it. */}
          <Tab value="todo" label="To-do" id="tab-todo" aria-controls={tab === 'todo' ? 'panel-todo' : undefined} />
          <Tab
            value="submitted"
            label="Submitted"
            id="tab-submitted"
            aria-controls={tab === 'submitted' ? 'panel-submitted' : undefined}
          />
        </Tabs>
        {/* Right end of the tab row from 600px; phones get the copy at the top of the panel. */}
        {tab === 'todo' && (
          <ViewSwitch view={view} onChange={(next) => go(tab, next)} sx={{ display: { xs: 'none', sm: 'inline-flex' }, ml: 'auto' }} />
        )}
      </PageHeader>
      {/* Room below the last card for the bottom-right button (40px + 16px inset + margin). */}
      <Box
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        // Phones already clear the bottom nav and the button with the shell's bottom padding.
        sx={(theme) => ({ [BOTTOM_FAB_MEDIA]: { pb: 9 }, [theme.breakpoints.down('sm')]: { pb: 0 } })}
      >
        {/* On phones the switch scrolls with the content, so only the title and tabs stay pinned. */}
        {tab === 'todo' && (
          <ViewSwitch view={view} onChange={(next) => go(tab, next)} sx={{ display: { xs: 'flex', sm: 'none' }, mb: 2 }} />
        )}
        {tab === 'todo' ? (
          view === 'course' ? (
            <CourseBoard courses={courses} items={todo} now={now} />
          ) : (
            <PriorityBoard items={todo} now={now} />
          )
        ) : (
          <SubmittedList items={submitted} now={now} />
        )}
      </Box>
      <TodayDrawer events={todayClasses} now={now} courses={courses} />
    </>
  );
}

interface ViewSwitchProps {
  view: ViewKey;
  onChange: (next: ViewKey) => void;
  sx: SxProps<Theme>;
}

/** The By priority | By course segmented button. Full width on phones, intrinsic width in the header. */
function ViewSwitch({ view, onChange, sx }: ViewSwitchProps) {
  // Material 3 segmented buttons mark the selected segment with a check.
  const { segmentedCheck } = useTheme().yungu;
  const check = (value: ViewKey) => (segmentedCheck && view === value ? <Check aria-hidden sx={{ fontSize: 18, mr: 1 }} /> : null);
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      color="primary"
      value={view}
      onChange={(_, next: ViewKey | null) => next && onChange(next)}
      aria-label="Group to-do work"
      sx={sx}
    >
      <ToggleButton value="priority" sx={{ px: 2, flex: { xs: 1, sm: 'none' } }}>
        {check('priority')}
        By priority
      </ToggleButton>
      <ToggleButton value="course" sx={{ px: 2, flex: { xs: 1, sm: 'none' } }}>
        {check('course')}
        By course
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
