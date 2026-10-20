'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import type { Assignment } from '@/lib/types';
import AssignmentDialog from './detail/AssignmentDialog';
import { OpenTaskContext, useTaskParam } from './detail/useTaskParam';
import PageHeader from './PageHeader';
import PriorityBoard from './PriorityBoard';
import SubmittedList from './SubmittedList';

type TabKey = 'todo' | 'submitted';

interface AssignmentsViewProps {
  todo: Assignment[];
  submitted: Assignment[];
  /** Server time, shared by every card so relative times agree. */
  now: number;
}

/**
 * To-do | Submitted tabs attached to the app bar. To-do shows the work in priority columns. The tab and
 * the Submitted course filter live in the URL (`?tab=submitted&course=ID`) so they survive reloads. Cards
 * open their assignment in the detail pop-up (`?task=ID`), mounted here over the lists.
 */
export default function AssignmentsView({ todo, submitted, now }: AssignmentsViewProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: TabKey = params.get('tab') === 'submitted' ? 'submitted' : 'todo';
  const rawCourse = params.get('course');
  const courseId = rawCourse !== null && /^[0-9]+$/.test(rawCourse) ? Number(rawCourse) : null;
  const { open } = useTaskParam();

  function go(nextTab: TabKey) {
    // The native History API keeps useSearchParams in sync without a server round trip.
    window.history.replaceState(null, '', nextTab === 'submitted' ? `${pathname}?tab=submitted` : pathname);
  }

  /** Keeps the Submitted course filter in the URL (`&course=ID`) beside whatever else is there. */
  function chooseCourse(next: number | null) {
    const query = new URLSearchParams(params.toString());
    if (next === null) query.delete('course');
    else query.set('course', String(next));
    const search = query.toString();
    window.history.replaceState(null, '', search ? `${pathname}?${search}` : pathname);
  }

  return (
    <OpenTaskContext.Provider value={open}>
      <PageHeader>
        <Tabs value={tab} onChange={(_, next: TabKey) => go(next)} aria-label="Assignment lists">
          {/* Only the open tab's panel is mounted, so only that tab may point at it. */}
          <Tab value="todo" label="To-do" id="tab-todo" aria-controls={tab === 'todo' ? 'panel-todo' : undefined} />
          <Tab
            value="submitted"
            label="Submitted"
            id="tab-submitted"
            aria-controls={tab === 'submitted' ? 'panel-submitted' : undefined}
          />
        </Tabs>
      </PageHeader>
      <Box
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        // A size container, so the columns follow the space left beside the docked panel.
        sx={{ containerType: 'inline-size' }}
      >
        {tab === 'todo' ? (
          <PriorityBoard items={todo} now={now} />
        ) : (
          <SubmittedList items={submitted} now={now} courseId={courseId} onCourseChange={chooseCourse} />
        )}
      </Box>
      <AssignmentDialog now={now} />
    </OpenTaskContext.Provider>
  );
}

