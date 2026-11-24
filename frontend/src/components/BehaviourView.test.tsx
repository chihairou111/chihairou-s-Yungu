import { render, screen, within } from './test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Behaviour, BehaviourRecord } from '@/lib/types';
import BehaviourView from './BehaviourView';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/behaviour',
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
}));

/** China wall clock (UTC+8) to ms; the tests run with the host in Los Angeles. */
const china = (mo: number, d: number, h = 12, mi = 0) => Date.UTC(2026, mo - 1, d, h - 8, mi);
const NOW = china(10, 21, 9, 30); // Wed Oct 21, 09:30 China

const rec = (id: string, at: number, extra: Partial<BehaviourRecord> = {}): BehaviourRecord => ({
  id,
  name: `行为 ${id}`,
  points: 2,
  level: null,
  kind: 'bonus',
  at,
  subject: 'H Algebra 2 I',
  recorder: 'Teacher 1',
  remark: null,
  revoked: false,
  ...extra,
});

const RECORDS: BehaviourRecord[] = [
  rec('1', china(10, 21, 7, 33), { name: '作业未按时提交', points: -3, kind: 'deduction', remark: '课后任务第三题没有交' }),
  rec('2', china(10, 20, 10, 20), { name: '课堂发言积极', subject: 'CL Business I', recorder: 'Teacher 2' }),
  rec('tier-3', china(10, 19, 0, 5), { name: '迟到', points: null, level: 1, kind: 'tier', subject: null, recorder: 'System' }),
  rec('4', china(10, 15, 14, 2), { name: '课堂使用手机', points: -5, kind: 'deduction', revoked: true }),
  rec('5', china(10, 1, 0, 30), { name: '按时完成作业', points: 1, subject: null }), // Sep 30 16:30 UTC
];

// Deliberately not 100 + the rows: the card shows Yungu's number, never a sum of its own.
const OCTOBER: Behaviour = { month: '2026-10', score: 91, bonus: 8, deduction: -17, bonusCount: 4, deductionCount: 5, records: RECORDS };
const EMPTY = (month: string): Behaviour => ({ month, score: 100, bonus: 0, deduction: 0, bonusCount: 0, deductionCount: 0, records: [] });

function show(behaviour: Behaviour = OCTOBER, now = NOW) {
  return render(<BehaviourView behaviour={behaviour} now={now} />);
}

const card = () => screen.getByRole('region', { name: /^凌云积分/ });
const rows = () => screen.getAllByRole('listitem');
const row = (name: string) => rows().find((li) => li.textContent?.includes(name))!;

// The view follows the device clock after mount (useNow): it is held at NOW, so "this month" stays October.
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  nav.push.mockReset();
  vi.restoreAllMocks();
});

describe('BehaviourView card', () => {
  it("shows Yungu's score, named for screen readers, under the month's label", () => {
    show();
    expect(card()).toHaveAccessibleName('凌云积分 91');
    expect(within(card()).getByText('凌云积分 · October')).toBeVisible();
    expect(within(card()).getByText('91')).toBeVisible();
  });

  it('shows bonus and deductions with their counted records, and no base line', () => {
    show();
    const bonus = within(card()).getByText('Bonus').parentElement!;
    expect(bonus).toHaveTextContent(/\+8.*4 records/);
    const deductions = within(card()).getByText('Deductions').parentElement!;
    expect(deductions).toHaveTextContent(/−17.*5 records/);
    expect(document.body).not.toHaveTextContent(/base/i);
  });

  it('one record is "1 record"; none is "0 records" and an unsigned 0', () => {
    show({ ...OCTOBER, bonus: 2, bonusCount: 1, deduction: 0, deductionCount: 0 });
    expect(within(card()).getByText('Bonus').parentElement).toHaveTextContent(/\+2.*1 record$/);
    expect(within(card()).getByText('Deductions').parentElement).toHaveTextContent(/^Deductions0.*0 records$/);
  });
});

describe('BehaviourView structure', () => {
  it('week groups are groups, not landmarks', () => {
    show();
    expect(screen.queryAllByRole('region').map((r) => r.getAttribute('aria-label') ?? r.getAttribute('aria-labelledby'))).toHaveLength(2);
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });

  it("bonus colours come from the theme's success container", () => {
    show();
    const badge = within(row('课堂发言积极')).getByText('+2').parentElement!;
    expect(badge).toHaveStyle({
      backgroundColor: 'var(--yungu-success-container)',
      color: 'var(--yungu-on-success-container)',
    });
  });
});

describe('BehaviourView list', () => {
  it('lists records newest first under This week and Earlier in October', () => {
    show();
    const thisWeek = screen.getByRole('group', { name: 'This week' });
    const earlier = screen.getByRole('group', { name: 'Earlier in October' });
    expect(within(thisWeek).getAllByRole('listitem').map((li) => li.querySelector('[data-name]')?.textContent)).toEqual([
      '作业未按时提交',
      '课堂发言积极',
      '迟到',
    ]);
    expect(within(earlier).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 3, name: 'This week' })).toBeVisible();
  });

  it('a row shows points, name, China date and time, subject · teacher, and the remark', () => {
    show();
    const r = row('作业未按时提交');
    expect(r).toHaveTextContent('−3');
    expect(r).toHaveTextContent('Wed, Oct 21 · 07:33');
    expect(r).toHaveTextContent('H Algebra 2 I · Teacher 1');
    expect(r).toHaveTextContent('“课后任务第三题没有交”');
    expect(within(r).getByText('Wed, Oct 21 · 07:33').closest('time')).toHaveAttribute('datetime', new Date(RECORDS[0].at).toISOString());
    expect(row('课堂发言积极')).toHaveTextContent('+2');
  });

  it('dates are China time: 00:30 on Oct 1 is October 1, not September 30', () => {
    show();
    expect(row('按时完成作业')).toHaveTextContent('Thu, Oct 1 · 00:30');
  });

  it('a revoked record is struck through, tagged and not counted', () => {
    show();
    const r = row('课堂使用手机');
    expect(within(r).getByText('Revoked')).toBeVisible();
    expect(r).toHaveTextContent('not counted');
    expect(within(r).getByText('课堂使用手机')).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(within(r).getByText('−5')).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(within(row('课堂发言积极')).getByText('课堂发言积极')).not.toHaveStyle({ textDecorationLine: 'line-through' });
  });

  it('a tier record shows its level instead of points', () => {
    show();
    const r = row('迟到');
    expect(within(r).getByText('Level 1')).toBeVisible();
    expect(r).toHaveTextContent('System · no points');
  });

  it('an empty month says so and keeps the card', () => {
    show(EMPTY('2026-10'));
    expect(screen.getByText('No records this month')).toBeVisible();
    expect(card()).toHaveAccessibleName('凌云积分 100');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('an empty past month names the month', () => {
    show(EMPTY('2026-07'));
    expect(screen.getByText('No records in July')).toBeVisible();
  });

  it('a past month groups by week', () => {
    show({ ...EMPTY('2026-09'), records: [rec('a', Date.UTC(2026, 8, 29, 4)), rec('b', Date.UTC(2026, 8, 2, 4))] });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Sep 28–30', 'Sep 1–6']);
  });
});

describe('BehaviourView month switcher', () => {
  it('names the month and steps back by a month; next is off on this month', () => {
    show();
    expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Previous month' })).toHaveAttribute('href', '/behaviour?month=2026-09');
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('link', { name: 'Previous month' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('link', { name: 'This month' })).toHaveAttribute('href', '/behaviour');
  });

  it('an arrow at a bound stays focusable but goes nowhere', async () => {
    show();
    await userEvent.click(screen.getByRole('link', { name: 'Next month' }));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('stepping onto a bound keeps focus on the arrow (it is not replaced by another element)', async () => {
    const { rerender } = show(EMPTY('2026-09'));
    const next = screen.getByRole('link', { name: 'Next month' });
    await userEvent.click(next);
    expect(nav.push).toHaveBeenCalledWith('/behaviour?month=2026-10');
    rerender(<BehaviourView behaviour={OCTOBER} now={NOW} />);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Next month' }));
    expect(document.activeElement).toHaveAttribute('aria-disabled', 'true');
  });

  it('the same at the earliest month', async () => {
    const { rerender } = show(EMPTY('2025-10'));
    await userEvent.click(screen.getByRole('link', { name: 'Previous month' }));
    rerender(<BehaviourView behaviour={EMPTY('2025-09')} now={NOW} />);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Previous month' }));
    expect(document.activeElement).toHaveAttribute('aria-disabled', 'true');
  });

  it('a past month steps both ways', () => {
    show(EMPTY('2026-08'));
    expect(screen.getByRole('link', { name: 'Previous month' })).toHaveAttribute('href', '/behaviour?month=2026-07');
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute('href', '/behaviour?month=2026-09');
  });

  it('stops at the start of the previous school year', () => {
    show(EMPTY('2025-09'));
    expect(screen.getByRole('link', { name: 'Previous month' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute('href', '/behaviour?month=2025-10');
  });

  it('switches month in a transition, so the old month stays until the new one is in', async () => {
    const { rerender } = show();
    await userEvent.click(screen.getByRole('link', { name: 'Previous month' }));
    expect(nav.push).toHaveBeenCalledWith('/behaviour?month=2026-09');
    // The new month arrives (with its entrance) in place of the old one.
    rerender(<BehaviourView behaviour={EMPTY('2026-09')} now={NOW} />);
    expect(screen.getByRole('heading', { level: 2, name: 'September 2026' })).toBeVisible();
    expect(card()).toHaveAccessibleName('凌云积分 100');
  });
});
