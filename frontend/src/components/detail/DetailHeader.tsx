import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EventOutlined from '@mui/icons-material/EventOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import TimerOutlined from '@mui/icons-material/TimerOutlined';
import { dueLabel } from '@/lib/due';
import { relativeDue } from '@/lib/priority';
import { chinaDayNumber, chinaMonthDay } from '@/lib/time';
import type { AssignmentDetail } from '@/lib/types';

/** "About 45 min", "About 1 h 30 min", "About 2 h". */
export function estimateLabel(minutes: number): string {
  if (minutes < 60) return `About ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `About ${h} h` : `About ${h} h ${m} min`;
}

interface DetailHeaderProps {
  detail: AssignmentDetail;
  now: number;
  /** Id for the title, which names the dialog. */
  titleId: string;
}

/**
 * Course · teacher, the title, then the facts in one wrapping row: due (error tone while the work is
 * still to hand in and is late or due today), assigned date, estimated time. Work returned for revision
 * keeps its original deadline, which is never late.
 */
export default function DetailHeader({ detail, now, titleId }: DetailHeaderProps) {
  const late = !detail.revision && detail.dueAt < now;
  const urgent = !detail.submitted && (late || chinaDayNumber(detail.dueAt) === chinaDayNumber(now));
  const due = !detail.submitted && late ? `${dueLabel(detail.dueAt, now)} · ${relativeDue(detail.dueAt, now)}` : dueLabel(detail.dueAt, now);

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {detail.course} · {detail.teacher}
      </Typography>
      <Typography
        id={titleId}
        variant="h2"
        component="h2"
        sx={{ mt: 0.5, fontSize: { xs: '1.25rem', sm: '1.5rem' }, lineHeight: 1.3, overflowWrap: 'anywhere', textWrap: 'balance' }}
      >
        {detail.title}
      </Typography>
      <Stack
        component="ul"
        direction="row"
        sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.25, columnGap: 2.5, rowGap: 0.5, flexWrap: 'wrap' }}
      >
        <Fact icon={<EventOutlined />} tone={urgent ? 'error' : 'neutral'}>
          {due}
        </Fact>
        <Fact icon={<ScheduleOutlined />}>Assigned {chinaMonthDay(detail.assignedAt)}</Fact>
        {detail.estimatedMinutes !== null && (
          <Fact icon={<TimerOutlined />}>{estimateLabel(detail.estimatedMinutes)}</Fact>
        )}
      </Stack>
    </Box>
  );
}

function Fact({ icon, tone = 'neutral', children }: { icon: ReactNode; tone?: 'error' | 'neutral'; children: ReactNode }) {
  const error = tone === 'error';
  return (
    <Stack
      component="li"
      direction="row"
      data-tone={tone}
      sx={{
        alignItems: 'center',
        gap: 0.75,
        color: error ? 'error.main' : 'text.secondary',
        '& svg': { fontSize: 18 },
      }}
    >
      {icon}
      <Typography variant="body2" component="span" sx={{ color: 'inherit', fontWeight: error ? 600 : 400 }}>
        {children}
      </Typography>
    </Stack>
  );
}
