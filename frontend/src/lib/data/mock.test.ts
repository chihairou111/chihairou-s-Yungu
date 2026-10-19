import { describe, expect, it } from 'vitest';
import { COURSE_COLORS } from '../colors';
import { groupTodo, isSubmittedLate } from '../priority';
import { dayIndex, weekStartOf } from '../time';
import { AssignmentNotFound, CommentNotFound } from './errors';
import { BLANK_CREDENTIALS_ERROR, data } from './index';
import { mockData } from './mock';

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

  it('getCourses lists each course once with a distinct Google Calendar color', async () => {
    const courses = await data.getCourses();
    expect(courses.length).toBeGreaterThan(0);
    expect(new Set(courses.map((c) => c.id)).size).toBe(courses.length);
    expect(new Set(courses.map((c) => c.name)).size).toBe(courses.length);
    expect(new Set(courses.map((c) => c.color)).size).toBe(courses.length);
    for (const c of courses) expect(Object.keys(COURSE_COLORS)).toContain(c.color);
  });

  it('every assignment and class resolves to a course, and every course is referenced', async () => {
    const courses = await data.getCourses();
    const ids = new Set(courses.map((c) => c.id));
    const ws = weekStartOf(Date.now());
    const work = [...(await data.getTodo()), ...(await data.getSubmitted())];
    const classes = (await data.getWeek(ws)).filter((e) => e.isClass);
    for (const a of work) expect(ids.has(a.courseId), a.title).toBe(true);
    for (const e of classes) expect(e.courseId !== null && ids.has(e.courseId), e.name).toBe(true);
    const used = new Set([...work.map((a) => a.courseId), ...classes.map((e) => e.courseId)]);
    expect([...ids].filter((id) => !used.has(id))).toEqual([]);
  });

  it('maps the timetable and assignment names of CL Business to one course', async () => {
    const courses = await data.getCourses();
    const ws = weekStartOf(Date.now());
    const business = (await data.getWeek(ws)).find((e) => e.name === 'CL Business I')!;
    const caseStudy = (await data.getSubmitted()).find((a) => a.course === 'CL Business with Personal Finance I')!;
    expect(business.courseId).toBe(caseStudy.courseId);
    expect(courses.filter((c) => c.name.startsWith('CL Business'))).toHaveLength(1);
  });

  it('gives routine items no course', async () => {
    const routines = (await data.getWeek(weekStartOf(Date.now()))).filter((e) => !e.isClass);
    expect(routines.every((e) => e.courseId === null)).toBe(true);
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

describe('assignment detail fixtures', () => {
  it('every to-do and submitted assignment has instructions', async () => {
    const all = [...(await data.getTodo()), ...(await data.getSubmitted())];
    for (const a of all) {
      const d = await data.getAssignmentDetail(a.id);
      expect(d, a.title).not.toBeNull();
      expect(d!.instructionsHtml.length, a.title).toBeGreaterThan(0);
      expect(d!.teacher.length).toBeGreaterThan(0);
      expect(d!.title).toBe(a.title);
    }
  });

  it('one assignment has pdf, video, image and office attachments, another has comments', async () => {
    const all = [...(await data.getTodo()), ...(await data.getSubmitted())];
    const details = await Promise.all(all.map((a) => data.getAssignmentDetail(a.id)));
    const rich = details.find((d) => d!.attachments.length >= 4)!;
    const kinds = rich.attachments.map((f) => f.kind);
    for (const k of ['pdf', 'video', 'image', 'office']) expect(kinds).toContain(k);
    for (const f of rich.attachments.filter((f) => f.kind === 'office')) expect(f.previewPdfUrl).toBe('/mock/sample.pdf');
    expect(details.some((d) => d!.comments.length > 0)).toBe(true);
  });

  it('submitted assignments show the files already handed in', async () => {
    const d = await data.getAssignmentDetail(201);
    expect(d!.submitted).toBe(true);
    expect(d!.myFiles.length).toBeGreaterThan(0);
  });
});

describe('mock writes on unknown assignments and comments', () => {
  it('throws AssignmentNotFound for an id it does not know, as the service answers 404', async () => {
    for (const write of [
      () => mockData.saveDraft(999999, []),
      () => mockData.submit(999999, ['1']),
      () => mockData.addComment(999999, 'hi'),
      () => mockData.deleteComment(999999, 'x'),
    ]) {
      await expect(write()).rejects.toBeInstanceOf(AssignmentNotFound);
    }
  });

  it("throws CommentNotFound for someone else's comment or an unknown one, and leaves it", async () => {
    const theirs = (await mockData.getAssignmentDetail(101))!.comments.find((c) => !c.mine)!;
    await expect(mockData.deleteComment(101, theirs.id)).rejects.toBeInstanceOf(CommentNotFound);
    await expect(mockData.deleteComment(101, 'nope')).rejects.toMatchObject({ status: 404, message: 'Comment not found' });
    expect((await mockData.getAssignmentDetail(101))!.comments.some((c) => c.id === theirs.id)).toBe(true);
  });
});
