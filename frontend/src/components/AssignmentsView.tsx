'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import type { Assignment } from '@/lib/types';
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
 * To-do | Submitted tabs attached to the app bar. To-do shows the work in priority columns. The tab
 * lives in the URL (`?tab=submitted`) so it survives reloads.
 */
export default function AssignmentsView({ todo, submitted, now }: AssignmentsViewProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: TabKey = params.get('tab') === 'submitted' ? 'submitted' : 'todo';

  function go(nextTab: TabKey) {
    // The native History API keeps useSearchParams in sync without a server round trip.
    window.history.replaceState(null, '', nextTab === 'submitted' ? `${pathname}?tab=submitted` : pathname);
  }

  return (
    <>
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
          <SubmittedList items={submitted} now={now} />
        )}
      </Box>
    </>
  );
}

