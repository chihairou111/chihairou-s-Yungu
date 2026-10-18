'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import type { Assignment, ClassEvent } from '@/lib/types';
import PriorityBoard from './PriorityBoard';
import SubmittedList from './SubmittedList';
import TodayClasses from './TodayClasses';

type TabKey = 'todo' | 'submitted';

interface AssignmentsViewProps {
  todo: Assignment[];
  submitted: Assignment[];
  todayClasses: ClassEvent[];
  /** Server time, shared by every card so relative times agree. */
  now: number;
}

/** To-do | Submitted tabs; the open tab lives in `?tab=submitted` so it survives reloads. */
export default function AssignmentsView({ todo, submitted, todayClasses, now }: AssignmentsViewProps) {
  const pathname = usePathname();
  const tab: TabKey = useSearchParams().get('tab') === 'submitted' ? 'submitted' : 'todo';

  function selectTab(next: TabKey) {
    // The native History API keeps useSearchParams in sync without a server round trip.
    window.history.replaceState(null, '', next === 'submitted' ? `${pathname}?tab=submitted` : pathname);
  }

  return (
    <>
      <Tabs
        value={tab}
        onChange={(_, next: TabKey) => selectTab(next)}
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
      <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'todo' ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 280px' },
              columnGap: 3,
              rowGap: 4,
              alignItems: 'start',
            }}
          >
            <PriorityBoard items={todo} now={now} />
            <TodayClasses events={todayClasses} />
          </Box>
        ) : (
          <SubmittedList items={submitted} now={now} />
        )}
      </Box>
    </>
  );
}
