'use client';
import { Fragment, useId, useState, useTransition, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { keyframes, useTheme, type Theme } from '@mui/material/styles';
import { chinaMonth, earliestMonth, formatPoints, groupRecords, monthLabel, monthName, shiftMonth } from '@/lib/behaviour';
import { chinaClock, chinaShortDate } from '@/lib/time';
import type { Behaviour, BehaviourRecord } from '@/lib/types';
import PageHeader, { belowPageHeader } from './PageHeader';
import { EASE_OUT } from './detail/motion';
import { useNow } from './useNow';
import { VISUALLY_HIDDEN } from './visually-hidden';

const BEHAVIOUR = '/behaviour';
/**
 * From this content width the card and the list sit side by side (from the dock width, 1200px, even
 * with Today's classes docked); below it the card sits on top. A container query on the content
 * column, like the calendar's grid.
 */
const PANES_MIN_PX = 720;
const PANES = `@container (min-width: ${PANES_MIN_PX}px)`;
const STACKED = `@container (max-width: ${PANES_MIN_PX - 0.05}px)`;
/** Stacked: the card's fixed height, and the band it sticks in (8px above, 12px below). */
const STACKED_CARD_PX = 136;
const BAND_ABOVE_PX = 8;
const BAND_BELOW_PX = 12;
const BAND_PX = BAND_ABOVE_PX + STACKED_CARD_PX + BAND_BELOW_PX;
/** Side by side: the card stays this far below the page header. */
const CARD_TOP_PX = 24;

/** Bonus: the theme's success container; deductions: its error pair, like Overdue. Both AA. */
const plus = (theme: Theme) => ({ fg: theme.yungu.color.onSuccessContainer, bg: theme.yungu.color.successContainer });
const minus = (theme: Theme) => ({ fg: theme.palette.error.dark, bg: theme.palette.error.light });
/** Below this window height a sticky card would leave too little of the list; it scrolls away instead. */
const SHORT = '@media (max-height: 560px)';

/**
 * A stepped-to month arriving: from the dimmed state, rising a few px into place (strong ease-out, 200ms).
 * Reduced motion keeps the fade and drops the movement.
 */
const ARRIVE_MS = 200;
const arrive = keyframes`from { opacity: 0.6; transform: translateY(6px); } to { opacity: 1; transform: none; }`;
const arriveFade = keyframes`from { opacity: 0.6; } to { opacity: 1; }`;

const records = (n: number) => `${n} ${n === 1 ? 'record' : 'records'}`;

interface BehaviourViewProps {
  behaviour: Behaviour;
  /** Server time; decides "this month" and "This week". */
  now: number;
}

/**
 * One China month of 凌云积分: Yungu's own score, large, on a card with the month's bonus and deductions,
 * beside (or, on narrow screens, above) the records behind it, newest first. The card stays in place
 * while the list scrolls; group headings stick under the page header. The header steps months (back to
 * the start of the previous school year, never past this month) in a transition: the month shown dims
 * until the next one is in, which then rises into place.
 */
export default function BehaviourView({ behaviour, now: serverNow }: BehaviourViewProps) {
  const now = useNow(serverNow);
  const theme = useTheme();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Set by a step in the header, so only a month switch animates in (not the first load or a Refresh).
  const [stepped, setStepped] = useState(false);
  const { month } = behaviour;
  const current = chinaMonth(now);
  const prev = month > earliestMonth(now) ? shiftMonth(month, -1) : null;
  const next = month < current ? shiftMonth(month, 1) : null;
  const groups = groupRecords(behaviour.records, month, now);

  const go = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    // A new tab or window keeps the browser's own handling.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setStepped(true);
    startTransition(() => router.push(href));
  };
  const monthHref = (m: string) => `${BEHAVIOUR}?month=${m}`;
  // At a bound the arrow stays the same focusable link, marked unavailable and going nowhere: swapping
  // it for a disabled button would drop keyboard focus to the page when a step lands on the bound.
  const step = (target: string | null, label: string, Icon: typeof ChevronLeft) => (
    <IconButton
      component={Link}
      href={monthHref(target ?? month)}
      aria-label={label}
      aria-disabled={target ? undefined : 'true'}
      disableRipple={!target}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => (target ? go(e, monthHref(target)) : e.preventDefault())}
      sx={target ? undefined : { color: 'action.disabled', cursor: 'default', '&:hover': { bgcolor: 'transparent' } }}
    >
      <Icon />
    </IconButton>
  );

  return (
    <>
      <PageHeader>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <Button
            component={Link}
            href={BEHAVIOUR}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => go(e, BEHAVIOUR)}
            variant="outlined"
            color="inherit"
            size="small"
            sx={{ mr: 1, borderColor: 'divider' }}
          >
            This month
          </Button>
          {step(prev, 'Previous month', ChevronLeft)}
          {step(next, 'Next month', ChevronRight)}
        </Stack>
        <Typography
          variant="h2"
          sx={{ whiteSpace: 'nowrap', py: 1, [theme.breakpoints.down('sm')]: { ml: 'auto', fontSize: '1rem', lineHeight: '1.5rem', fontWeight: 500 } }}
        >
          {monthLabel(month)}
        </Typography>
      </PageHeader>

      {/* A size container: side by side or stacked follows the content width, not the window. */}
      <Box sx={{ containerType: 'inline-size' }}>
        <Box
          key={month}
          aria-busy={pending || undefined}
          sx={{
            // How far below the page header the card sticks, and the group headings under it.
            '--card-top': '0px',
            '--heading-top': `${BAND_PX}px`,
            display: 'grid',
            gap: 0,
            // A short window: the card scrolls away, so headings stick right under the page header.
            [SHORT]: { '--heading-top': '0px' },
            [PANES]: {
              '--card-top': `${CARD_TOP_PX}px`,
              '--heading-top': '0px',
              gridTemplateColumns: 'clamp(280px, 32%, 340px) minmax(0, 760px)',
              columnGap: 3,
              alignItems: 'start',
            },
            // The month shown stays while the next loads, dimmed after a beat so a quick switch never flickers.
            opacity: pending ? 0.6 : 1,
            transition: pending ? 'opacity 150ms ease 120ms' : 'opacity 150ms ease',
            ...(stepped && { animation: `${arrive} ${ARRIVE_MS}ms ${EASE_OUT}` }),
            '@media (prefers-reduced-motion: reduce)': { transition: 'none', ...(stepped && { animation: `${arriveFade} ${ARRIVE_MS}ms ${EASE_OUT}` }) },
          }}
        >
          <ScoreCard behaviour={behaviour} />
          <Box component="section" aria-labelledby="behaviour-records" sx={{ minWidth: 0 }}>
            <Typography id="behaviour-records" component="h2" sx={VISUALLY_HIDDEN}>
              Records
            </Typography>
            {groups.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 2, py: 2.5, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1 }}
              >
                {month === current ? 'No records this month' : `No records in ${monthName(month)}`}
              </Typography>
            ) : (
              <Stack sx={{ gap: 2 }}>
                {groups.map((g) => (
                  <Group key={g.label} label={g.label} records={g.records} />
                ))}
              </Stack>
            )}
          </Box>
        </Box>
      </Box>
    </>
  );
}

/** "91"; a score below zero reads "−3". */
const formatScore = (score: number) => (score < 0 ? `−${-score}` : String(score));

function ScoreCard({ behaviour }: { behaviour: Behaviour }) {
  const theme = useTheme();
  const score = formatScore(behaviour.score);
  const red = minus(theme);
  return (
    // The band it sticks in: the page's own surface, so the list scrolls out of sight beneath it.
    <Box
      sx={(t) => ({
        position: 'sticky',
        zIndex: 2,
        ...belowPageHeader(t, 'var(--card-top)'),
        [STACKED]: { bgcolor: 'background.default', mt: `-${BAND_ABOVE_PX}px`, pt: `${BAND_ABOVE_PX}px`, pb: `${BAND_BELOW_PX}px` },
        [SHORT]: { position: 'static' },
      })}
    >
      <Box
        component="section"
        aria-label={`凌云积分 ${score}`}
        sx={{
          bgcolor: 'background.paper',
          borderRadius: `${theme.yungu.shape.large}px`,
          px: 3.25,
          pt: 3.5,
          pb: 3.25,
          [STACKED]: {
            height: STACKED_CARD_PX,
            px: 2.5,
            py: 2,
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gridTemplateRows: 'auto 1fr',
            columnGap: 2.5,
          },
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ [STACKED]: { gridColumn: '1 / -1' } }}>
          凌云积分 · {monthName(behaviour.month)}
        </Typography>
        <Box
          component="p"
          sx={{
            m: 0,
            mt: 1.25,
            ml: '-0.04em',
            fontSize: 128,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            fontVariantNumeric: 'tabular-nums',
            [STACKED]: { fontSize: 84, mt: 0.5, alignSelf: 'end' },
          }}
        >
          {score}
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 1.25,
            mt: 3,
            [STACKED]: { gridTemplateColumns: 'auto', alignContent: 'end', justifyItems: 'start', gap: 0.75, mt: 0, pb: 0.75 },
          }}
        >
          <Chip label="Bonus" value={formatPoints(behaviour.bonus)} count={behaviour.bonusCount} tone={plus(theme)} />
          <Chip label="Deductions" value={formatPoints(behaviour.deduction)} count={behaviour.deductionCount} tone={red} />
        </Box>
      </Box>
    </Box>
  );
}

function Chip({ label, value, count, tone }: { label: string; value: string; count: number; tone: { fg: string; bg: string } }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        bgcolor: tone.bg,
        color: tone.fg,
        borderRadius: `${theme.yungu.shape.medium}px`,
        px: 1.5,
        py: 1.25,
        fontSize: '0.8125rem',
        lineHeight: 1.35,
        // Stacked: one compact line, "+8 · 5 records"; the side is said by the sign and colour, and to screen readers.
        [STACKED]: { display: 'flex', alignItems: 'baseline', gap: 0.5, px: 1.25, py: 0.5, borderRadius: `${theme.yungu.shape.small}px` },
      }}
    >
      <Box component="span" sx={{ display: 'block', [STACKED]: VISUALLY_HIDDEN }}>
        {label}
      </Box>
      <Box component="b" sx={{ display: 'block', fontSize: '1.375rem', lineHeight: 1.3, fontWeight: 600, [STACKED]: { fontSize: '0.9375rem' } }}>
        {value}
      </Box>
      <Box component="span" aria-hidden sx={{ display: 'none', [STACKED]: { display: 'inline' } }}>
        ·
      </Box>
      <Box component="span">{records(count)}</Box>
    </Box>
  );
}

function Group({ label, records: list }: { label: string; records: BehaviourRecord[] }) {
  const id = useId();
  return (
    <Box role="group" aria-labelledby={id}>
      <Typography
        id={id}
        variant="body2"
        component="h3"
        color="text.secondary"
        sx={(t) => ({
          position: 'sticky',
          zIndex: 1,
          ...belowPageHeader(t, 'var(--heading-top)'),
          bgcolor: 'background.default',
          fontWeight: 500,
          py: 0.75,
          mb: 0.5,
        })}
      >
        {label}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
        {list.map((r) => (
          <Row key={r.id} record={r} />
        ))}
      </Box>
    </Box>
  );
}

function Row({ record: r }: { record: BehaviourRecord }) {
  const theme = useTheme();
  // A revoked record keeps its sign but loses its colour: struck through in the secondary text tone,
  // which still reads at AA (a fade would not).
  const tone = r.kind === 'tier' || r.revoked ? null : (r.points ?? 0) >= 0 ? plus(theme) : minus(theme);
  const badge = r.points === null ? `Level ${r.level ?? ''}`.trim() : formatPoints(r.points);
  const meta = [r.subject, r.recorder, r.revoked ? 'not counted' : r.kind === 'tier' ? 'no points' : null].filter((x): x is string => Boolean(x));
  const struck = r.revoked ? { textDecorationLine: 'line-through', color: 'text.secondary' } : {};
  // Each detail wraps as a whole where it can, so a line never breaks inside a teacher's name.
  const unit = { display: 'inline-block', maxWidth: '100%' } as const;
  const small = { fontSize: '0.8125rem', lineHeight: '1.125rem', color: 'text.secondary' } as const;
  return (
    <Box
      component="li"
      sx={{
        display: 'grid',
        gridTemplateColumns: '56px minmax(0, 1fr) auto',
        gridTemplateAreas: '"badge name when" "badge meta meta" ". note note"',
        columnGap: 1.75,
        rowGap: 0.5,
        alignItems: 'start',
        bgcolor: 'background.paper',
        borderRadius: `${theme.yungu.shape.medium}px`,
        px: 2,
        py: 1.5,
        [STACKED]: {
          gridTemplateColumns: '48px minmax(0, 1fr)',
          gridTemplateAreas: '"badge name" "badge info" ". note"',
          columnGap: 1.5,
          px: 1.5,
        },
      }}
    >
      <Box
        sx={{
          gridArea: 'badge',
          height: 40,
          display: 'grid',
          placeItems: 'center',
          borderRadius: `${theme.yungu.shape.small + 2}px`,
          bgcolor: tone ? tone.bg : theme.yungu.color.surfaceContainerHighest,
          color: tone ? tone.fg : 'text.secondary',
          fontSize: r.points === null ? '0.75rem' : '1.0625rem',
          fontWeight: r.points === null ? 600 : 700,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        <Box component="span" sx={struck}>
          {badge}
        </Box>
      </Box>
      <Typography component="p" sx={{ gridArea: 'name', fontSize: '0.9375rem', fontWeight: 600, lineHeight: '1.375rem', overflowWrap: 'anywhere' }}>
        <Box component="span" data-name="" sx={struck}>
          {r.name}
        </Box>
        {r.revoked && (
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              ml: 1,
              px: 1,
              py: '1px',
              borderRadius: `${theme.yungu.shape.extraSmall + 2}px`,
              bgcolor: theme.yungu.color.surfaceContainerHighest,
              color: 'text.secondary',
              fontSize: '0.75rem',
              fontWeight: 600,
              lineHeight: '1.125rem',
              verticalAlign: '1px',
            }}
          >
            Revoked
          </Box>
        )}
      </Typography>
      {/* Side by side: the time at the right of the name and the details below; stacked: one line, time first. */}
      <Box sx={{ display: 'contents', [STACKED]: { display: 'block', gridArea: 'info', ...small } }}>
        <Box
          component="time"
          dateTime={new Date(r.at).toISOString()}
          sx={{ gridArea: 'when', textAlign: 'right', whiteSpace: 'nowrap', ...small, [STACKED]: { ...unit, textAlign: 'left' } }}
        >
          {chinaShortDate(r.at)} · {chinaClock(r.at)}
        </Box>
        {meta.length > 0 && (
          <>
            <Box component="span" aria-hidden sx={{ display: 'none', [STACKED]: { display: 'inline' } }}>
              {' · '}
            </Box>
            <Box component="span" sx={{ gridArea: 'meta', ...small, overflowWrap: 'anywhere' }}>
              {meta.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  <Box component="span" sx={unit}>
                    {part}
                  </Box>
                </Fragment>
              ))}
            </Box>
          </>
        )}
      </Box>
      {r.remark && (
        <Typography variant="body2" sx={{ gridArea: 'note', mt: 0.25, overflowWrap: 'anywhere' }}>
          “{r.remark}”
        </Typography>
      )}
    </Box>
  );
}
