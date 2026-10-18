import { describe, expect, it } from 'vitest';
import { groupTodo, isSubmittedLate } from '../priority';
import { dayIndex, weekStartOf } from '../time';
import { BLANK_CREDENTIALS_ERROR, data } from './index';

const DAY = 24 * 3600_000;

describe('mock data', () => {
  it('getTodo returns only To submit items', async () => {
    const todo = await data.getTodo();
    expect(todo.length).toBeGreaterThan(0);
    expect(todo.every((a) => a.status === 'To submit')).toBe(true);
  });

  it('todo populates every priority group', async () => {
    const groups = groupTodo(await data.getTodo(), Date.now());
    expect(groups.overdue.length).toBeGreaterThanOrEqual(1);
    expect(groups.nearly.length).toBeGreaterThanOrEqual(1);
    expect(groups.upcoming.length).toBeGreaterThanOrEqual(2);
  });

  it('getSubmitted returns submitted items with submittedAt, at least one late', async () => {
    const done = await data.getSubmitted();
    expect(done.length).toBeGreaterThanOrEqual(6);
    expect(done.every((a) => a.status === 'Submitted' && a.submittedAt !== undefined)).toBe(true);
    expect(done.some(isSubmittedLate)).toBe(true);
  });

  it('getWeek stays inside the week and includes routine items', async () => {
    const ws = weekStartOf(Date.now());
    const events = await data.getWeek(ws);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.start).toBeGreaterThanOrEqual(ws);
      expect(e.end).toBeLessThanOrEqual(ws + 7 * DAY);
      expect(e.end).toBeGreaterThan(e.start);
    }
    expect(events.some((e) => !e.isClass)).toBe(true);
    expect(events.some((e) => e.isClass)).toBe(true);
  });

  it('getWeek has 6-9 classes on each weekday, none on weekends', async () => {
    const ws = weekStartOf(Date.now());
    const events = (await data.getWeek(ws)).filter((e) => e.isClass);
    for (let d = 0; d < 5; d++) {
      const n = events.filter((e) => dayIndex(e.start, ws) === d).length;
      expect(n).toBeGreaterThanOrEqual(6);
      expect(n).toBeLessThanOrEqual(9);
    }
    expect(events.some((e) => dayIndex(e.start, ws) >= 5)).toBe(false);
  });

  it('getWeek works for a week in Jan 2027', async () => {
    const ws = weekStartOf(Date.UTC(2027, 0, 13));
    const events = await data.getWeek(ws);
    expect(events.some((e) => e.isClass)).toBe(true);
    expect(events.every((e) => e.start >= ws && e.end <= ws + 7 * DAY)).toBe(true);
  });

  it('materialises Monday Chinese I at 08:00 China time', async () => {
    const ws = weekStartOf(Date.UTC(2027, 0, 13));
    const chinese = (await data.getWeek(ws)).find((e) => e.name === 'Chinese I');
    expect(chinese?.start).toBe(ws + 8 * 3600_000);
    expect(chinese?.end).toBe(ws + 8 * 3600_000 + 40 * 60_000);
    expect(chinese?.room).toBe('D419');
  });

  it('signIn rejects blank credentials', async () => {
    expect((await data.signIn('', 'x')).ok).toBe(false);
    expect((await data.signIn('  ', '  ')).ok).toBe(false);
    expect(await data.signIn('x', '')).toEqual({ ok: false, error: BLANK_CREDENTIALS_ERROR });
  });

  it('signIn accepts any non-empty credentials and mints a fresh session token', async () => {
    const first = await data.signIn('s123', 'pw');
    const second = await data.signIn('s123', 'pw');
    expect(first).toEqual({ ok: true, displayName: 'Bruce Zheng', token: expect.any(String) });
    if (!first.ok || !second.ok) throw new Error('expected sign-in to succeed');
    expect(first.token.length).toBeGreaterThan(0);
    expect(second.token).not.toBe(first.token);
  });

  it('signOut resolves for any token', async () => {
    await expect(data.signOut('any-token')).resolves.toBeUndefined();
  });
});
